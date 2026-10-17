// State phase: contextual actions, data-driven transitions, locomotion, frame advance and
// frame events.

import { FX, intToFx } from "../../math/fixed";
import type { CState } from "../../content/types";
import type { Sim } from "../sim";
import { CMD, COND, F, KIND, SK, SLOT, TEAM } from "../types";
import { startGrab, releaseThrow, applyPickup, koFinished } from "./combat";

const GRAB_RANGE = 16;
const TEAMUP_RANGE = 26;

export function stateSystem(sim: Sim): void {
  const c = sim.c;
  const w = sim.world;
  const frozen = sim.actorsFrozen;
  for (let e = 0; e < w.high; e++) {
    if (!w.alive[e]) continue;
    const kind = c.kind[e]!;
    if (c.hitstop[e]! > 0) {
      c.hitstop[e] = c.hitstop[e]! - 1;
      continue;
    }
    if (c.invuln[e]! > 0) c.invuln[e] = c.invuln[e]! - 1;
    const actor =
      kind === KIND.player || kind === KIND.enemy || kind === KIND.boss || kind === KIND.civilian;
    if (actor) {
      if (frozen && sim.stateKind(e) !== SK.ko) continue;
      if (c.tiny[e]! > 0) {
        c.tiny[e] = c.tiny[e]! - 1;
        if (c.tiny[e] === 0) sim.emit({ t: "tiny", ent: e, on: false });
      }
      contextual(sim, e);
      if (!w.alive[e]) continue;
      transitions(sim, e);
      locomotion(sim, e);
    }
    advance(sim, e);
  }
}

function cond(sim: Sim, e: number, id: number): boolean {
  const c = sim.c;
  switch (id) {
    case COND.none:
      return true;
    case COND.hasWeapon:
      return c.weapon[e]! > 0 && c.kind[e] === KIND.player;
    case COND.noWeapon:
      return c.weapon[e]! === 0 || c.kind[e] !== KIND.player;
    case COND.hasImprovised:
      return c.impro[e]! > 0;
    case COND.noImprovised:
      return c.impro[e]! === 0;
    case COND["grabCount<2"]:
      return c.grabCount[e]! < 2;
    case COND["grabCount>=2"]:
      return c.grabCount[e]! >= 2;
    case COND.inAir:
      return c.z[e]! > 0;
    case COND.onGround:
      return c.z[e]! <= 0;
    case COND.charged:
      return (sim.g.flags[`charge:${e}`] ?? 0) > 0;
    default:
      return false;
  }
}

function transitions(sim: Sim, e: number): void {
  const c = sim.c;
  const cmd = c.cmd[e]!;
  if (cmd === 0) return;
  const s = sim.st(e);
  const t = c.stick[e]!;
  for (const tr of s.transitions) {
    if (!(cmd & tr.cmd)) continue;
    if (t < tr.from || t > tr.until) continue;
    if (!cond(sim, e, tr.cond)) continue;
    const d = sim.def(e);
    const wasGround = c.z[e]! <= 0;
    sim.enterState(e, tr.to);
    if (c.state[e] === d.S.jump && wasGround) {
      c.vz[e] = d.jumpVel;
      c.z[e] = 1;
      // Running jumps keep their speed; standing jumps drift with the stick.
      if (!c.run[e]) c.vx[e] = (c.mx[e]! * d.walk * 9) / 10;
    }
    if (tr.cmd & (CMD.throwF | CMD.throwB) && c.grab[e]) c.grabTimer[e] = 0xffff;
    return;
  }
}

function contextual(sim: Sim, e: number): void {
  const c = sim.c;
  const s = sim.st(e);
  if (s.kind !== SK.free) return;
  const cmd = c.cmd[e]!;
  const d = sim.def(e);
  const isPlayer = c.kind[e] === KIND.player;

  if (isPlayer && cmd & CMD.attack && !(cmd & CMD.back)) {
    const item = findPickup(sim, e, 16, 9);
    if (item >= 0 && d.S.pickup >= 0) {
      sim.enterState(e, d.S.pickup);
      applyPickup(sim, e, item);
      c.cmd[e] = 0;
      return;
    }
    const downed = findDowned(sim, e);
    const stomp = d.stateIndex.stomp;
    if (downed >= 0 && stomp !== undefined) {
      sim.enterState(e, stomp);
      c.cmd[e] = 0;
      return;
    }
  }
  if (isPlayer && cmd & CMD.taunt) {
    if (tryTeamUp(sim, e)) {
      c.cmd[e] = 0;
      return;
    }
  }
  // Walking into a dazed or light opponent grabs it.
  const canGrab = isPlayer || c.ai[e] === 2;
  if (canGrab && d.S.grab >= 0 && c.mx[e] !== 0 && c.mx[e] === c.facing[e] && c.z[e]! <= 0) {
    const t = findGrabbable(sim, e);
    if (t >= 0) startGrab(sim, e, t);
  }
}

export function findPickup(sim: Sim, e: number, rx: number, ry: number): number {
  const c = sim.c;
  const w = sim.world;
  let best = -1;
  let bestD = 1e9;
  for (let p = 0; p < w.high; p++) {
    if (!w.alive[p] || c.kind[p] !== KIND.pickup || c.z[p]! > intToFx(4)) continue;
    const dx = Math.abs(c.x[p]! - c.x[e]!) / FX;
    const dy = Math.abs(c.y[p]! - c.y[e]!) / FX;
    if (dx <= rx && dy <= ry && dx + dy < bestD) {
      best = p;
      bestD = dx + dy;
    }
  }
  return best;
}

function findDowned(sim: Sim, e: number): number {
  const c = sim.c;
  const w = sim.world;
  const f = c.facing[e]!;
  for (let t = 0; t < w.high; t++) {
    if (!w.alive[t] || t === e || !sim.isActor(t) || c.team[t] === c.team[e]) continue;
    if (sim.stateKind(t) !== SK.down) continue;
    const dx = ((c.x[t]! - c.x[e]!) / FX) * f;
    const dy = Math.abs(c.y[t]! - c.y[e]!) / FX;
    if (dx >= -6 && dx <= 34 && dy <= 10) return t;
  }
  return -1;
}

function findGrabbable(sim: Sim, e: number): number {
  const c = sim.c;
  const w = sim.world;
  const f = c.facing[e]!;
  const range = Math.trunc((GRAB_RANGE * sim.def(e).scalePct) / 100) + 4;
  for (let t = 0; t < w.high; t++) {
    if (!w.alive[t] || t === e || !sim.isActor(t)) continue;
    if (c.team[t] === c.team[e] || c.team[t] === TEAM.neutral) continue;
    if (c.grab[t] || c.z[t]! > 0 || c.invuln[t]! > 0) continue;
    const k = sim.stateKind(t);
    const isPlayerTarget = c.kind[t] === KIND.player;
    if (!isPlayerTarget) {
      if (!(c.flags[t]! & F.grabbable)) continue;
      if (!(c.flags[t]! & F.light) && k !== SK.hurt) continue;
    } else if (c.kind[e] === KIND.player) continue;
    if (k !== SK.free && k !== SK.hurt) continue;
    const dx = ((c.x[t]! - c.x[e]!) / FX) * f;
    const dy = Math.abs(c.y[t]! - c.y[e]!) / FX;
    if (dx > 0 && dx <= range && dy <= 6) return t;
  }
  return -1;
}

function tryTeamUp(sim: Sim, a: number): boolean {
  const c = sim.c;
  const da = sim.def(a);
  for (const b of sim.playerEntities()) {
    if (b === a || sim.stateKind(b) !== SK.free || c.z[b]! > 0) continue;
    const dx = Math.abs(c.x[b]! - c.x[a]!) / FX;
    const dy = Math.abs(c.y[b]! - c.y[a]!) / FX;
    if (dx > TEAMUP_RANGE || dy > 10) continue;
    const db = sim.def(b);
    let initiator = a;
    let partner = b;
    let move = da.player?.teamUps.find((t) => t.partner === db.id);
    if (!move) {
      const rev = db.player?.teamUps.find((t) => t.partner === da.id && t.both);
      if (rev) {
        move = rev;
        initiator = b;
        partner = a;
      }
    }
    const di = sim.def(initiator);
    const stateId = move ? move.state : (di.stateIndex.teamToss ?? -1);
    if (stateId < 0) return false;
    const st = di.states[stateId]!;
    sim.enterState(initiator, stateId);
    const dp = sim.def(partner);
    c.facing[partner] = c.facing[initiator]!;
    if (st.tags.includes("teamCloud")) {
      if (dp.S.teamCloud >= 0) sim.enterState(partner, dp.S.teamCloud);
      // Both siblings vanish into the cloud until the move ends.
      c.flags[partner]! |= F.hidden;
      c.flags[initiator]! |= F.hidden;
    } else if (dp.S.teamPartnerToss >= 0) {
      sim.enterState(partner, dp.S.teamPartnerToss);
      c.grab[initiator] = partner + 1;
      c.grab[partner] = initiator + 1;
    }
    sim.text(move ? move.displayName.toUpperCase() : "SHOULDER TOSS!", "big", initiator, 70);
    sim.sfx("teamup", initiator);
    return true;
  }
  return false;
}

function locomotion(sim: Sim, e: number): void {
  const c = sim.c;
  const s = sim.st(e);
  if (s.kind !== SK.free) return;
  const d = sim.def(e);
  const S = d.S;
  const isPlayer = c.kind[e] === KIND.player;
  const mx = c.mx[e]!;
  const my = c.my[e]!;
  if (isPlayer && mx !== 0 && mx !== c.facing[e] && (c.awayHeld[e]! >= 3 || c.run[e]))
    c.facing[e] = mx;
  if (s.id !== S.idle && s.id !== S.walk && s.id !== S.run && s.id !== S.sleep) return;
  if (s.id === S.sleep) {
    if (mx === 0 && my === 0 && c.cmd[e] === 0) return;
    c.idle[e] = 0;
  }
  let want = S.idle;
  if (c.run[e] && mx !== 0 && S.run >= 0) want = S.run;
  else if ((mx !== 0 || my !== 0) && S.walk >= 0) want = S.walk;
  if (want < 0) want = S.idle;
  if (want === S.idle && isPlayer) {
    c.idle[e] = Math.min(0xffff, c.idle[e]! + 1);
    if (S.sleep >= 0 && c.idle[e]! > 420 && d.player?.gags.includes("sleepIdle")) {
      sim.enterState(e, S.sleep);
      sim.text("ZZZ", "bubble", e, 90);
      return;
    }
  } else c.idle[e] = 0;
  if (want !== s.id) {
    // Keep the walk cycle phase when switching between walk and run.
    const keep = c.stick[e]!;
    sim.enterState(e, want);
    if (want !== S.idle) c.stick[e] = keep % Math.max(1, d.states[want]!.total);
  }
}

function advance(sim: Sim, e: number): void {
  const c = sim.c;
  const d = sim.def(e);
  const s = d.states[c.state[e]!];
  if (!s) return;
  const t = c.stick[e]!;
  fireFrame(sim, e, s, t);
  if (!sim.world.alive[e] || c.state[e] !== s.id || c.stick[e] !== t) return;
  const nt = t + 1;
  if (s.kind === SK.hurt) {
    if (c.stun[e]! > 0) {
      c.stun[e] = c.stun[e]! - 1;
      c.stick[e] = nt >= s.total ? 0 : nt;
      return;
    }
    sim.enterState(e, s.next);
    return;
  }
  if (s.kind === SK.grab || s.kind === SK.grabbed) {
    // Holds loop until the grab ends; the grabber side owns the timer.
    c.stick[e] = nt >= s.total ? 0 : nt;
    return;
  }
  if (nt < s.total) {
    c.stick[e] = nt;
    return;
  }
  if (s.loop) {
    c.stick[e] = 0;
    return;
  }
  if (s.gravity && c.z[e]! > 0) {
    // Air states hold their last frame until landing.
    c.stick[e] = s.total - 1;
    return;
  }
  endState(sim, e, s);
}

function endState(sim: Sim, e: number, s: CState): void {
  const c = sim.c;
  const d = sim.def(e);
  switch (s.kind) {
    case SK.ko:
      koFinished(sim, e);
      return;
    case SK.down:
      sim.enterState(e, d.S.getup >= 0 ? d.S.getup : d.S.idle);
      c.invuln[e] = 24;
      return;
    case SK.getup:
      sim.enterState(e, s.next);
      c.invuln[e] = 30;
      return;
    case SK.throw:
      if (c.grab[e]) releaseThrow(sim, e, s);
      sim.enterState(e, s.next);
      return;
    case SK.teamup:
      if (s.tags.includes("teamCloud")) {
        c.flags[e]! &= ~F.hidden;
        for (const p of sim.playerEntities()) {
          if (sim.st(p).id === sim.def(p).S.teamCloud) {
            c.flags[p]! &= ~F.hidden;
            sim.enterState(p, sim.def(p).S.idle);
          }
        }
      }
      if (c.grab[e]) releaseThrow(sim, e, s);
      sim.enterState(e, s.next);
      return;
    default:
      if (c.kind[e] === KIND.projectile && s.kind === SK.misc) {
        sim.despawn(e);
        return;
      }
      sim.enterState(e, s.next);
  }
}

function fireFrame(sim: Sim, e: number, s: CState, t: number): void {
  const c = sim.c;
  const fi = s.frameAt[t < s.total ? t : s.total - 1]!;
  const f = s.frames[fi]!;
  if (t === f.start) {
    const fac = c.facing[e]!;
    if (f.velX !== null) c.vx[e] = (fac * f.velX * (c.tiny[e] ? 2 : 1)) | 0;
    if (f.velZ !== null) {
      c.vz[e] = f.velZ;
      if (f.velZ > 0 && c.z[e]! <= 0) c.z[e] = 1;
    }
  }
  for (const frame of s.frames) {
    for (const ev of frame.events) {
      if (ev.at !== t) continue;
      if (ev.sfx) sim.sfx(ev.sfx, e);
      if (ev.shake) sim.emit({ t: "shake", ticks: ev.shake });
      if (ev.flash) sim.emit({ t: "flash", ticks: 4 });
      if (ev.text) sim.text(ev.text, "pop", e, 60);
      if (ev.spawn) {
        const fac = c.facing[e]!;
        const scale = c.tiny[e] ? 50 : 100;
        sim.spawnProjectile(
          ev.spawn.projectile,
          e,
          c.x[e]! + intToFx((fac * ev.spawn.ox * scale) / 100),
          c.y[e]! + 1,
          c.z[e]! + intToFx((ev.spawn.oz * scale) / 100),
          fac * ev.spawn.vx,
          ev.spawn.vz,
          fac,
        );
      }
      if (ev.release) {
        const v = c.grab[e]! - 1;
        let handled = false;
        if (v >= 0)
          for (const m of sim.modules) if (m.hooks?.onRelease?.(sim, e, v, s.name)) handled = true;
        if (!handled) releaseThrow(sim, e, s);
      }
      if (ev.signal) {
        for (const m of sim.modules) m.hooks?.onSignal?.(sim, e, ev.signal);
        coreSignal(sim, e, ev.signal);
      }
    }
  }
}

/** Signals the core understands; unknown signals are left to modules. */
function coreSignal(sim: Sim, e: number, signal: string): void {
  const c = sim.c;
  if (signal === "taunt") {
    const d = sim.def(e);
    const lines = d.player?.voice.tauntLines ?? [];
    if (lines.length) sim.text(lines[(sim.g.tick >> 3) % lines.length]!, "bubble", e, 90);
    return;
  }
  if (signal === "wake") {
    c.idle[e] = 0;
    return;
  }
  if (signal === "slotCheck") {
    const slot = sim.playerSlotOf(e);
    if (slot >= 0 && sim.g.players[slot]!.status !== SLOT.playing) sim.despawn(e);
  }
}
