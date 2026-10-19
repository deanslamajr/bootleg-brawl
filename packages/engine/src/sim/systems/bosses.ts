// Boss behaviour: the data-driven pattern runner and the core gimmicks. Arena modules add more
// gimmicks through the onGimmick hook.

import type { BossStep } from "@bb/schema";
import { intToFx, toFx } from "../../math/fixed";
import type { CHit } from "../../content/types";
import type { Sim } from "../sim";
import { F, KIND, SK, VIEW_W } from "../types";

export function bossOnHit(
  sim: Sim,
  _a: number,
  t: number,
  hit: CHit,
  thrown: boolean,
  dmg: number,
): { damage: number; knockdown: boolean; flinch: boolean } {
  const c = sim.c;
  const b = sim.def(t).boss!;
  let damage = dmg;
  let knockdown = hit.knockdown || hit.launch;
  let flinch = false;
  const st = sim.st(t);
  const dizzy = (c.flags[t]! & F.dizzy) !== 0;
  if (thrown && b.gimmicks.has("strikeOnThrown")) {
    damage = Math.trunc(damage * 2.5);
    sim.text("STRIKE!", "big", t, 80, "#ffd93a");
    sim.sfx("strike", t);
    return { damage, knockdown: true, flinch: true };
  }
  if (b.gimmicks.has("clashOnTell") && st.tags.includes("tell")) {
    sim.text("CLASH!", "big", t, 60);
    sim.sfx("clash", t);
    c.poise[t] = b.poise;
    return { damage: damage * 2, knockdown: false, flinch: true };
  }
  if (!dizzy && b.guardPct < 100) {
    damage = Math.trunc((damage * b.guardPct) / 100);
    if (sim.rng.chance(25)) sim.text("TINK", "pop", t, 30);
  }
  if (st.armor === -1 && !dizzy) return { damage, knockdown: false, flinch: false };
  if (dizzy) return { damage, knockdown, flinch: true };
  const poise = c.poise[t]!;
  if (poise > 1) {
    c.poise[t] = poise - 1;
    knockdown = false;
  } else {
    c.poise[t] = b.poise;
    flinch = true;
  }
  return { damage, knockdown, flinch };
}

function nearestPlayer(sim: Sim, e: number): number {
  const c = sim.c;
  let best = -1;
  let bestD = Infinity;
  for (const p of sim.targetablePlayers()) {
    const d = Math.abs(c.x[p]! - c.x[e]!) + 2 * Math.abs(c.y[p]! - c.y[e]!);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function face(sim: Sim, e: number, t: number): void {
  const c = sim.c;
  c.facing[e] = c.x[t]! >= c.x[e]! ? 1 : -1;
}

function moveToward(sim: Sim, e: number, xFx: number, yFx: number, slack = 3): boolean {
  const c = sim.c;
  const dx = (xFx - c.x[e]!) >> 16;
  const dy = (yFx - c.y[e]!) >> 16;
  c.mx[e] = dx > slack ? 1 : dx < -slack ? -1 : 0;
  c.my[e] = dy > 2 ? 1 : dy < -2 ? -1 : 0;
  return c.mx[e] === 0 && c.my[e] === 0;
}

function currentPhase(sim: Sim, e: number): number {
  const c = sim.c;
  const b = sim.def(e).boss!;
  const pct = Math.trunc((c.hp[e]! * 100) / Math.max(1, c.maxHp[e]!));
  let idx = 0;
  for (let i = 0; i < b.phases.length; i++) if (pct <= b.phases[i]!.hpBelowPct) idx = i;
  return idx;
}

function step(sim: Sim, e: number): BossStep | undefined {
  const c = sim.c;
  const b = sim.def(e).boss!;
  const phase = b.phases[c.aiPhase[e]!] ?? b.phases[0]!;
  const pattern = phase.patterns[c.aiPattern[e]!] ?? phase.patterns[0]!;
  return pattern.steps[c.aiStep[e]!];
}

function nextStep(sim: Sim, e: number): void {
  const c = sim.c;
  const b = sim.def(e).boss!;
  const phase = b.phases[c.aiPhase[e]!] ?? b.phases[0]!;
  const pattern = phase.patterns[c.aiPattern[e]!] ?? phase.patterns[0]!;
  c.aiTimer[e] = 0;
  c.mx[e] = 0;
  c.my[e] = 0;
  if (c.aiStep[e]! + 1 < pattern.steps.length) {
    c.aiStep[e] = c.aiStep[e]! + 1;
    return;
  }
  c.aiStep[e] = 0;
  c.aiPattern[e] = sim.rng.weighted(phase.patterns.map((p) => p.weight));
  c.aiCool[e] = Math.max(0, 24 - phase.haste);
}

export function bossThink(sim: Sim, e: number): void {
  const c = sim.c;
  const d = sim.def(e);
  const b = d.boss!;
  if (c.flags[e]! & F.unfightable) return;
  const ph = currentPhase(sim, e);
  if (ph !== c.aiPhase[e]) {
    c.aiPhase[e] = ph;
    c.aiStep[e] = 0;
    c.aiPattern[e] = 0;
    c.aiTimer[e] = 0;
    if (b.phases[ph]!.enterText) sim.say(b.pools.phase, "banner", e, 120);
  }
  duoCheck(sim, e);
  const kind = sim.stateKind(e);
  const s = step(sim, e);
  if (!s) return;
  // Charges keep moving through their non-free state.
  if (s.do === "charge" && c.aiTimer[e]! > 0) {
    c.aiTimer[e] = c.aiTimer[e]! + 1;
    const stName = sim.st(e).name;
    if (stName !== s.state && kind !== SK.free) return;
    const cam = sim.g.camX;
    const atWall =
      (c.facing[e]! > 0 && c.x[e]! > cam + intToFx(VIEW_W - 24)) ||
      (c.facing[e]! < 0 && c.x[e]! < cam + intToFx(24));
    if (stName !== s.state || (s.toWall && atWall) || c.aiTimer[e]! > s.maxTicks) {
      if (stName === s.state) sim.enterState(e, d.S.idle);
      c.vx[e] = 0;
      nextStep(sim, e);
      return;
    }
    // Charge states use zero friction, so the movement phase carries this speed.
    c.vx[e] = c.facing[e]! * toFx(s.speed);
    return;
  }
  if (kind !== SK.free) {
    c.mx[e] = 0;
    c.my[e] = 0;
    // Hold a grabbed player briefly, then slam.
    if (kind === SK.grab) {
      c.aiTimer[e] = c.aiTimer[e]! + 1;
      if (c.aiTimer[e]! > 34) {
        const slam = d.stateIndex.throwF ?? d.stateIndex.slam;
        if (slam !== undefined) sim.enterState(e, slam);
        c.aiTimer[e] = 0;
      }
    }
    return;
  }
  if (c.aiCool[e]! > 0) {
    c.aiCool[e] = c.aiCool[e]! - 1;
    c.mx[e] = 0;
    c.my[e] = 0;
    return;
  }
  const t = nearestPlayer(sim, e);
  c.aiTimer[e] = c.aiTimer[e]! + 1;
  const timer = c.aiTimer[e]!;
  switch (s.do) {
    case "approach": {
      if (t < 0) return;
      face(sim, e, t);
      const side = c.x[e]! >= c.x[t]! ? 1 : -1;
      const reach = intToFx(Math.trunc((s.range * d.scalePct) / 200));
      const done = moveToward(sim, e, c.x[t]! + side * reach, c.y[t]!, 4);
      c.run[e] = s.run ? 1 : 0;
      if (done || timer > s.maxTicks) nextStep(sim, e);
      return;
    }
    case "align": {
      if (t < 0) return;
      const side = c.x[e]! >= c.x[t]! ? 1 : -1;
      const done = moveToward(sim, e, c.x[t]! + side * intToFx(s.distance), c.y[t]!, 6);
      face(sim, e, t);
      if (done || timer > s.maxTicks) nextStep(sim, e);
      return;
    }
    case "attack": {
      const sid = d.stateIndex[s.state];
      if (t >= 0) face(sim, e, t);
      c.mx[e] = 0;
      c.my[e] = 0;
      if (sid !== undefined) sim.enterState(e, sid);
      nextStep(sim, e);
      return;
    }
    case "charge": {
      if (t >= 0) face(sim, e, t);
      const sid = d.stateIndex[s.state];
      if (sid !== undefined) sim.enterState(e, sid);
      c.mx[e] = 0;
      c.my[e] = 0;
      c.aiTimer[e] = 1;
      return;
    }
    case "spawn": {
      const def = sim.content.defIndex[s.family];
      if (def !== undefined)
        sim.queueWave(
          {
            family: s.family,
            tier: s.tier,
            count: s.count,
            side: "both",
            delayTicks: 0,
            spawnKind: s.spawnKind as never,
            fixed: true,
          },
          0,
        );
      nextStep(sim, e);
      return;
    }
    case "retreat": {
      if (t >= 0) {
        const away = c.x[e]! >= c.x[t]! ? 1 : -1;
        c.mx[e] = away;
        c.my[e] = c.y[e]! > c.y[t]! ? 1 : -1;
        face(sim, e, t);
      }
      if (timer > s.ticks) nextStep(sim, e);
      return;
    }
    case "wait":
      c.mx[e] = 0;
      c.my[e] = 0;
      if (t >= 0) face(sim, e, t);
      if (timer > s.ticks) nextStep(sim, e);
      return;
    case "taunt": {
      if (s.line) sim.say(d.boss!.pools.pattern, "bubble", e, 90);
      if (d.S.taunt >= 0) sim.enterState(e, d.S.taunt);
      nextStep(sim, e);
      return;
    }
    case "gimmick": {
      let handled = false;
      for (const m of sim.modules) if (m.hooks?.onGimmick?.(sim, e, s.id, timer)) handled = true;
      if (!handled) coreGimmick(sim, e, s.id, timer);
      if (timer > s.ticks) nextStep(sim, e);
      return;
    }
  }
}

function coreGimmick(sim: Sim, e: number, id: string, timer: number): void {
  const c = sim.c;
  if (id === "tandemSetup") {
    // The partner pair splits to opposite sides of the target's lane.
    const t = nearestPlayer(sim, e);
    if (t < 0) return;
    const partner = sim.g.bosses.find((b) => b !== e && sim.world.alive[b]);
    const left = partner === undefined || e < partner;
    const targetX = c.x[t]! + (left ? -1 : 1) * intToFx(150);
    const cam = sim.g.camX;
    const clamped = Math.max(cam + intToFx(30), Math.min(cam + intToFx(VIEW_W - 30), targetX));
    moveToward(sim, e, clamped, c.y[t]!, 6);
    c.run[e] = 1;
    face(sim, e, t);
    return;
  }
  if (id === "shake" && timer === 1) sim.emit({ t: "shake", ticks: 20 });
}

/** Duo bosses are stunned when they run into each other mid-charge. */
function duoCheck(sim: Sim, e: number): void {
  const c = sim.c;
  const b = sim.def(e).boss!;
  if (!b.gimmicks.has("duoCollide")) return;
  for (const o of sim.g.bosses) {
    if (o <= e || !sim.world.alive[o] || c.kind[o] !== KIND.boss) continue;
    const sa = sim.st(e);
    const so = sim.st(o);
    const charging = sa.tags.includes("charge") && so.tags.includes("charge");
    if (!charging) continue;
    if (Math.abs(c.x[o]! - c.x[e]!) < intToFx(28) && Math.abs(c.y[o]! - c.y[e]!) < intToFx(12)) {
      for (const x of [e, o]) {
        const d = sim.def(x);
        if (d.S.dizzy >= 0) sim.enterState(x, d.S.dizzy);
        c.flags[x]! |= F.dizzy;
        c.vx[x] = (x === e ? -1 : 1) * (c.x[o]! >= c.x[e]! ? 1 : -1) * toFx(2);
        c.aiStep[x] = 0;
        c.aiTimer[x] = 0;
        c.aiCool[x] = 160;
      }
      sim.text("BONK!", "big", e, 80, "#ffd93a");
      sim.emit({ t: "shake", ticks: 14 });
      sim.sfx("clash", e);
    }
  }
}

/** Clears the dizzy flag when the dizzy state ends. */
export function bossUpkeep(sim: Sim, e: number): void {
  const c = sim.c;
  if (c.flags[e]! & F.dizzy && sim.st(e).id !== sim.def(e).S.dizzy) c.flags[e]! &= ~F.dizzy;
}
