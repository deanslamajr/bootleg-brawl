// Gag hooks: character gags run by the core (autoEat) and scenery gags (props with a gag entry
// in their segment that fire on hit, step, proximity or taunt).

import { FX, intToFx, toFx } from "../../math/fixed";
import type { Sim } from "../sim";
import { CMD, F, KIND, SK, TEAM } from "../types";
import { applyPickup, applyHit } from "./combat";
import { findPickup } from "./fsm";

/** Ticks a gag's zone must stay empty before a step, proximity or taunt gag can fire again. */
const GAG_REARM = 30;

export function gagSystem(sim: Sim): void {
  if (sim.actorsFrozen) return;
  const c = sim.c;
  // Boomer stops to eat any food that lands within reach.
  for (const e of sim.playerEntities()) {
    const d = sim.def(e);
    if (!d.player?.gags.includes("autoEat")) continue;
    if (sim.stateKind(e) !== SK.free || c.z[e]! > 0) continue;
    const item = findPickup(sim, e, 26, 12);
    if (item >= 0 && sim.def(item).pickup?.kind === "food" && c.hp[e]! < c.maxHp[e]!) {
      if (d.S.pickup >= 0) sim.enterState(e, d.S.pickup);
      applyPickup(sim, e, item);
      sim.text("OM NOM", "pop", e, 40);
    }
  }
  // Scenery gags triggered by stepping on them, walking near them or taunting at them. A gag
  // fires once when a player arrives, and arms again after its zone has been empty for a while.
  // The rearm countdown lives in aiCool, which no prop uses for anything else.
  const w = sim.world;
  const seg = sim.segment();
  for (let p = 0; p < w.high; p++) {
    if (!w.alive[p] || c.kind[p] !== KIND.prop || c.gag[p] === 0) continue;
    const gag = seg.gags[c.gag[p]! - 1];
    if (!gag || gag.trigger === "hit") continue;
    if (gag.once && c.counter[p]! >= gag.hits) continue;
    const radius = gag.params.radius ?? (gag.trigger === "step" ? 12 : 40);
    let by = -1;
    for (const e of sim.playerEntities()) {
      const dx = Math.abs(c.x[e]! - c.x[p]!) / FX;
      const dy = Math.abs(c.y[e]! - c.y[p]!) / FX;
      if (dx > radius || dy > Math.max(10, radius / 2)) continue;
      if (gag.trigger === "taunt" && !(c.cmd[e]! & CMD.taunt)) continue;
      if (gag.trigger === "step" && c.z[e]! > 0) continue;
      by = e;
      break;
    }
    if (by >= 0) {
      if (c.aiCool[p] === 0) fire(sim, p, by);
      c.aiCool[p] = GAG_REARM;
    } else if (c.aiCool[p]! > 0) c.aiCool[p] = c.aiCool[p]! - 1;
  }
}

export function gagPropHit(sim: Sim, prop: number, by: number): void {
  const c = sim.c;
  if (c.gag[prop] === 0) return;
  const gag = sim.segment().gags[c.gag[prop]! - 1];
  if (!gag || gag.trigger !== "hit") return;
  c.counter[prop] = Math.min(0xffff, c.counter[prop]! + 1);
  const n = c.counter[prop]!;
  if (gag.once ? n === gag.hits : n % gag.hits === 0) fire(sim, prop, by, true);
}

function fire(sim: Sim, p: number, by: number, counted = false): void {
  const c = sim.c;
  const gag = sim.segment().gags[c.gag[p]! - 1]!;
  if (!counted) c.counter[p] = Math.min(0xffff, c.counter[p]! + 1);
  const params = gag.params;
  if (params.sfx) sim.sfx(params.sfx, p);
  if (params.text) sim.text(params.text, "pop", p, 70);
  if (params.score) sim.addScore(by, params.score);
  switch (gag.effect) {
    case "drop": {
      const item = params.item ? sim.content.defIndex[`pickup:${params.item}`] : undefined;
      if (item === undefined) break;
      const n = params.count ?? 1;
      for (let i = 0; i < n; i++)
        sim.spawnPickup(
          item,
          c.x[p]! + intToFx((i - (n >> 1)) * 6),
          c.y[p]! + intToFx(2),
          toFx(16),
          toFx((i - (n >> 1)) * 0.5),
          toFx(2.6),
        );
      break;
    }
    case "spawn": {
      if (params.family)
        sim.queueWave(
          {
            family: params.family,
            tier: 0,
            count: params.count ?? 1,
            side: "both",
            delayTicks: 0,
            spawnKind: "walk",
            fixed: true,
          },
          0,
        );
      break;
    }
    case "animate":
      c.variant[p] = 2;
      break;
    case "hazard": {
      // Damages everyone nearby except the prop: sprinklers, fire hydrants, exploding drums.
      const radius = params.radius ?? 36;
      const hit = {
        box: { x: -radius, z: 0, w: radius * 2, h: 40 },
        damage: params.damage ?? 8,
        kx: toFx(2),
        kz: toFx(3),
        hitstop: 4,
        hitstun: 20,
        knockdown: true,
        launch: false,
        grab: false,
        rehit: 0,
        sfx: "hit",
        score: 0,
        tags: ["gag"],
        ground: false,
      };
      for (let e = 0; e < sim.world.high; e++) {
        if (!sim.world.alive[e] || !sim.isActor(e) || c.team[e] === TEAM.neutral) continue;
        if (c.flags[e]! & (F.hidden | F.unfightable) || c.invuln[e]! > 0) continue;
        const k = sim.stateKind(e);
        if (k === SK.down || k === SK.ko) continue;
        const dx = Math.abs(c.x[e]! - c.x[p]!) / FX;
        const dy = Math.abs(c.y[e]! - c.y[p]!) / FX;
        if (dx <= radius && dy <= 14) applyHit(sim, p, e, hit, c.x[e]! >= c.x[p]! ? 1 : -1, false);
      }
      c.variant[p] = 2;
      break;
    }
    case "text":
    case "score":
    case "sfx":
      break;
  }
}
