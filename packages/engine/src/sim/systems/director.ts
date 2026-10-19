// Stage flow: segments, scroll locks and their waves, boss triggers, the escape outro and
// game over. Segment kinds other than walk-right are run by module segment controllers.

import { FX, intToFx, toFx } from "../../math/fixed";
import type { SegmentController } from "../../modules/registry";
import type { Sim } from "../sim";
import { F, KIND, MAX_ON_SCREEN_ENEMIES, PHASE, SLOT, VIEW_W } from "../types";

export function defaultSegmentController(): SegmentController {
  return {
    start(sim) {
      const g = sim.g;
      g.lockIdx = 0;
      g.lockActive = 0;
      updateCamMax(sim);
    },
    tick(sim) {
      const g = sim.g;
      const seg = sim.segment();
      const locks = seg.scrollLocks;
      // Non-holding triggers spawn their walk-ons and let the camera keep going.
      while (
        !g.lockActive &&
        g.lockIdx < locks.length &&
        !locks[g.lockIdx]!.hold &&
        g.camX >= intToFx(locks[g.lockIdx]!.at) - FX
      ) {
        const lock = locks[g.lockIdx]!;
        for (const w of lock.waves) sim.queueWave(w, 0);
        if (lock.text) sim.text(lock.text, "banner", -1, 90);
        g.lockIdx++;
        updateCamMax(sim);
      }
      if (!g.lockActive && g.lockIdx < locks.length) {
        const lock = locks[g.lockIdx]!;
        if (lock.hold && g.camX >= intToFx(lock.at) - FX) engageLock(sim, g.lockIdx);
      }
      if (g.lockActive) {
        g.stats.lockTicks++;
        const lock = locks[g.lockIdx]!;
        const waiting = g.pending.length > 0 || sim.livingEnemies(true) > 0 || g.bosses.length > 0;
        if (!waiting && g.phase === PHASE.play) {
          g.lockActive = 0;
          g.lockIdx++;
          sim.emit({ t: "lockClear", id: lock.id });
          sim.emit({ t: "go" });
          const bulletin = sim.stage.gagHooks.dirkHeadline.find((b) => b.lock === lock.id);
          if (bulletin) sim.say(sim.stageLines.bulletin, "bulletin", -1, 240);
          updateCamMax(sim);
        }
        return false;
      }
      if (g.lockIdx >= locks.length) {
        const endCam = intToFx(Math.max(0, g.segLen - VIEW_W));
        if (g.camX >= endCam - FX) {
          for (const e of sim.playerEntities())
            if (sim.c.x[e]! >= intToFx(g.segLen - 140)) return true;
          // A lone player standing still at the end also finishes after a short wait.
          if (seg.kind === "arena") return true;
        }
      }
      return false;
    },
  };
}

function updateCamMax(sim: Sim): void {
  const g = sim.g;
  const locks = sim.segment().scrollLocks;
  const end = intToFx(Math.max(0, g.segLen - VIEW_W));
  const next = locks.slice(g.lockIdx).find((l) => l.hold);
  g.camMaxX = next ? Math.min(end, intToFx(next.at)) : end;
}

function engageLock(sim: Sim, idx: number): void {
  const g = sim.g;
  const lock = sim.segment().scrollLocks[idx]!;
  g.lockActive = 1;
  sim.emit({ t: "lockStart", id: lock.id });
  if (lock.text) sim.text(lock.text, "banner", -1, 120);
  const trigger = sim.stage.bossTriggers.findIndex(
    (b) => b.lock === lock.id && b.at === sim.segment().id,
  );
  const bossId = trigger >= 0 ? sim.stage.bossTriggers[trigger]!.bossId : lock.boss;
  const first =
    !g.firstEnemyDone && sim.stage.gagHooks.deadweightDave !== undefined && !sim.sandbox;
  if (first) {
    g.firstEnemyDone = 1;
    const dave = sim.content.defIndex["deadweight-dave"];
    if (dave !== undefined) {
      g.pending.push({
        at: g.tick + 10,
        def: dave,
        tier: 0,
        side: 1,
        kind: "walk",
        x: -1,
        y: -1,
        first: 1,
      });
    }
  }
  for (const w of lock.waves) sim.queueWave(w, first ? 40 : 0);
  if (bossId) {
    g.bossTrigger = trigger;
    g.bossMid = trigger >= 0 ? (sim.stage.bossTriggers[trigger]!.midBoss ? 1 : 0) : 1;
    beginBoss(sim, bossId, trigger >= 0 ? sim.stage.bossTriggers[trigger]!.introCard : true);
  }
}

function beginBoss(sim: Sim, bossId: string, card: boolean): void {
  const g = sim.g;
  const def = sim.content.defIndex[bossId];
  if (def === undefined) throw new Error(`boss trigger refers to unknown boss ${bossId}`);
  const d = sim.content.defs[def]!;
  const partner = d.boss?.partner ? (sim.content.defIndex[d.boss.partner] ?? -1) : -1;
  g.flags.pendingBoss = def + 1;
  g.flags.pendingPartner = partner + 1;
  if (card) {
    g.phase = PHASE.bossIntro;
    g.phaseTimer = 150;
    sim.emit({ t: "bossCard", def, partner, midBoss: g.bossMid === 1 });
  } else spawnBoss(sim);
}

function spawnBoss(sim: Sim): void {
  const g = sim.g;
  const def = (g.flags.pendingBoss ?? 0) - 1;
  const partner = (g.flags.pendingPartner ?? 0) - 1;
  g.flags.pendingBoss = 0;
  g.flags.pendingPartner = 0;
  if (def < 0) return;
  const cam = g.camX >> 16;
  const [dmin, dmax] = sim.depthAt(cam + VIEW_W - 60);
  const mid = (dmin + dmax) >> 1;
  const a = sim.spawnActor(def, 0, cam + VIEW_W + 30, mid, 0, -1);
  if (a >= 0) {
    sim.c.flags[a]! |= F.lockEnemy;
    g.bosses.push(a);
  }
  if (partner >= 0) {
    const b = sim.spawnActor(partner, 0, cam - 30, mid + 8, 0, 1);
    if (b >= 0) {
      sim.c.flags[b]! |= F.lockEnemy;
      g.bosses.push(b);
    }
  }
  g.phase = PHASE.boss;
  sim.emit({ t: "music", action: "boss", track: sim.stage.music.boss });
  const trigger = g.bossTrigger >= 0 ? sim.stage.bossTriggers[g.bossTrigger] : undefined;
  for (const m of sim.modules) m.hooks?.onBossStart?.(sim, g.bosses.slice(), trigger?.arenaId);
}

export function startSegment(sim: Sim, index: number): void {
  const g = sim.g;
  const seg = sim.segments[index]!;
  // Clear the old segment's leftovers but keep players.
  for (let e = 0; e < sim.world.high; e++) {
    if (!sim.world.alive[e]) continue;
    if (sim.c.kind[e] !== KIND.player) sim.despawn(e);
  }
  g.seg = index;
  g.segLen = seg.length;
  g.depthMin = seg.depth[0];
  g.depthMax = seg.depth[1];
  g.camX = 0;
  g.camY = 0;
  g.camMinX = 0;
  g.pending = [];
  g.bosses = [];
  g.lockActive = 0;
  g.lockIdx = 0;
  g.flags.camControlled = 0;
  for (const k of Object.keys(g.flags))
    if (k.startsWith("drop:") || k.startsWith("line:")) delete g.flags[k];
  g.stats.segTicks.push(0);
  // Players: spawn or reposition at the segment start.
  for (let slot = 0; slot < g.players.length; slot++) {
    const p = g.players[slot]!;
    if (p.status !== SLOT.playing) continue;
    if (p.ent < 0 || !sim.world.alive[p.ent]) sim.spawnPlayer(slot);
    const e = p.ent;
    if (e < 0) continue;
    const c = sim.c;
    c.x[e] = intToFx(seg.startX + slot * 22);
    c.y[e] = intToFx(seg.depth[0] + Math.trunc(((seg.depth[1] - seg.depth[0]) * (slot + 1)) / 5));
    c.z[e] = 0;
    c.vx[e] = 0;
    c.vz[e] = 0;
    sim.prevX[e] = c.x[e]!;
    sim.prevY[e] = c.y[e]!;
    sim.prevZ[e] = 0;
  }
  // Placements and gags.
  for (const pl of seg.placements) placeOne(sim, pl);
  seg.gags.forEach((gag, i) => {
    const def = sim.content.defIndex[`prop:${gag.propId}`];
    if (def !== undefined) sim.spawnProp(def, gag.x, gag.y, i);
  });
  if (sim.stage.gagHooks.sprinkles.includes(seg.id)) {
    const dog = sim.content.defIndex["prop:sprinkles"];
    if (dog !== undefined) sim.spawnProp(dog, Math.trunc(seg.length * 0.4), seg.depth[0] - 4);
  }
  for (const q of sim.stage.gagHooks.quillbert) {
    if (q.segment !== seg.id) continue;
    const pick = sim.content.defIndex["pickup:quillbert"];
    if (pick !== undefined)
      sim.spawnPickup(pick, intToFx(q.x), intToFx((seg.depth[0] + seg.depth[1]) >> 1));
  }
  const ctl = controllerFor(sim, seg);
  sim.segController = ctl;
  ctl.start(sim);
  for (const m of sim.modules) m.hooks?.onSegmentStart?.(sim, index);
  sim.emit({ t: "segment", index, intro: seg.intro });
  if (seg.intro) sim.text(seg.intro, "banner", -1, 150);
  const cue = sim.stage.music.cues.find((q) => q.at === seg.id);
  if (cue) sim.emit({ t: "music", action: cue.action, track: cue.track });
}

function controllerFor(sim: Sim, seg: ReturnType<Sim["segment"]>): SegmentController {
  const byKind = sim.segmentControllers[seg.kind];
  if (byKind) return byKind();
  for (const key of Object.keys(sim.segmentControllers).sort()) {
    if (key in seg && (seg as Record<string, unknown>)[key] !== undefined)
      return sim.segmentControllers[key]!();
  }
  return defaultSegmentController();
}

function placeOne(sim: Sim, pl: ReturnType<Sim["segment"]>["placements"][number]): void {
  const c = sim.c;
  switch (pl.kind) {
    case "pickup": {
      const def = sim.content.defIndex[`pickup:${pl.id}`];
      if (def !== undefined) sim.spawnPickup(def, intToFx(pl.x), intToFx(pl.y));
      return;
    }
    case "breakable":
    case "prop": {
      const def = sim.content.defIndex[`prop:${pl.id}`];
      if (def === undefined) return;
      const e = sim.spawnProp(def, pl.x, pl.y, -1, pl.facing);
      if (e >= 0 && pl.drops) {
        // Placement drop tables override the prop's own: stash the choice now, deterministically.
        const i = sim.rng.weighted(pl.drops.map((d) => d.weight));
        const item = sim.content.defIndex[`pickup:${pl.drops[i]!.item}`];
        if (item !== undefined) {
          c.counter[e] = 1;
          sim.g.flags[`drop:${e}`] = item + 1;
        }
      }
      return;
    }
    case "civilian":
    case "npc": {
      const def = sim.content.defIndex[pl.id];
      if (def === undefined) return;
      const e = sim.spawnActor(def, 0, pl.x, pl.y, 0, pl.facing);
      if (e >= 0 && pl.line) sim.g.flags[`line:${e}`] = 1;
      return;
    }
    case "hazard":
      // Hazards are module-defined; modules read placements in onSegmentStart.
      return;
  }
}

/** Spawns queued wave members whose time has come, respecting the on-screen cap. */
function processSpawns(sim: Sim): void {
  const g = sim.g;
  if (g.pending.length === 0) return;
  let onScreen = sim.livingEnemies();
  const keep = [];
  for (const p of g.pending) {
    if (p.at > g.tick || onScreen >= MAX_ON_SCREEN_ENEMIES) {
      keep.push(p);
      continue;
    }
    const e = spawnFromPending(sim, p);
    if (e >= 0) onScreen++;
  }
  g.pending = keep;
}

function spawnFromPending(sim: Sim, p: Sim["g"]["pending"][number]): number {
  const g = sim.g;
  const c = sim.c;
  const cam = g.camX >> 16;
  let x: number;
  let z = 0;
  const [dmin, dmax] = sim.depthAt(cam + VIEW_W / 2);
  const y = p.y >= 0 ? p.y : dmin + sim.rng.int(Math.max(1, dmax - dmin));
  if (p.kind === "walk" || p.kind === "drop" || p.kind === "floor") {
    if (p.side === 0 || p.kind === "drop") {
      x = p.x >= 0 ? p.x : cam + 60 + sim.rng.int(VIEW_W - 120);
      z = 180;
    } else x = p.side > 0 ? cam + VIEW_W + 24 + sim.rng.int(20) : cam - 24 - sim.rng.int(20);
  } else {
    for (const m of sim.modules) {
      const fn = m.spawnKinds?.[p.kind];
      if (fn) {
        const e = fn(sim, { def: p.def, tier: p.tier, x: p.x, y: p.y, side: p.side, kind: p.kind });
        if (e >= 0) {
          finishSpawn(sim, e, p);
          return e;
        }
      }
    }
    x = p.side >= 0 ? cam + VIEW_W + 24 : cam - 24;
  }
  const e = sim.spawnActor(p.def, p.tier, x, y, z, x > cam + VIEW_W / 2 ? -1 : 1);
  if (e < 0) return -1;
  if (z > 0) c.flags[e]! |= F.offscreenOk;
  finishSpawn(sim, e, p);
  return e;
}

function finishSpawn(sim: Sim, e: number, p: Sim["g"]["pending"][number]): void {
  const c = sim.c;
  c.flags[e]! |= F.lockEnemy;
  if (p.first) {
    c.flags[e]! |= F.firstEnemy;
    const costume = sim.stage.gagHooks.deadweightDave;
    if (costume) {
      c.variant[e] = costumeIndex(costume.costume);
      sim.say(sim.stageLines.costume, "bubble", e, 150);
    }
  } else {
    // The game screen shows a spawn line at a chance (D80), so the sim draws no number here.
    sim.say(sim.def(e).enemy?.pools.spawn, "bubble", e, 90);
  }
}

/** Deadweight Dave's costume catalog. The renderer draws the hat for the index. */
export const COSTUMES = [
  "none",
  "cowboy",
  "space",
  "armor",
  "hardhat",
  "sewer",
  "tux",
  "party",
] as const;
function costumeIndex(name: string): number {
  const i = COSTUMES.indexOf(name as (typeof COSTUMES)[number]);
  return i < 0 ? 0 : i;
}

export function directorSystem(sim: Sim): void {
  const g = sim.g;
  g.stats.samples++;
  g.stats.enemiesOnScreenSum += sim.livingEnemies();
  const segTicks = g.stats.segTicks;
  if (segTicks.length) segTicks[segTicks.length - 1] = segTicks[segTicks.length - 1]! + 1;
  // Hair-caught items and the improvised weapon respawn.
  hairAndImprovised(sim);
  if (g.phase !== PHASE.gameover && !sim.sandbox) checkGameOver(sim);
  switch (g.phase) {
    case PHASE.intro:
      if (--g.phaseTimer <= 0) {
        g.phase = PHASE.play;
        sim.emit({ t: "go" });
        sim.emit({ t: "music", action: "stage", track: sim.stage.music.track });
      }
      return;
    case PHASE.bossIntro:
      if (--g.phaseTimer <= 0) spawnBoss(sim);
      return;
    case PHASE.segmentFade:
      if (--g.phaseTimer <= 0) {
        startSegment(sim, g.seg + 1);
        g.phase = PHASE.play;
      }
      return;
    case PHASE.boss:
      processSpawns(sim);
      if (
        g.bosses.every(
          (b) => !sim.world.alive[b] || sim.c.kind[b] !== KIND.boss || sim.c.flags[b]! & F.towing,
        )
      ) {
        g.bosses = [];
        for (const m of sim.modules) m.hooks?.onBossEnd?.(sim);
        g.phase = PHASE.bossDown;
        g.phaseTimer = 90;
        sim.emit({ t: "music", action: "stinger", track: "boss-down" });
      }
      return;
    case PHASE.bossDown:
      processSpawns(sim);
      towAway(sim);
      if (--g.phaseTimer > 0) return;
      if (g.bossMid) {
        g.phase = PHASE.play;
        sim.emit({ t: "music", action: "stage", track: sim.stage.music.track });
      } else {
        // Clear stragglers: the boss's minions flee when the boss falls.
        for (let e = 0; e < sim.world.high; e++)
          if (sim.world.alive[e] && sim.c.kind[e] === KIND.enemy) sim.despawn(e);
        g.pending = [];
        startOutro(sim);
      }
      return;
    case PHASE.outro:
      tickOutro(sim);
      return;
    case PHASE.clear:
    case PHASE.gameover:
      return;
    case PHASE.play: {
      if (sim.sandbox) return;
      processSpawns(sim);
      const done = sim.segController.tick(sim);
      if (done) {
        if (g.seg + 1 < sim.segments.length) {
          g.phase = PHASE.segmentFade;
          g.phaseTimer = 40;
        } else startOutro(sim);
      }
      return;
    }
  }
}

/** A towed boss is dragged off the right edge by the tow truck the renderer draws. */
function towAway(sim: Sim): void {
  const c = sim.c;
  for (let e = 0; e < sim.world.high; e++) {
    if (!sim.world.alive[e] || !(c.flags[e]! & F.towing)) continue;
    c.x[e] = c.x[e]! + toFx(2.2);
    if (c.x[e]! > sim.g.camX + intToFx(VIEW_W + 120)) sim.despawn(e);
  }
}

function startOutro(sim: Sim): void {
  const g = sim.g;
  g.phase = PHASE.outro;
  g.phaseTimer = 260;
  const def = sim.content.defIndex["lickspittle"];
  if (def !== undefined && sim.stage.outro) {
    const cam = g.camX >> 16;
    const [dmin, dmax] = sim.depthAt(cam + VIEW_W - 80);
    const e = sim.spawnActor(def, 0, cam + VIEW_W + 20, (dmin + dmax) >> 1, 0, -1);
    if (e >= 0) {
      sim.c.flags[e]! |= F.unfightable | F.invulnerable;
      sim.c.ai[e] = 8;
      g.outroEnt = e;
    }
  }
}

function tickOutro(sim: Sim): void {
  const g = sim.g;
  const c = sim.c;
  const e = g.outroEnt;
  g.phaseTimer--;
  if (e >= 0 && sim.world.alive[e]) {
    const cam = g.camX >> 16;
    const targetX = intToFx(cam + VIEW_W - 90);
    if (c.x[e]! > targetX) c.mx[e] = -1;
    else {
      c.mx[e] = 0;
      c.facing[e] = -1;
    }
    if (g.phaseTimer === 190) sim.say(sim.stageLines.outro, "bubble", e, 150);
    if (g.phaseTimer === 40) {
      sim.emit({ t: "static" });
      sim.sfx("static");
      sim.despawn(e);
      g.outroEnt = -1;
    }
  }
  if (g.phaseTimer === 30) sim.say(sim.stageLines.outroBanner, "banner", -1, 120);
  if (g.phaseTimer <= 0) {
    g.phase = PHASE.clear;
    g.stageCleared = 1;
    sim.emit({ t: "stageClear" });
  }
}

function checkGameOver(sim: Sim): void {
  const g = sim.g;
  let alive = false;
  for (const p of g.players)
    if (p.status === SLOT.playing || p.status === SLOT.continue || p.status === SLOT.picking)
      alive = true;
  if (!alive && g.tick > 5) {
    g.phase = PHASE.gameover;
    sim.emit({ t: "gameOver" });
  }
}

function hairAndImprovised(sim: Sim): void {
  const c = sim.c;
  for (const e of sim.playerEntities()) {
    if (c.stuck[e]) {
      if (c.stuckTimer[e]! > 0) c.stuckTimer[e] = c.stuckTimer[e]! - 1;
      else {
        sim.spawnPickup(
          c.stuck[e]! - 1,
          c.x[e]!,
          c.y[e]! + 1,
          toFx(40),
          toFx(-c.facing[e]! * 0.6),
          toFx(1.5),
        );
        c.stuck[e] = 0;
        sim.text("IT FELL OUT", "pop", e, 50);
      }
    }
    const imp = sim.def(e).player?.improvised;
    if (imp && !c.impro[e] && imp.hits > 0) {
      if (c.improTimer[e]! > 0) c.improTimer[e] = c.improTimer[e]! - 1;
      else {
        c.impro[e] = 1;
        c.improHits[e] = imp.hits;
        sim.text(`NEW ${imp.name.toUpperCase()}`, "pop", e, 60);
      }
    }
  }
}

export { spawnBoss };
