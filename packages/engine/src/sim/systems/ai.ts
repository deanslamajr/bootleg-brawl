// AI phase: enemy behaviours by family kind, attack tokens so only a few enemies swing at once,
// and the boss pattern runner.

import { intToFx } from "../../math/fixed";
import type { Sim } from "../sim";
import { CMD, F, KIND, SK } from "../types";
import { bossThink, bossUpkeep } from "./bosses";

export const AI = {
  none: 0,
  brawler: 1,
  grabber: 2,
  thrower: 3,
  charger: 4,
  acrobat: 5,
  swarm: 6,
  civilian: 7,
  dummy: 8,
  boss: 9,
} as const;

const AI_BY_NAME: Record<string, number> = AI;

export function aiSystem(sim: Sim): void {
  const c = sim.c;
  const w = sim.world;
  const frozen = sim.actorsFrozen;
  for (let e = 0; e < w.high; e++) {
    if (!w.alive[e]) continue;
    const kind = c.kind[e]!;
    if (kind !== KIND.enemy && kind !== KIND.boss && kind !== KIND.civilian) continue;
    c.cmd[e] = 0;
    if (c.ai[e] === AI.none) {
      const d = sim.def(e);
      c.ai[e] = d.boss ? AI.boss : (AI_BY_NAME[d.enemy?.ai ?? "brawler"] ?? AI.brawler);
      c.aiCool[e] = 20 + sim.rng.int(40);
      c.aiSide[e] = sim.rng.chance(50) ? 1 : -1;
    }
    if (frozen || c.hitstop[e]! > 0 || c.flags[e]! & F.emerging) {
      c.mx[e] = 0;
      c.my[e] = 0;
      continue;
    }
    if (c.comboTimer[e]! > 0) c.comboTimer[e] = c.comboTimer[e]! - 1;
    const ai = c.ai[e]!;
    if (ai === AI.boss) {
      bossUpkeep(sim, e);
      bossThink(sim, e);
      continue;
    }
    const custom = sim.def(e).enemy?.ai;
    let handled = false;
    for (const m of sim.modules) {
      const fn = custom ? m.aiKinds?.[custom] : undefined;
      if (fn) {
        fn(sim, e);
        handled = true;
        break;
      }
    }
    if (handled) continue;
    // Dummies (sandbox targets, cutscene actors) are steered by whoever owns them.
    if (ai === AI.dummy) continue;
    think(sim, e, ai);
  }
  // Player-side counters that tick regardless of input.
  for (const e of sim.playerEntities()) {
    if (c.comboTimer[e]! > 0) c.comboTimer[e] = c.comboTimer[e]! - 1;
    if (c.strainTimer[e]! > 0) {
      c.strainTimer[e] = c.strainTimer[e]! - 1;
      if (c.strainTimer[e] === 0) c.strain[e] = 0;
    }
  }
}

function maxAttackers(sim: Sim): number {
  return Math.min(4, 1 + sim.activePlayerCount());
}

function releaseToken(sim: Sim, e: number, cool: number): void {
  const c = sim.c;
  if (c.aiToken[e]) {
    c.aiToken[e] = 0;
    sim.g.attackers = Math.max(0, sim.g.attackers - 1);
  }
  c.aiCool[e] = cool;
}

function pickTarget(sim: Sim, e: number): number {
  const c = sim.c;
  const cur = c.aiTarget[e]! - 1;
  const players = sim.targetablePlayers();
  if (players.length === 0) return -1;
  if (cur >= 0 && players.includes(cur) && (sim.g.tick + e) % 90 !== 0) return cur;
  let best = players[0]!;
  let bestD = Infinity;
  for (const p of players) {
    // Spread out: prefer players fewer enemies are already targeting.
    let crowd = 0;
    for (let o = 0; o < sim.world.high; o++)
      if (o !== e && sim.world.alive[o] && c.aiTarget[o] === p + 1) crowd++;
    const d =
      (Math.abs(c.x[p]! - c.x[e]!) >> 16) + 2 * (Math.abs(c.y[p]! - c.y[e]!) >> 16) + crowd * 40;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  c.aiTarget[e] = best + 1;
  return best;
}

function attackFromTier(sim: Sim, e: number, pool: number[]): number {
  const c = sim.c;
  const d = sim.def(e);
  const tier = d.enemy!.tiers[Math.min(c.tier[e]!, d.enemy!.tiers.length - 1)]!;
  const allowed = pool.filter((s) => tier.moves.includes(s));
  if (allowed.length === 0) return -1;
  return allowed[sim.rng.int(allowed.length)]!;
}

function think(sim: Sim, e: number, ai: number): void {
  const c = sim.c;
  const d = sim.def(e);
  const en = d.enemy!;
  const params = en.aiParams;
  const kind = sim.stateKind(e);

  if (kind === SK.grab) {
    c.mx[e] = 0;
    c.my[e] = 0;
    c.aiTimer[e] = c.aiTimer[e]! + 1;
    // Hold the victim for the others, pummel, then throw.
    if (c.aiTimer[e]! % 40 === 39) {
      const hit = d.stateIndex.grabHit;
      if (c.grabCount[e]! < 2 && hit !== undefined && !(c.aiTimer[e]! < 80 && sim.rng.chance(50)))
        sim.enterState(e, hit);
      else if (c.grabCount[e]! >= 2 && d.S.throwF >= 0) sim.enterState(e, d.S.throwF);
    }
    return;
  }
  if (kind !== SK.free) {
    c.mx[e] = 0;
    c.my[e] = 0;
    return;
  }
  c.aiTimer[e] = 0;

  const t = pickTarget(sim, e);
  if (t < 0) {
    c.mx[e] = 0;
    c.my[e] = 0;
    if (c.aiToken[e]) releaseToken(sim, e, 30);
    return;
  }
  const dxPx = (c.x[t]! - c.x[e]!) >> 16;
  const dyPx = (c.y[t]! - c.y[e]!) >> 16;
  const adx = Math.abs(dxPx);
  const ady = Math.abs(dyPx);
  c.facing[e] = dxPx >= 0 ? 1 : -1;
  if (c.aiCool[e]! > 0) c.aiCool[e] = c.aiCool[e]! - 1;
  const tier = en.tiers[Math.min(c.tier[e]!, en.tiers.length - 1)]!;
  const aggression = Math.min(95, params.aggression + tier.aggression);
  const targetDown = sim.stateKind(t) === SK.down;

  if (ai === AI.swarm) {
    c.run[e] = 1;
    if (adx <= params.range && ady <= 4 && c.aiCool[e] === 0) {
      const atk = attackFromTier(sim, e, en.attackStates);
      if (atk >= 0) sim.enterState(e, atk);
      c.aiCool[e] = 30 + sim.rng.int(30);
      return;
    }
    if (c.aiCool[e]! > 20) {
      c.mx[e] = -c.facing[e]!;
      c.my[e] = 0;
      return;
    }
    c.mx[e] = dxPx > 2 ? 1 : dxPx < -2 ? -1 : 0;
    c.my[e] = dyPx > 2 ? 1 : dyPx < -2 ? -1 : 0;
    return;
  }

  // Mount-and-pummel a downed player when this tier knows how.
  const mount = d.stateIndex.mount;
  if (targetDown && mount !== undefined && tier.moves.includes(mount)) {
    if (adx <= 10 && ady <= 4) {
      sim.enterState(e, mount);
      return;
    }
    c.mx[e] = dxPx > 2 ? 1 : dxPx < -2 ? -1 : 0;
    c.my[e] = dyPx > 2 ? 1 : dyPx < -2 ? -1 : 0;
    return;
  }

  if (ai === AI.thrower && en.rangedState >= 0) {
    // Close to throwing range first; nobody throws from off screen.
    if (adx > params.rangedMin + 60 || !(c.flags[e]! & F.entered)) {
      c.mx[e] = dxPx > 0 ? 1 : -1;
      c.my[e] = dyPx > 3 ? 1 : dyPx < -3 ? -1 : 0;
      return;
    }
    if (adx < params.rangedMin - 20) {
      // Back away at a hesitant pace so a determined player can close the gap.
      c.mx[e] = (sim.g.tick + e) % 3 === 0 ? 0 : dxPx > 0 ? -1 : 1;
      c.my[e] = dyPx > 3 ? 1 : dyPx < -3 ? -1 : 0;
      if (adx < params.range + 4 && ady <= 4 && c.aiCool[e] === 0 && sim.rng.chance(aggression)) {
        const atk = attackFromTier(sim, e, en.attackStates);
        if (atk >= 0) sim.enterState(e, atk);
        c.aiCool[e] = 50;
      }
      return;
    }
    if (ady > 3) {
      c.mx[e] = 0;
      c.my[e] = dyPx > 0 ? 1 : -1;
      return;
    }
    c.mx[e] = 0;
    c.my[e] = 0;
    if (c.aiCool[e] === 0 && tier.moves.includes(en.rangedState)) {
      sim.enterState(e, en.rangedState);
      c.aiCool[e] = 80 + sim.rng.int(50);
    }
    return;
  }

  if (ai === AI.charger && en.chargeState >= 0 && tier.moves.includes(en.chargeState)) {
    if (c.aiCool[e] === 0 && adx > 70 && ady <= 4) {
      sim.enterState(e, en.chargeState);
      c.aiCool[e] = 110 + sim.rng.int(60);
      return;
    }
    if (c.aiCool[e] === 0 && adx <= 70) {
      c.mx[e] = dxPx > 0 ? -1 : 1;
      c.my[e] = dyPx > 2 ? 1 : dyPx < -2 ? -1 : 0;
      return;
    }
  }

  if (ai === AI.acrobat) {
    const flip = d.stateIndex.flip;
    if (
      flip !== undefined &&
      tier.moves.includes(flip) &&
      c.aiCool[e] === 0 &&
      adx > 30 &&
      adx < 80 &&
      ady <= 5
    ) {
      sim.enterState(e, flip);
      c.aiCool[e] = 70;
      return;
    }
  }

  const tokens = maxAttackers(sim);
  if (
    !c.aiToken[e] &&
    c.aiCool[e] === 0 &&
    sim.g.attackers < tokens &&
    sim.rng.chance(aggression)
  ) {
    c.aiToken[e] = 1;
    sim.g.attackers++;
    c.aiSide[e] = c.x[e]! >= c.x[t]! ? 1 : -1;
  }

  if (c.aiToken[e]) {
    const range = Math.trunc((params.range * d.scalePct) / 100);
    const wantX = c.x[t]! + c.aiSide[e]! * intToFx(range);
    const wdx = (wantX - c.x[e]!) >> 16;
    if (Math.abs(wdx) <= 6 && ady <= 3) {
      c.mx[e] = 0;
      c.my[e] = 0;
      if (ai === AI.grabber) {
        // Grabbers step into the target; the contextual grab check does the rest.
        c.mx[e] = c.facing[e]!;
        if (adx > range + 6 || sim.rng.chance(20)) {
          const atk = attackFromTier(sim, e, en.attackStates);
          if (atk >= 0) sim.enterState(e, atk);
          releaseToken(sim, e, 50 + sim.rng.int(40));
        }
        return;
      }
      const atk = attackFromTier(sim, e, en.attackStates);
      if (atk >= 0) {
        sim.enterState(e, atk);
        c.cmd[e] = CMD.attack;
      }
      releaseToken(sim, e, 36 + sim.rng.int(50));
      return;
    }
    c.mx[e] = wdx > 3 ? 1 : wdx < -3 ? -1 : 0;
    c.my[e] = dyPx > 2 ? 1 : dyPx < -2 ? -1 : 0;
    c.facing[e] = dxPx >= 0 ? 1 : -1;
    if (sim.g.tick % 240 === e % 240) releaseToken(sim, e, 20);
    return;
  }

  // No token: hover at a distance on a side, drifting so the crowd does not stack.
  const hover = params.hover + ((e * 13) % 30);
  const wantX = c.x[t]! + c.aiSide[e]! * intToFx(hover);
  const offset = ((e * 7) % 3) - 1;
  const wantY = c.y[t]! + intToFx(offset * 12);
  const wdx = (wantX - c.x[e]!) >> 16;
  const wdy = (wantY - c.y[e]!) >> 16;
  c.mx[e] = wdx > 8 ? 1 : wdx < -8 ? -1 : 0;
  c.my[e] = wdy > 4 ? 1 : wdy < -4 ? -1 : 0;
  c.facing[e] = dxPx >= 0 ? 1 : -1;
  if (sim.g.tick % 120 === (e * 17) % 120 && sim.rng.chance(30)) c.aiSide[e] = -c.aiSide[e]!;
  if (params.jumpChance > 0 && sim.rng.int(1000) < params.jumpChance && d.S.jump >= 0) {
    sim.enterState(e, d.S.jump);
    c.vz[e] = d.jumpVel;
    c.z[e] = 1;
  }
}
