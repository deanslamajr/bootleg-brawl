// tools validate: schema (via the loader) plus every semantic rule from the plan: references,
// module availability, rig coverage, frame data sanity, palettes, team-ups, bootleg tells,
// campaign reachability and the forbidden-terms scan. Output is one line per problem.

import { ForbiddenScanner, stageFile, type StateDef } from "@bb/schema";
import {
  compileContent,
  ContentError,
  resolveStates,
  type ModuleRegistry,
  type RawContent,
} from "@bb/engine";
import { loadContent, type LoadResult } from "./content-fs";
import { LayerPainter } from "../art/layers";
import { drawPose } from "../art/sprite";
import type { IndexedImage } from "../art/raster";

export interface ValidateReport {
  errors: string[];
  warnings: string[];
  files: number;
}

const PLAYER_STATES = [
  "idle",
  "walk",
  "run",
  "jump",
  "land",
  "jumpAtk",
  "atk1",
  "atk2",
  "atk3",
  "dashAtk",
  "backAtk",
  "grab",
  "grabHit",
  "throwF",
  "throwB",
  "stomp",
  "special",
  "hurt",
  "fall",
  "down",
  "getup",
  "ko",
  "grabbed",
  "thrown",
  "pickup",
];
const ACTOR_STATES = ["idle", "walk", "hurt", "fall", "down", "getup", "ko"];

export function validateRaw(
  raw: RawContent,
  registry: ModuleRegistry,
  load: Pick<LoadResult, "errors" | "warnings" | "docs">,
  only?: string,
): ValidateReport {
  const errors = [...load.errors];
  const warnings = [...load.warnings];
  const E = (m: string) => errors.push(m);
  const W = (m: string) => warnings.push(m);
  const inScope = (path: string) => !only || path.includes(only);

  // ---- palettes against the master palette
  const master = new Set(raw.masterPalette);
  for (const [id, pal] of Object.entries(raw.palettes)) {
    pal.forEach((c, i) => {
      if (i > 0 && !master.has(c))
        E(`content/palettes: palette ${id} color ${i} (${c}) is not in the master palette`);
    });
  }
  const palette = (id: string, where: string) => {
    if (!raw.palettes[id]) E(`${where}: unknown palette ${id}`);
  };

  // ---- sfx references
  const sfx = new Set(Object.keys(raw.sfx.sounds));
  const sfxRef = (id: string | undefined, where: string) => {
    if (id && !sfx.has(id)) E(`${where}: unknown sound ${id}`);
  };

  // ---- actors: rig coverage, frame data, poses
  const checkStates = (
    kind: "character" | "enemy" | "boss",
    id: string,
    table: Record<string, StateDef>,
    rigId: string,
    uniques: Record<string, unknown>,
    where: string,
  ) => {
    const rig = raw.rigs[rigId];
    if (!rig) {
      E(`${where}: unknown rig ${rigId}`);
      return;
    }
    const required =
      kind === "character"
        ? PLAYER_STATES
        : kind === "enemy" && rig.kind === "nonhuman"
          ? ["idle", "walk", "atk1", "hurt", "ko"]
          : ACTOR_STATES;
    for (const s of required) if (!table[s]) E(`${where}: missing required state "${s}"`);
    const bleedW = rig.frameBox[0] * 1.1 + 20;
    for (const [name, st] of Object.entries(table)) {
      let total = 0;
      let lastHit = -1;
      st.frames.forEach((f, i) => {
        if (!rig.poses[f.pose] && !uniques[f.pose])
          E(
            `${where}: state ${name} frame ${i} uses pose "${f.pose}", which is neither a ${rig.id} rig pose nor a unique frame`,
          );
        if (f.hurt !== "none" && Array.isArray(f.hurt) && f.hurt.length === 0)
          E(`${where}: state ${name} frame ${i} has an empty hurtbox list`);
        for (const h of f.hit ?? []) {
          lastHit = i;
          sfxRef(h.sfx, `${where}: state ${name}`);
          const [bx, , bw] = h.box;
          if (!h.tags.includes("screen") && (Math.abs(bx) > bleedW || Math.abs(bx + bw) > bleedW))
            E(
              `${where}: state ${name} frame ${i} hitbox reaches past the ${rig.id} frame box (tag it "screen" if intended)`,
            );
        }
        for (const ev of f.events ?? []) {
          sfxRef(ev.sfx, `${where}: state ${name}`);
          if (ev.spawn && !raw.items.projectiles[ev.spawn.projectile])
            E(`${where}: state ${name} spawns unknown projectile ${ev.spawn.projectile}`);
        }
        total += f.dur;
      });
      if ((st.kind === "attack" || st.kind === "special") && st.frames.some((f) => f.hit?.length)) {
        if (
          lastHit === st.frames.length - 1 &&
          !st.loop &&
          !st.gravity &&
          !st.tags.includes("charge")
        )
          W(`${where}: attack state ${name} has no recovery frames after its last hit frame`);
      }
      for (const tr of st.transitions) {
        if (tr.from > total)
          E(
            `${where}: state ${name} transition on ${tr.on} opens at tick ${tr.from}, after the state ends (${total})`,
          );
        if (tr.to !== "@weapon" && !table[tr.to])
          E(`${where}: state ${name} transitions to missing state ${tr.to}`);
      }
      if (st.next && !table[st.next])
        E(`${where}: state ${name} has missing next state ${st.next}`);
      if (st.landTo && !table[st.landTo])
        E(`${where}: state ${name} has missing landTo state ${st.landTo}`);
    }
    // Rig pose library coverage for the required animations.
    if (kind === "character") {
      for (const [anim, min] of Object.entries(rig.requiredStates)) {
        const n = Object.keys(rig.poses).filter((p) => p.startsWith(`${anim}:`)).length;
        if (n < min)
          E(`content/rigs/${rig.id}.rig.json: animation ${anim} has ${n} poses, needs ${min}`);
      }
    }
  };

  for (const [id, c] of Object.entries(raw.characters)) {
    const where = `content/characters/${id}`;
    if (!inScope(where)) continue;
    let table: Record<string, StateDef> = {};
    try {
      table = {
        ...resolveStates(
          raw.templates["template:weapons"] ?? {
            schemaVersion: 1,
            states: {},
            patch: {},
            remove: [],
          },
          raw.templates,
        ),
        ...resolveStates(c.states, raw.templates),
      };
    } catch (e) {
      E(`${where}/states.json: ${(e as Error).message}`);
    }
    checkStates("character", id, table, c.file.rig, c.overlays.uniqueFrames, where);
    palette(c.file.palette, `${where}/character.json`);
    for (const p of c.file.altPalettes) palette(p, `${where}/character.json`);
    for (const v of Object.values(c.file.sfx)) sfxRef(v, `${where}/character.json`);
    if (c.file.parodyMeta.tells.length < 2)
      E(`${where}/character.json: parodyMeta.tells needs at least two bootleg tells`);
    const missing = registry.missing(c.file.kit.requires);
    if (missing.length)
      E(`${where}/character.json: kit requires unavailable modules: ${missing.join(", ")}`);
    for (const t of c.file.teamUps) {
      const partner = raw.characters[t.partnerId];
      if (!partner) E(`${where}/character.json: team-up partner ${t.partnerId} does not exist`);
      else if (!t.bothDirections && !partner.file.teamUps.some((r) => r.partnerId === id))
        E(
          `${where}/character.json: team-up with ${t.partnerId} is one-way; set bothDirections or add the reciprocal entry`,
        );
      if (!table[t.moveId]) E(`${where}/character.json: team-up move ${t.moveId} is not a state`);
    }
  }
  for (const [id, f] of Object.entries(raw.enemies)) {
    const where = `content/enemies/${id}`;
    if (!inScope(where)) continue;
    let table: Record<string, StateDef> = {};
    try {
      table = resolveStates(f.states, raw.templates);
    } catch (e) {
      E(`${where}/states.json: ${(e as Error).message}`);
    }
    checkStates("enemy", id, table, f.file.rig, f.overlays.uniqueFrames, where);
    for (const t of f.file.tiers) {
      palette(t.palette, `${where}/family.json tier ${t.name}`);
      for (const m of t.moves)
        if (!table[m]) E(`${where}/family.json: tier ${t.name} lists missing move ${m}`);
    }
    if (f.file.weapon && !raw.items.weapons[f.file.weapon])
      E(`${where}/family.json: unknown weapon ${f.file.weapon}`);
  }
  for (const [id, b] of Object.entries(raw.bosses)) {
    const where = `content/bosses/${id}`;
    if (!inScope(where)) continue;
    let table: Record<string, StateDef> = {};
    try {
      table = resolveStates(b.states, raw.templates);
    } catch (e) {
      E(`${where}/states.json: ${(e as Error).message}`);
    }
    checkStates("boss", id, table, b.file.rig, b.overlays.uniqueFrames, where);
    palette(b.file.palette, `${where}/boss.json`);
    if (b.file.partner && !raw.bosses[b.file.partner])
      E(`${where}/boss.json: partner ${b.file.partner} does not exist`);
    if (b.file.parodyMeta.tells.length < 2)
      W(`${where}/boss.json: bosses should list two bootleg tells`);
    for (const ph of b.file.phases)
      for (const p of ph.patterns)
        for (const s of p.steps) {
          if ((s.do === "attack" || s.do === "charge") && !table[s.state])
            E(`${where}/boss.json: pattern uses missing state ${s.state}`);
          if (s.do === "spawn" && !raw.enemies[s.family])
            E(`${where}/boss.json: pattern spawns unknown family ${s.family}`);
        }
  }

  // ---- the bake rejects overlays that leave the rig frame box on the upright pose
  const actors: [
    string,
    string,
    { file: { rig: string }; overlays: RawContent["characters"][string]["overlays"] },
  ][] = [
    ...Object.entries(raw.characters).map(
      ([id, a]) => [`content/characters/${id}`, id, a] as [string, string, typeof a],
    ),
    ...Object.entries(raw.enemies).map(
      ([id, a]) => [`content/enemies/${id}`, id, a] as [string, string, typeof a],
    ),
    ...Object.entries(raw.bosses).map(
      ([id, a]) => [`content/bosses/${id}`, id, a] as [string, string, typeof a],
    ),
  ];
  for (const [where, , a] of actors) {
    if (!inScope(where)) continue;
    const rig = raw.rigs[a.file.rig];
    if (!rig) continue;
    const f = drawPose(rig, a.overlays, "idle:0");
    if (f.overflow > 0)
      E(
        `${where}/overlays.json: ${f.overflow} px of the idle pose fall outside the ${rig.id} rig frame box (${rig.frameBox.join("x")})`,
      );
    // The anchor is the foot point: the soles sit on the anchor row (the outline may add one row
    // below) and the feet straddle the anchor column.
    const feet = feetOf(f.img);
    if (!feet) continue;
    const [ax, ay] = f.anchor;
    if (feet.bottom > ay + 1)
      E(`${where}/overlays.json: idle pose feet are ${feet.bottom - ay} px below the anchor row`);
    else if (feet.bottom < ay - 1)
      E(`${where}/overlays.json: idle pose feet are ${ay - feet.bottom} px above the anchor row`);
    if (Math.abs(feet.center - ax) > FEET_CENTER_TOLERANCE)
      E(
        `${where}/overlays.json: idle pose feet are centered ${Math.abs(feet.center - ax)} px from the anchor column`,
      );
  }

  // ---- items
  for (const [id, p] of Object.entries(raw.items.props)) {
    palette(p.sprite.palette, `content/items: prop ${id}`);
    sfxRef(p.breakSfx, `content/items: prop ${id}`);
    for (const d of p.drops)
      if (!raw.items.pickups[d.item]) E(`content/items: prop ${id} drops unknown pickup ${d.item}`);
  }
  for (const [id, p] of Object.entries(raw.items.pickups)) {
    palette(p.sprite.palette, `content/items: pickup ${id}`);
    if (p.weapon && !raw.items.weapons[p.weapon])
      E(`content/items: pickup ${id} gives unknown weapon ${p.weapon}`);
  }
  for (const [id, w] of Object.entries(raw.items.weapons)) {
    if (!raw.items.pickups[w.pickup])
      E(`content/items: weapon ${id} drops unknown pickup ${w.pickup}`);
    if (w.throwProjectile && !raw.items.projectiles[w.throwProjectile])
      E(`content/items: weapon ${id} throws unknown projectile ${w.throwProjectile}`);
  }
  for (const [id, p] of Object.entries(raw.items.projectiles)) {
    sfxRef(p.sfx, `content/items: projectile ${id}`);
    if (p.dropsPickup && !raw.items.pickups[p.dropsPickup])
      E(`content/items: projectile ${id} drops unknown pickup ${p.dropsPickup}`);
  }

  // ---- stages
  const moduleRuleKeys = new Set(
    registry.schemaFragments().flatMap((f) => Object.keys(f.stage ?? {})),
  );
  const ruleKeys = new Set([...Object.keys(stageFile.shape.rules.shape), ...moduleRuleKeys]);
  const controllerKinds = new Set(
    registry.all().flatMap((m) => Object.keys(m.segmentControllers ?? {})),
  );
  for (const [id, st] of Object.entries(raw.stages)) {
    const where = `content/stages/${id}`;
    if (!inScope(where)) continue;
    const f = st.file;
    const missing = registry.missing(f.rules.requires);
    if (missing.length)
      E(`${where}/stage.json: requires unavailable modules: ${missing.join(", ")}`);
    // Post-v1 fields parse so a later module can read them without a migration. Until a module
    // does, a stage that sets one is rejected: it would parse and do nothing.
    for (const [key, value] of Object.entries(f.rules)) {
      if (!ruleKeys.has(key))
        E(`${where}/stage.json: rules.${key} is not a rule any module declares`);
      else if (POST_V1_RULES.includes(key) && !moduleRuleKeys.has(key) && value)
        E(`${where}/stage.json: rules.${key} is a post-v1 field that no module reads`);
    }
    if (f.forks.length) E(`${where}/stage.json: forks is a post-v1 field that no module reads`);
    if (!V1_STAGE_TYPES.includes(f.type))
      E(`${where}/stage.json: stage type ${f.type} is a post-v1 field that no module reads`);
    if (f.parodyMeta.tells.length < 2)
      E(`${where}/stage.json: parodyMeta.tells needs at least two bootleg tells`);
    for (const c of f.palette)
      if (!master.has(c)) E(`${where}/stage.json: palette color ${c} is not in the master palette`);
    if (!raw.tracks[f.music.track]) E(`${where}/stage.json: unknown music track ${f.music.track}`);
    if (f.music.boss && !raw.tracks[f.music.boss])
      E(`${where}/stage.json: unknown boss track ${f.music.boss}`);
    for (const q of f.music.cues)
      if (q.track && !raw.tracks[q.track])
        E(`${where}/stage.json: cue uses unknown track ${q.track}`);
    for (const i of [...f.interludes.before, ...f.interludes.after])
      if (!raw.interludes[i]) E(`${where}/stage.json: unknown interlude ${i}`);
    // Bystanders only behave as bystanders when the civilians module runs on the stage.
    const civilians = f.segments.flatMap((sid) =>
      (st.segments[sid]?.placements ?? [])
        .filter((p) => p.kind === "civilian")
        .map((p) => `${sid}: ${p.id}`),
    );
    if (civilians.length && !f.rules.requires.includes("civilians")) {
      E(
        `${where}/stage.json: civilian placements (${civilians.join(", ")}) need civilians in rules.requires`,
      );
      if (!registry.isOn("civilians"))
        E(`${where}/stage.json: civilian placements need the civilians module, which is off`);
    }
    const painter = new LayerPainter(f.palette, raw.items, raw.palettes);
    for (const [lid, layer] of Object.entries(st.layers))
      painter.paintLayer(layer, `${where}/layers/${lid}.json`);
    for (const e of painter.errors) E(e);
    for (const sid of f.segments) {
      const seg = st.segments[sid];
      const sw = `${where}/segments/${sid}.json`;
      if (!seg) {
        E(`${where}/stage.json: segment ${sid} has no file`);
        continue;
      }
      if (POST_V1_SEGMENT_KINDS.includes(seg.kind) && !controllerKinds.has(seg.kind))
        E(`${sw}: segment kind ${seg.kind} is a post-v1 field that no module reads`);
      if (seg.depth[0] >= seg.depth[1] || seg.depth[0] < 100 || seg.depth[1] > 270)
        E(
          `${sw}: depth band ${seg.depth.join("..")} has no reachable ground inside the 270px frame`,
        );
      for (const l of seg.layers) if (!st.layers[l.layer]) E(`${sw}: unknown layer ${l.layer}`);
      let prev = -1;
      for (const lock of seg.scrollLocks) {
        if (lock.at > seg.length - 480)
          E(
            `${sw}: scroll lock ${lock.id} at ${lock.at} is past the last camera position ${seg.length - 480}`,
          );
        if (lock.at < prev) E(`${sw}: scroll lock ${lock.id} is out of order`);
        prev = lock.at;
        for (const w of lock.waves) {
          if (!raw.enemies[w.family]) E(`${sw}: lock ${lock.id} spawns unknown family ${w.family}`);
          else if (w.tier >= raw.enemies[w.family]!.file.tiers.length)
            E(`${sw}: lock ${lock.id} uses tier ${w.tier} that ${w.family} does not have`);
          if (
            !["walk", "drop", "floor"].includes(w.spawnKind) &&
            !registry.isOn("environmental-spawn")
          )
            E(
              `${sw}: lock ${lock.id} uses spawnKind ${w.spawnKind}, which needs the environmental-spawn module`,
            );
          if (
            !["walk", "drop"].includes(w.spawnKind) &&
            !f.rules.requires.includes("environmental-spawn")
          )
            E(
              `${sw}: lock ${lock.id} uses spawnKind ${w.spawnKind}; add environmental-spawn to the stage's rules.requires`,
            );
        }
        if (lock.boss && !raw.bosses[lock.boss])
          E(`${sw}: lock ${lock.id} names unknown boss ${lock.boss}`);
      }
      for (const p of seg.placements) {
        const ok =
          p.kind === "pickup"
            ? raw.items.pickups[p.id]
            : p.kind === "breakable" || p.kind === "prop"
              ? raw.items.props[p.id]
              : p.kind === "civilian" || p.kind === "npc"
                ? raw.enemies[p.id]
                : true;
        if (!ok) E(`${sw}: placement ${p.kind} ${p.id} does not exist`);
        if (p.x < 0 || p.x > seg.length)
          E(`${sw}: placement ${p.id} at x ${p.x} is outside the segment`);
      }
      for (const g of seg.gags) {
        if (!raw.items.props[g.propId]) E(`${sw}: gag prop ${g.propId} does not exist`);
        if (g.params.item && !raw.items.pickups[g.params.item])
          E(`${sw}: gag drops unknown pickup ${g.params.item}`);
        if (g.params.family && !raw.enemies[g.params.family])
          E(`${sw}: gag spawns unknown family ${g.params.family}`);
        sfxRef(g.params.sfx, sw);
      }
      if ((seg as Record<string, unknown>).autoScroll && !f.rules.requires.includes("auto-scroll"))
        E(`${sw}: autoScroll needs auto-scroll in the stage's rules.requires`);
      if (seg.kind === "elevator" && !f.rules.requires.includes("elevator"))
        E(`${sw}: elevator segments need elevator in the stage's rules.requires`);
    }
    for (const b of f.bossTriggers) {
      if (!raw.bosses[b.bossId])
        E(`${where}/stage.json: boss trigger names unknown boss ${b.bossId}`);
      const seg = st.segments[b.at];
      if (!seg) E(`${where}/stage.json: boss trigger at unknown segment ${b.at}`);
      else if (!seg.scrollLocks.some((l) => l.id === b.lock))
        E(`${where}/stage.json: boss trigger lock ${b.lock} is not in segment ${b.at}`);
      if (b.arenaId && !raw.arenas[b.arenaId]) E(`${where}/stage.json: unknown arena ${b.arenaId}`);
      if (b.arenaId && !f.rules.requires.includes("arena"))
        E(`${where}/stage.json: arenas need arena in rules.requires`);
    }
  }

  // ---- interludes, music
  for (const [id, i] of Object.entries(raw.interludes)) {
    const where = `content/interludes/${id}.json`;
    if (i.subtype === "cutscene") {
      for (const s of i.steps) {
        for (const a of s.actors)
          if (!raw.characters[a.def] && !raw.enemies[a.def] && !raw.bosses[a.def])
            E(`${where}: actor ${a.def} does not exist`);
        sfxRef(s.sfx, where);
      }
      if (i.music && !raw.tracks[i.music]) E(`${where}: unknown music ${i.music}`);
    }
    if (i.subtype === "map")
      for (const en of i.entries)
        if (en.stageId && !raw.stages[en.stageId])
          E(`${where}: entry points at unknown stage ${en.stageId}`);
    if (i.subtype === "minigame" && i.music && !raw.tracks[i.music])
      E(`${where}: unknown music ${i.music}`);
    if (i.subtype === "shop" || i.subtype === "bonus-room" || i.subtype === "qte") {
      const miss = registry.missing(i.requires);
      if (miss.length) E(`${where}: requires unavailable modules: ${miss.join(", ")}`);
    }
  }
  for (const t of Object.values(raw.tracks)) {
    for (const p of t.order)
      if (!t.patterns[p]) E(`content/music/${t.id}.track.json: order uses missing pattern ${p}`);
    for (const [pn, pat] of Object.entries(t.patterns))
      for (const ch of Object.keys(pat))
        if (!t.instruments[ch])
          E(`content/music/${t.id}.track.json: pattern ${pn} uses missing instrument ${ch}`);
  }

  // ---- roster and campaign
  for (const id of raw.roster.rosterOrder)
    if (!raw.characters[id]) E(`content/roster.json: rosterOrder lists unknown character ${id}`);
  for (const id of Object.keys(raw.characters))
    if (raw.characters[id]!.file.unlock === "v1" && !raw.roster.rosterOrder.includes(id))
      W(`content/roster.json: v1 character ${id} is missing from rosterOrder`);
  const camp = raw.campaign;
  const nodes = new Map(camp.nodes.map((n) => [n.stageId, n]));
  for (const n of camp.nodes) {
    if (!raw.stages[n.stageId]) E(`content/campaign.json: node ${n.stageId} is not a stage`);
    for (const o of n.options)
      if (!nodes.has(o)) E(`content/campaign.json: node ${n.stageId} links to unknown node ${o}`);
  }
  if (!nodes.has(camp.start)) E(`content/campaign.json: start ${camp.start} is not a node`);
  if (!nodes.has(camp.finale)) E(`content/campaign.json: finale ${camp.finale} is not a node`);
  for (const n of camp.nodes) {
    const seen = new Set<string>();
    const q = [n.stageId];
    let reaches = false;
    while (q.length) {
      const cur = q.shift()!;
      if (cur === camp.finale) reaches = true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      q.push(...(nodes.get(cur)?.options ?? []));
    }
    if (!reaches)
      E(`content/campaign.json: node ${n.stageId} cannot reach the finale ${camp.finale}`);
  }
  if (!raw.interludes[camp.endingInterlude])
    E(`content/campaign.json: unknown ending interlude ${camp.endingInterlude}`);

  // ---- forbidden terms over every validated document and file name
  const scanner = new ForbiddenScanner(raw.forbiddenTerms);
  for (const d of load.docs) {
    if (d.type === "forbidden-terms" || d.type === "rig") continue;
    if (!inScope(d.file)) continue;
    const extra = ((d.doc as { parodyMeta?: { forbiddenTerms?: string[] } }).parodyMeta
      ?.forbiddenTerms ?? []) as string[];
    for (const hit of scanner.scanDoc(d.doc, d.file, extra))
      E(`${hit.path}: forbidden term "${hit.term}" in "${hit.text.slice(0, 60)}"`);
  }

  // ---- compile (catches dangling references the checks above missed)
  try {
    compileContent(raw);
  } catch (e) {
    if (e instanceof ContentError) E(`compile: ${e.message}`);
    else throw e;
  }
  return { errors, warnings, files: load.docs.length };
}

export function validateRepo(registry: ModuleRegistry, only?: string): ValidateReport {
  const load = loadContent(registry);
  return validateRaw(load.raw, registry, load, only);
}

/** Stage rules the schema keeps for later modules. A module that declares one in its stage
 * schema fragment makes it legal. */
const POST_V1_RULES = ["widescreen", "timerHealth", "invertGravity"];
/** Segment kinds with no v1 controller. A module segment controller for the kind makes it legal. */
const POST_V1_SEGMENT_KINDS = ["fork", "qte", "cutscene"];
/** Stage types v1 runs: walk-right with modules on top, and the arena. */
const V1_STAGE_TYPES = ["walk-right", "elevator", "auto-scroll", "arena"];

/** How far the middle of the feet may sit from the anchor column. Big rigs stand wider. */
const FEET_CENTER_TOLERANCE = 4;

/** The lowest ink row, and the column midpoint of the ink in the lowest three rows. */
function feetOf(img: IndexedImage): { bottom: number; center: number } | null {
  let bottom = -1;
  for (let y = img.height - 1; y >= 0 && bottom < 0; y--)
    for (let x = 0; x < img.width; x++)
      if (img.data[y * img.width + x]) {
        bottom = y;
        break;
      }
  if (bottom < 0) return null;
  let left = img.width;
  let right = -1;
  for (let y = Math.max(0, bottom - 2); y <= bottom; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[y * img.width + x]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
  return { bottom, center: (left + right) / 2 };
}
