// Turns validated content into integer runtime tables. Pure and deterministic: the same content
// always compiles to the same tables, in the browser and in Node.

import { stateDef as stateDefSchema, type Frame, type LinePools, type Hitbox, type ItemSprite, type OverlaysFile, type RigFile, type StateDef, type StatesFile } from "@bb/schema";
import { toFx } from "../math/fixed";
import { Hasher, hex32 } from "../math/hash";
import { CMD, COND, SK, type CommandName } from "../sim/types";
import { autoHurtbox, totalScale } from "./pose";
import type {
  CBox,
  CDef,
  CEvent,
  CFrame,
  CHit,
  CLinePool,
  CompiledContent,
  CState,
  CWeapon,
  RawContent,
  StateIds,
} from "./types";

export class ContentError extends Error {}

/** Resolves `extends`, `patch` and `remove` into a flat state table. */
export function resolveStates(
  file: StatesFile,
  templates: Record<string, StatesFile>,
  seen: string[] = [],
): Record<string, StateDef> {
  let base: Record<string, StateDef> = {};
  if (file.extends) {
    if (seen.includes(file.extends))
      throw new ContentError(`states extends cycle: ${[...seen, file.extends].join(" -> ")}`);
    const parent = templates[file.extends];
    if (!parent) throw new ContentError(`unknown states template ${file.extends}`);
    base = resolveStates(parent, templates, [...seen, file.extends]);
  }
  const out: Record<string, StateDef> = { ...base, ...file.states };
  for (const [name, patch] of Object.entries(file.patch)) {
    const cur = out[name];
    if (!cur) throw new ContentError(`patch targets missing state ${name}`);
    const merged = stateDefSchema.safeParse({ ...cur, ...patch });
    if (!merged.success) throw new ContentError(`patch on ${name}: ${merged.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    out[name] = merged.data;
  }
  for (const name of file.remove) delete out[name];
  return out;
}

const WELL_KNOWN: (keyof StateIds)[] = [
  "idle",
  "walk",
  "run",
  "jump",
  "land",
  "hurt",
  "hurtAir",
  "fall",
  "down",
  "getup",
  "ko",
  "grab",
  "grabbed",
  "thrown",
  "pickup",
  "taunt",
  "teamPartnerToss",
  "teamFly",
  "teamCloud",
  "dizzy",
  "emerge",
  "camFly",
  "grabHit",
  "throwF",
  "throwB",
  "victory",
  "sleep",
  "dead",
];

interface CompileCtx {
  scalePct: number;
  rig?: RigFile;
  body?: OverlaysFile["body"];
  unique?: OverlaysFile["uniqueFrames"];
  projectileIndex: Record<string, number>;
  owner: string;
}

function scaleBox(b: readonly number[], pct: number): CBox {
  return {
    x: Math.round((b[0]! * pct) / 100),
    z: Math.round((b[1]! * pct) / 100),
    w: Math.max(1, Math.round((b[2]! * pct) / 100)),
    h: Math.max(1, Math.round((b[3]! * pct) / 100)),
  };
}

function compileHit(h: Hitbox, ctx: CompileCtx): CHit {
  return {
    box: scaleBox(h.box, ctx.scalePct),
    damage: h.damage,
    kx: toFx(h.knock[0]),
    kz: toFx(h.knock[1]),
    hitstop: h.hitstop,
    hitstun: h.hitstun,
    knockdown: h.knockdown,
    launch: h.launch,
    grab: h.grab,
    rehit: h.rehit,
    sfx: h.sfx,
    score: h.score,
    tags: h.tags,
    ground: h.tags.includes("ground"),
  };
}

function compileFrame(f: Frame, start: number, ctx: CompileCtx): CFrame {
  let hurt: CBox[];
  if (f.hurt === "none") hurt = [];
  else if (f.hurt === "auto") {
    const base = ctx.unique?.[f.pose]?.base ?? f.pose;
    hurt = ctx.rig && ctx.body ? [autoHurtbox(ctx.rig, base, ctx.body)] : [{ x: -6, z: 0, w: 12, h: 12 }];
  } else hurt = f.hurt.map((b) => scaleBox(b, ctx.scalePct));
  const events: CEvent[] = (f.events ?? []).map((e) => {
    const ev: CEvent = { at: start + e.at };
    if (e.sfx) ev.sfx = e.sfx;
    if (e.shake) ev.shake = e.shake;
    if (e.release) ev.release = true;
    if (e.text) ev.text = e.text;
    if (e.flash) ev.flash = true;
    if (e.signal) ev.signal = e.signal;
    if (e.spawn) {
      const p = ctx.projectileIndex[e.spawn.projectile];
      if (p === undefined)
        throw new ContentError(`${ctx.owner}: unknown projectile ${e.spawn.projectile}`);
      ev.spawn = {
        projectile: p,
        ox: Math.round((e.spawn.offset[0] * ctx.scalePct) / 100),
        oz: Math.round((e.spawn.offset[1] * ctx.scalePct) / 100),
        vx: toFx(e.spawn.vel[0]),
        vz: toFx(e.spawn.vel[1]),
      };
    }
    return ev;
  });
  return {
    start,
    dur: f.dur,
    pose: f.pose,
    hit: (f.hit ?? []).map((h) => compileHit(h, ctx)),
    hurt,
    velX: f.vel && f.vel[0] !== null ? toFx(f.vel[0]) : null,
    velZ: f.vel && f.vel[1] !== null ? toFx(f.vel[1]) : null,
    events,
  };
}

export function compileStates(
  table: Record<string, StateDef>,
  ctx: CompileCtx,
): { states: CState[]; index: Record<string, number>; S: StateIds } {
  // Sorted for a stable id order regardless of file key order.
  const names = Object.keys(table).sort();
  const index: Record<string, number> = {};
  names.forEach((n, i) => (index[n] = i));
  const resolve = (name: string | undefined, fallback: number, from: string): number => {
    if (name === undefined) return fallback;
    if (name === "@weapon") return -2;
    const id = index[name];
    if (id === undefined) throw new ContentError(`${ctx.owner}: state ${from} refers to missing state ${name}`);
    return id;
  };
  const idle = index.idle ?? 0;
  const states: CState[] = names.map((name, id) => {
    const d = table[name]!;
    let t = 0;
    const frames = d.frames.map((f) => {
      const cf = compileFrame(f, t, ctx);
      t += f.dur;
      return cf;
    });
    const frameAt = new Uint8Array(t);
    frames.forEach((f, i) => frameAt.fill(i, f.start, f.start + f.dur));
    const kind = SK[d.kind];
    if (kind === undefined) throw new ContentError(`${ctx.owner}: state ${name} has unknown kind ${d.kind}`);
    return {
      id,
      name,
      kind,
      loop: d.loop,
      frames,
      total: t,
      frameAt,
      next: 0,
      transitions: [],
      move: Math.round(d.move * 100),
      moveY: d.moveY,
      facingLock: d.facingLock,
      gravity: d.gravity,
      landTo: -1,
      armor: d.armor,
      invulnFrom: d.invuln ? d.invuln[0] : -1,
      invulnTo: d.invuln ? d.invuln[1] : -1,
      costHp: d.cost?.hp ?? 0,
      costOnHit: d.cost?.onHit ?? false,
      friction: toFx(d.friction),
      tags: d.tags,
      hasHit: frames.some((f) => f.hit.length > 0),
    };
  });
  for (const s of states) {
    const d = table[s.name]!;
    s.next = resolve(d.next, d.kind === "air" ? (index.jump ?? idle) : idle, s.name);
    s.landTo = resolve(d.landTo, -1, s.name);
    s.transitions = d.transitions.map((tr) => ({
      cmd: CMD[tr.on as CommandName],
      to: resolve(tr.to, idle, s.name),
      from: tr.from,
      until: tr.until,
      cond: tr.if ? COND[tr.if] : COND.none,
    }));
  }
  const S = {} as StateIds;
  for (const k of WELL_KNOWN) S[k] = index[k] ?? -1;
  return { states, index, S };
}

function spritePoses(sprite: ItemSprite, id: string): string[] {
  return [id, ...Object.keys(sprite.frames).map((f) => `${id}:${f}`)];
}

function staticStates(poses: string[], loop: boolean, dur = 8): Record<string, StateDef> {
  const frames = poses.map((p) => ({ pose: p, dur, hurt: "none" as const }));
  return {
    idle: {
      kind: "free",
      loop,
      frames: loop ? frames : [frames[0]!],
      transitions: [],
      move: 0,
      moveY: true,
      facingLock: true,
      gravity: false,
      armor: 0,
      friction: 0.25,
      tags: [],
    },
  };
}

export function compileContent(raw: RawContent): CompiledContent {
  const defs: CDef[] = [];
  const defIndex: Record<string, number> = {};
  const weapons: CWeapon[] = [];
  const weaponIndex: Record<string, number> = {};

  const projectileIds = Object.keys(raw.items.projectiles).sort();
  const pickupIds = Object.keys(raw.items.pickups).sort();
  const propIds = Object.keys(raw.items.props).sort();
  const weaponIds = Object.keys(raw.items.weapons).sort();

  // Reserve indices in a fixed order: characters, enemies, bosses, projectiles, pickups, props.
  const charIds = [
    ...raw.roster.rosterOrder.filter((id) => raw.characters[id]),
    ...Object.keys(raw.characters)
      .filter((id) => !raw.roster.rosterOrder.includes(id))
      .sort(),
  ];
  const enemyIds = Object.keys(raw.enemies).sort();
  const bossIds = Object.keys(raw.bosses).sort();
  const order: [string, string][] = [
    ...charIds.map((id) => ["char", id] as [string, string]),
    ...enemyIds.map((id) => ["enemy", id] as [string, string]),
    ...bossIds.map((id) => ["boss", id] as [string, string]),
    ...projectileIds.map((id) => ["proj", id] as [string, string]),
    ...pickupIds.map((id) => ["pickup", id] as [string, string]),
    ...propIds.map((id) => ["prop", id] as [string, string]),
  ];
  order.forEach(([kind, id], i) => (defIndex[kind === "char" || kind === "enemy" || kind === "boss" ? id : `${kind}:${id}`] = i));
  const projectileIndex: Record<string, number> = {};
  for (const id of projectileIds) projectileIndex[id] = defIndex[`proj:${id}`]!;
  const pickupIndexOf = (id: string, owner: string): number => {
    const i = defIndex[`pickup:${id}`];
    if (i === undefined) throw new ContentError(`${owner}: unknown pickup ${id}`);
    return i;
  };
  weaponIds.forEach((id, i) => (weaponIndex[id] = i));

  const lines: CLinePool[] = [];
  /**
   * Builds the named pools of one folder: the single lines from its main file come first, then
   * its lines.json, without duplicates. An empty pool gets index -1, and the sim skips it.
   */
  const pools = (
    key: string,
    names: readonly string[],
    inline: Record<string, readonly (string | undefined)[]>,
    file: LinePools | undefined,
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const n of names) {
      const all = [...new Set([...(inline[n] ?? []), ...(file?.[n] ?? [])])].filter(
        (l): l is string => !!l,
      );
      out[n] = all.length ? lines.push({ key: `${key}/${n}`, role: n, lines: all }) - 1 : -1;
    }
    return out;
  };

  const actorCommon = (
    kind: CDef["kind"],
    id: string,
    displayName: string,
    rigId: string,
    overlays: OverlaysFile,
    states: StatesFile,
    extraTemplates: string[],
  ) => {
    const rig = raw.rigs[rigId];
    if (!rig) throw new ContentError(`${id}: unknown rig ${rigId}`);
    const scalePct = Math.round(totalScale(rig, overlays.body) * 100);
    let table = resolveStates(states, raw.templates);
    for (const t of extraTemplates) {
      const tpl = raw.templates[t];
      if (!tpl) throw new ContentError(`${id}: missing template ${t}`);
      table = { ...resolveStates(tpl, raw.templates), ...table };
    }
    const ctx: CompileCtx = { scalePct, rig, body: overlays.body, unique: overlays.uniqueFrames, projectileIndex, owner: id };
    const { states: cs, index, S } = compileStates(table, ctx);
    return {
      index: defIndex[id]!,
      id,
      kind,
      displayName,
      sheet: id,
      palette: "",
      rig: rigId,
      scalePct,
      states: cs,
      stateIndex: index,
      S,
      hp: 1,
      walk: 0,
      walkY: 0,
      runSpeed: 0,
      jumpVel: 0,
      weightPct: 100,
      damagePct: 100,
      shadowPct: 100,
      pushW: Math.round((8 * scalePct) / 100),
      sfx: {},
    } satisfies CDef;
  };

  for (const id of charIds) {
    const src = raw.characters[id]!;
    const f = src.file;
    const d: CDef = actorCommon("player", id, f.displayName, f.rig, src.overlays, src.states, ["template:weapons"]);
    d.palette = f.palette;
    d.hp = f.stats.hp;
    d.walk = toFx(f.stats.walkSpeed);
    d.walkY = toFx(f.stats.walkSpeed * 0.62);
    d.runSpeed = toFx(f.stats.runSpeed);
    d.jumpVel = toFx(f.stats.jumpVel);
    d.weightPct = Math.round(f.stats.weight * 100);
    d.damagePct = Math.round(f.stats.damageMult * 100);
    d.sfx = f.sfx;
    d.player = {
      shortName: f.shortName,
      archetype: f.archetype,
      specialCost: f.stats.specialCost,
      teamUps: f.teamUps.map((t) => {
        const st = d.stateIndex[t.moveId];
        if (st === undefined) throw new ContentError(`${id}: team-up move ${t.moveId} is not a state`);
        return { partner: t.partnerId, state: st, displayName: t.displayName, both: t.bothDirections };
      }),
      improvised: f.improvisedWeapon
        ? {
            id: f.improvisedWeapon.id,
            name: f.improvisedWeapon.displayName,
            hits: f.improvisedWeapon.hits,
            respawn: f.improvisedWeapon.respawnTicks,
            breakText: f.improvisedWeapon.breakText,
          }
        : undefined,
      gags: f.kit.gags,
      requires: f.kit.requires,
      kit: f.kit as Record<string, unknown>,
      voice: f.voice,
      pools: pools(
        `character/${id}`,
        ["taunt", "continue", "ending", "select"],
        {
          taunt: f.voice.tauntLines,
          continue: [f.voice.continueLine],
          ending: [f.voice.endingText],
          select: [f.voice.selectLine],
        },
        src.lines,
      ),
      portrait: f.portrait,
      unlock: f.unlock,
    };
    defs[d.index] = d;
  }

  for (const id of enemyIds) {
    const src = raw.enemies[id]!;
    const f = src.file;
    const d: CDef = actorCommon("enemy", id, f.displayName, f.rig, src.overlays, src.states, []);
    d.palette = f.tiers[0]!.palette;
    d.hp = f.tiers[0]!.hp;
    d.walk = toFx(f.stats.walkSpeed);
    d.walkY = toFx(f.stats.walkSpeed * 0.62);
    d.runSpeed = toFx(f.stats.runSpeed);
    d.jumpVel = toFx(f.stats.jumpVel);
    d.weightPct = Math.round(f.stats.weight * 100);
    d.shadowPct = Math.round(f.shadow * 100);
    d.sfx = f.sfx;
    const st = (n: string) => {
      const s = d.stateIndex[n];
      if (s === undefined) throw new ContentError(`${id}: ai refers to missing state ${n}`);
      return s;
    };
    d.enemy = {
      family: id,
      tiers: f.tiers.map((t) => ({
        name: t.name,
        displayName: t.displayName,
        palette: t.palette,
        hp: t.hp,
        damagePct: Math.round(t.damageMult * 100),
        speedPct: Math.round(t.speedMult * 100),
        moves: t.moves.map(st),
        badge: t.badge,
        miniBoss: t.miniBoss,
        score: t.score,
        aggression: t.aggressionBonus,
      })),
      ai: f.ai.kind,
      aiParams: f.ai.params,
      attackStates: f.ai.params.attacks.map(st),
      rangedState: f.ai.params.ranged ? st(f.ai.params.ranged) : -1,
      chargeState: f.ai.params.charge ? st(f.ai.params.charge) : -1,
      light: f.light,
      grabbable: f.grabbable,
      weapon: f.weapon ? (weaponIndex[f.weapon] ?? -1) : -1,
      civilian: f.civilian
        ? {
            penalty: f.civilian.penalty,
            rescueDrop: f.civilian.rescueDrop ? pickupIndexOf(f.civilian.rescueDrop, id) : -1,
          }
        : undefined,
      pools: pools(
        `enemy/${id}`,
        ["ko", "spawn", "help", "rescue"],
        { ko: f.lines.ko, spawn: f.lines.spawn },
        src.lines,
      ),
      catalogType: f.catalogType,
    };
    if (f.weapon && weaponIndex[f.weapon] === undefined) throw new ContentError(`${id}: unknown weapon ${f.weapon}`);
    defs[d.index] = d;
  }

  for (const id of bossIds) {
    const src = raw.bosses[id]!;
    const f = src.file;
    const d: CDef = actorCommon("boss", id, f.displayName, f.rig, src.overlays, src.states, []);
    d.palette = f.palette;
    d.hp = f.stats.hp;
    d.walk = toFx(f.stats.walkSpeed);
    d.walkY = toFx(f.stats.walkSpeed * 0.62);
    d.runSpeed = toFx(f.stats.runSpeed);
    d.jumpVel = toFx(f.stats.jumpVel);
    d.weightPct = Math.round(f.stats.weight * 100);
    d.damagePct = Math.round(f.stats.damageMult * 100);
    d.shadowPct = Math.round(f.shadow * 100);
    d.sfx = f.sfx;
    for (const ph of f.phases)
      for (const p of ph.patterns)
        for (const step of p.steps)
          if ((step.do === "attack" || step.do === "charge") && d.stateIndex[step.state] === undefined)
            throw new ContentError(`${id}: pattern refers to missing state ${step.state}`);
    d.boss = {
      file: f,
      phases: [...f.phases].sort((a, b) => b.hpBelowPct - a.hpBelowPct),
      gimmicks: new Map(f.gimmicks.map((g) => [g.id, g.params])),
      guardPct: f.guardPct,
      poise: f.poise,
      partner: f.partner ?? "",
      card: f.card,
      defeat: f.defeat,
      pools: pools(
        `boss/${id}`,
        ["pattern", "hurt", "defeat", "card", "phase", "defeatBanner"],
        {
          pattern: f.phases.flatMap((ph) =>
            ph.patterns.flatMap((p) => p.steps.map((st) => (st.do === "taunt" ? st.line : undefined))),
          ),
          hurt: f.lines.hurt,
          defeat: f.lines.defeat,
          card: [f.card.taunt],
          phase: f.phases.map((ph) => ph.enterText),
          defeatBanner: [f.defeat.text],
        },
        src.lines,
      ),
    };
    defs[d.index] = d;
  }

  const itemDef = (kind: CDef["kind"], key: string, id: string, sprite: ItemSprite, loop: boolean): CDef => {
    const ctx: CompileCtx = { scalePct: 100, projectileIndex, owner: key };
    const { states, index, S } = compileStates(staticStates(spritePoses(sprite, id), loop), ctx);
    return {
      index: defIndex[key]!,
      id,
      kind,
      displayName: id,
      sheet: "items",
      palette: sprite.palette,
      rig: "",
      scalePct: 100,
      states,
      stateIndex: index,
      S,
      hp: 1,
      walk: 0,
      walkY: 0,
      runSpeed: 0,
      jumpVel: 0,
      weightPct: 100,
      damagePct: 100,
      shadowPct: Math.round((sprite.size[0] / 24) * 100),
      pushW: 0,
      sfx: {},
    };
  };

  for (const id of projectileIds) {
    const p = raw.items.projectiles[id]!;
    const d = itemDef("projectile", `proj:${id}`, id, p.sprite, true);
    d.projectile = {
      speed: toFx(p.speed),
      damage: p.damage,
      kx: toFx(p.knock[0]),
      kz: toFx(p.knock[1]),
      hitstop: p.hitstop,
      hitstun: p.hitstun,
      knockdown: p.knockdown,
      lifetime: p.lifetime,
      pierce: p.pierce,
      gravity: toFx(p.gravity),
      box: scaleBox(p.box, 100),
      sfx: p.sfx,
      tags: p.tags,
      dropsPickup: p.dropsPickup ? pickupIndexOf(p.dropsPickup, `proj:${id}`) : -1,
      spin: p.spin,
      scalePct: Math.round(p.scale * 100),
    };
    d.shadowPct = 40;
    defs[d.index] = d;
  }
  for (const id of pickupIds) {
    const p = raw.items.pickups[id]!;
    const d = itemDef("pickup", `pickup:${id}`, id, p.sprite, false);
    d.pickup = {
      kind: p.kind,
      heal: p.heal,
      score: p.score,
      weapon: p.weapon ? (weaponIndex[p.weapon] ?? -1) : -1,
      lifetime: p.lifetime,
      text: p.text,
    };
    if (p.weapon && weaponIndex[p.weapon] === undefined) throw new ContentError(`pickup ${id}: unknown weapon ${p.weapon}`);
    defs[d.index] = d;
  }
  for (const id of propIds) {
    const p = raw.items.props[id]!;
    const d = itemDef("prop", `prop:${id}`, id, p.sprite, Object.keys(p.sprite.frames).some((f) => f.startsWith("f")));
    d.hp = Math.max(1, p.hp);
    d.prop = {
      hp: p.hp,
      breakable: p.breakable,
      hurt: scaleBox(p.hurt, 100),
      drops: p.drops.map((dr) => ({ item: pickupIndexOf(dr.item, `prop:${id}`), weight: dr.weight })),
      score: p.score,
      breakSfx: p.breakSfx,
      spawner: p.spawner,
    };
    defs[d.index] = d;
  }

  for (const id of weaponIds) {
    const w = raw.items.weapons[id]!;
    weapons.push({
      index: weaponIndex[id]!,
      id,
      displayName: w.displayName,
      hits: w.hits,
      moveset: w.moveset,
      damage: w.damage,
      reach: w.reach,
      sheet: "items",
      pickup: pickupIndexOf(w.pickup, `weapon ${id}`),
      breakText: w.breakText,
      throwProjectile: w.throwProjectile ? (projectileIndex[w.throwProjectile] ?? -1) : -1,
    });
  }

  const stagePools: Record<string, Record<string, number>> = {};
  for (const id of Object.keys(raw.stages).sort()) {
    const st = raw.stages[id]!;
    const f = st.file;
    const sp = pools(
      `stage/${id}`,
      ["costume", "bulletin", "outro", "outroBanner"],
      {
        costume: [f.gagHooks.deadweightDave?.line],
        bulletin: f.gagHooks.dirkHeadline.map((b) => b.line),
        outro: [f.outro?.lickspittle],
        outroBanner: [f.outro?.announcer],
      },
      st.lines,
    );
    // The announcer's title-card line and Mensa's correction stay paired by index.
    const said = [f.titleCard.announcerLine, ...(st.lines?.announcer ?? [])];
    const fixed = [f.titleCard.announcerLineCorrected ?? "", ...(st.lines?.announcerFix ?? [])];
    const keep = said.map((l, i) => i).filter((i) => said[i] && said.indexOf(said[i]!) === i);
    sp.announcer =
      lines.push({
        key: `stage/${id}/announcer`,
        role: "announcer",
        lines: keep.map((i) => said[i]!),
        pair: keep.map((i) => fixed[i] ?? ""),
      }) - 1;
    stagePools[id] = sp;
  }

  const roster = raw.roster.rosterOrder.map((id) => {
    const i = defIndex[id];
    if (i === undefined || defs[i]?.kind !== "player") throw new ContentError(`roster lists unknown character ${id}`);
    return i;
  });

  // Everything the sim reads goes into the hash, so a failed replay can name a content change.
  // Art and text stay out: layers, palettes, sheets, rigs, portraits, display names, voices, boss
  // cards, sfx ids and the line pools, because the game screen picks lines, not the sim (D80). The
  // browser never loads layer ops, so leaving layers out also lets it match the packer's hash.
  const h = new Hasher();
  h.value(raw.roster);
  for (const d of defs) h.value(simRelevant(d));
  for (const id of Object.keys(raw.stages).sort()) {
    const st = raw.stages[id]!;
    // Bundles ship stage files without parodyMeta (D62), so the hash leaves it out too.
    const { parodyMeta: _parodyMeta, ...file } = st.file as typeof st.file & { parodyMeta?: unknown };
    h.str(id).value(file).value(st.segments);
  }
  h.value(raw.items);
  h.value(raw.arenas);
  return {
    raw,
    defs,
    defIndex,
    weapons,
    weaponIndex,
    roster,
    lines,
    stagePools,
    hash: hex32(h.digest()),
  };
}

/** The fields of a compiled def that the sim reads, as plain JSON for the content hash. */
export function simRelevant(d: CDef): unknown {
  const box = (b: CBox) => [b.x, b.z, b.w, b.h];
  return {
    id: d.id,
    kind: d.kind,
    scalePct: d.scalePct,
    hp: d.hp,
    walk: d.walk,
    walkY: d.walkY,
    runSpeed: d.runSpeed,
    jumpVel: d.jumpVel,
    weightPct: d.weightPct,
    damagePct: d.damagePct,
    pushW: d.pushW,
    states: d.states.map((s) => ({
      name: s.name,
      kind: s.kind,
      loop: s.loop,
      total: s.total,
      next: s.next,
      move: s.move,
      moveY: s.moveY,
      facingLock: s.facingLock,
      gravity: s.gravity,
      landTo: s.landTo,
      armor: s.armor,
      invulnFrom: s.invulnFrom,
      invulnTo: s.invulnTo,
      costHp: s.costHp,
      costOnHit: s.costOnHit,
      friction: s.friction,
      tags: s.tags,
      transitions: s.transitions.map((t) => [t.cmd, t.to, t.from, t.until, t.cond]),
      frames: s.frames.map((f) => ({
        start: f.start,
        dur: f.dur,
        velX: f.velX,
        velZ: f.velZ,
        hurt: f.hurt.map(box),
        hit: f.hit.map((x) => ({
          box: box(x.box),
          damage: x.damage,
          kx: x.kx,
          kz: x.kz,
          hitstop: x.hitstop,
          hitstun: x.hitstun,
          knockdown: x.knockdown,
          launch: x.launch,
          grab: x.grab,
          rehit: x.rehit,
          score: x.score,
          tags: x.tags,
          ground: x.ground,
        })),
        events: f.events.map((e) => ({
          at: e.at,
          spawn: e.spawn,
          shake: e.shake,
          release: e.release,
          flash: e.flash,
          signal: e.signal,
          text: e.text === undefined ? 0 : 1,
        })),
      })),
    })),
    player: d.player && {
      specialCost: d.player.specialCost,
      teamUps: d.player.teamUps.map((t) => [t.partner, t.state, t.both]),
      improvised: d.player.improvised && [d.player.improvised.id, d.player.improvised.hits, d.player.improvised.respawn],
      gags: d.player.gags,
      requires: d.player.requires,
      kit: d.player.kit,
    },
    enemy: d.enemy && {
      family: d.enemy.family,
      tiers: d.enemy.tiers.map((t) => [t.hp, t.damagePct, t.speedPct, t.moves, t.miniBoss, t.score, t.aggression]),
      ai: d.enemy.ai,
      aiParams: d.enemy.aiParams,
      attackStates: d.enemy.attackStates,
      rangedState: d.enemy.rangedState,
      chargeState: d.enemy.chargeState,
      light: d.enemy.light,
      grabbable: d.enemy.grabbable,
      weapon: d.enemy.weapon,
      civilian: d.enemy.civilian,
    },
    boss: d.boss && {
      phases: d.boss.phases,
      // Hasher.value sees a Map as an object with no keys.
      gimmicks: [...d.boss.gimmicks.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      guardPct: d.boss.guardPct,
      poise: d.boss.poise,
      partner: d.boss.partner,
      grabbable: d.boss.file.grabbable,
      defeat: d.boss.defeat.kind,
    },
    projectile: d.projectile && { ...d.projectile, sfx: undefined },
    pickup: d.pickup && { ...d.pickup, text: undefined },
    prop: d.prop && { ...d.prop, breakSfx: undefined },
  };
}
