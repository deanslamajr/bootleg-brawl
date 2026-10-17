// A scripted player that produces InputFrames from the sim state. It drives golden replays,
// pacing metrics and balance envelopes. Deterministic: it reads only sim state and the tick.

import { FX } from "../math/fixed";
import type { Sim } from "./sim";
import { F, IN, KIND, PHASE, SK, SLOT, type InputFrame } from "./types";

export interface BotOptions {
  /** 0..100: how often the bot presses attack when in range. */
  aggression?: number;
  /** Uses the special when crowded. */
  specials?: boolean;
  /** Picks up food when hurt. */
  eats?: boolean;
}

export class Bot {
  private lastAttack = -100;
  private lastJump = -100;
  constructor(
    readonly slot: number,
    readonly opts: BotOptions = {},
  ) {}

  input(sim: Sim): InputFrame {
    const g = sim.g;
    const p = g.players[this.slot]!;
    const t = g.tick;
    if (p.status === SLOT.picking) return t % 30 === 0 ? IN.ATTACK : 0;
    if (p.status === SLOT.continue || p.status === SLOT.out) return t % 20 === 0 ? IN.START : 0;
    if (p.status !== SLOT.playing || p.ent < 0 || !sim.world.alive[p.ent]) return 0;
    if (g.phase === PHASE.intro || g.phase === PHASE.bossIntro || g.phase === PHASE.segmentFade)
      return 0;
    const c = sim.c;
    const e = p.ent;
    const ex = c.x[e]! / FX;
    const ey = c.y[e]! / FX;
    let input = 0;

    // Jump charging enemies and floating debris; sidestep thrown weapons by changing lane.
    let dodge = 0;
    for (let o = 0; o < sim.world.high; o++) {
      if (!sim.world.alive[o]) continue;
      const k = c.kind[o];
      const charging = (k === KIND.enemy || k === KIND.boss) && sim.st(o).tags.includes("charge");
      const shot = k === KIND.projectile && c.team[o] !== c.team[e];
      if (!charging && !shot) continue;
      const dx = c.x[o]! / FX - ex;
      const dy = c.y[o]! / FX - ey;
      const closing = (dx > 0 && c.vx[o]! < 0) || (dx < 0 && c.vx[o]! > 0);
      if (!closing || Math.abs(dx) > 60 || Math.abs(dy) > 12) continue;
      const hazard = shot && c.owner[o] === 0;
      if ((charging || hazard) && t - this.lastJump > 40 && sim.stateKind(e) === SK.free) {
        this.lastJump = t;
        return IN.JUMP | (dx > 0 ? IN.LEFT : IN.RIGHT);
      }
      if (shot) dodge = dy >= 0 ? IN.UP : IN.DOWN;
    }

    // Eat when hurt.
    if (this.opts.eats !== false && c.hp[e]! < (c.maxHp[e]! * 55) / 100) {
      const food = this.nearest(
        sim,
        e,
        (o) => c.kind[o] === KIND.pickup && sim.def(o).pickup?.kind === "food",
      );
      if (food >= 0) {
        const fx = c.x[food]! / FX;
        const fy = c.y[food]! / FX;
        if (Math.abs(fx - ex) < 10 && Math.abs(fy - ey) < 6)
          return t - this.lastAttack > 8 ? this.press(t, IN.ATTACK) : 0;
        return this.toward(ex, ey, fx, fy);
      }
    }

    const isFoe = (o: number) =>
      (c.kind[o] === KIND.enemy || c.kind[o] === KIND.boss) &&
      !(c.flags[o]! & (F.unfightable | F.hidden | F.towing)) &&
      sim.stateKind(o) !== SK.ko;
    let target = this.nearest(sim, e, isFoe);
    // During a lock, go and find whoever is holding it up.
    if (target < 0 && g.lockActive) target = this.nearest(sim, e, isFoe, true);
    if (target < 0) {
      // Nothing to fight: walk right through the level.
      if (g.lockActive) return 0;
      // Players run between fights; so does the bot.
      input = IN.RIGHT | IN.DASH;
      const nearEdge = c.x[e]! < g.camX + 200 * FX;
      if (!nearEdge && t % 90 < 30)
        input |= c.y[e]! < ((g.depthMin + g.depthMax) >> 1) * FX ? IN.DOWN : IN.UP;
      return input;
    }
    const tx = c.x[target]! / FX;
    const ty = c.y[target]! / FX;
    const dx = tx - ex;
    const dy = ty - ey;
    const range = 22 * (sim.def(e).scalePct / 100) + 6;
    const crowd = this.countNear(sim, e, 46);
    if (
      this.opts.specials !== false &&
      crowd >= 3 &&
      c.hp[e]! > 30 &&
      sim.stateKind(e) === SK.free &&
      t - this.lastAttack > 30
    ) {
      this.lastAttack = t;
      return IN.ATTACK | IN.JUMP;
    }
    if (Math.abs(dx) <= range + 6 && Math.abs(dy) <= 5) {
      const facingOk = (dx >= 0 ? 1 : -1) === c.facing[e];
      if (!facingOk) return dx >= 0 ? IN.RIGHT : IN.LEFT;
      const aggr = this.opts.aggression ?? 90;
      if (t - this.lastAttack >= 7 && (t * 7919) % 100 < aggr) return this.press(t, IN.ATTACK);
      return 0;
    }
    // Approach to the side of the target, lane first.
    const wantX = tx - (dx >= 0 ? 1 : -1) * range;
    let step = this.toward(ex, ey, wantX, ty);
    // Run at distant targets (throwers back away at walking pace).
    if (Math.abs(dx) > 90) step |= IN.DASH;
    return dodge ? (step & (IN.LEFT | IN.RIGHT | IN.DASH)) | dodge : step;
  }

  private press(t: number, bits: number): InputFrame {
    this.lastAttack = t;
    return bits;
  }

  private toward(ex: number, ey: number, x: number, y: number): InputFrame {
    let i = 0;
    if (x > ex + 3) i |= IN.RIGHT;
    else if (x < ex - 3) i |= IN.LEFT;
    if (y > ey + 2) i |= IN.DOWN;
    else if (y < ey - 2) i |= IN.UP;
    return i;
  }

  private nearest(sim: Sim, e: number, pred: (o: number) => boolean, anywhere = false): number {
    const c = sim.c;
    let best = -1;
    let bestD = Infinity;
    const cam = sim.g.camX;
    for (let o = 0; o < sim.world.high; o++) {
      if (!sim.world.alive[o] || o === e || !pred(o)) continue;
      if (!anywhere && (c.x[o]! < cam - 10 * FX || c.x[o]! > cam + 490 * FX)) continue;
      const d = Math.abs(c.x[o]! - c.x[e]!) + 2 * Math.abs(c.y[o]! - c.y[e]!);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private countNear(sim: Sim, e: number, r: number): number {
    const c = sim.c;
    let n = 0;
    for (let o = 0; o < sim.world.high; o++) {
      if (!sim.world.alive[o] || (c.kind[o] !== KIND.enemy && c.kind[o] !== KIND.boss)) continue;
      if (Math.abs(c.x[o]! - c.x[e]!) < r * FX && Math.abs(c.y[o]! - c.y[e]!) < 14 * FX) n++;
    }
    return n;
  }
}
