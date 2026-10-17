// Movement (locomotion, knockback, gravity, landing, bounds), collision (separation and grab
// attachment) and the shared camera.

import { FX, approachZero, intToFx } from "../../math/fixed";
import type { Sim } from "../sim";
import { F, GRAVITY, KIND, PHASE, SK, VIEW_W } from "../types";
import { breakGrab, landThrown } from "./combat";

const EDGE = 10;

export function movementSystem(sim: Sim): void {
  const c = sim.c;
  const w = sim.world;
  const frozen = sim.actorsFrozen;
  for (let e = 0; e < w.high; e++) {
    if (!w.alive[e] || c.hitstop[e]! > 0) continue;
    const kind = c.kind[e]!;
    if (kind === KIND.projectile) {
      moveProjectile(sim, e);
      continue;
    }
    if (kind === KIND.pickup) {
      movePickup(sim, e);
      continue;
    }
    if (kind === KIND.prop || kind === KIND.hazard) continue;
    if (frozen && sim.stateKind(e) !== SK.ko) continue;
    let provided = false;
    for (const m of sim.modules) {
      const providers = m.movementProviders;
      if (!providers) continue;
      for (const key in providers) {
        if (sim.world.has(key) && sim.world.get(key)[e]) {
          provided = providers[key]!(sim, e) || provided;
        }
      }
    }
    if (provided) continue;
    moveActor(sim, e);
  }
}

function speedPct(sim: Sim, e: number): number {
  const c = sim.c;
  const d = sim.def(e);
  let pct = 100;
  if (d.enemy) pct = d.enemy.tiers[Math.min(c.tier[e]!, d.enemy.tiers.length - 1)]!.speedPct;
  if (c.tiny[e]) pct *= 2;
  return pct;
}

function moveActor(sim: Sim, e: number): void {
  const c = sim.c;
  const s = sim.st(e);
  const d = sim.def(e);
  // Held entities are positioned by their holder in the collision phase.
  if (s.kind === SK.grabbed || (s.id === d.S.teamPartnerToss && c.grab[e])) return;
  const onGround = c.z[e]! <= 0 && c.vz[e]! <= 0;
  if (s.move > 0) {
    const pct = speedPct(sim, e);
    if (s.id === d.S.run && c.run[e]) {
      c.vx[e] = Math.trunc((c.facing[e]! * d.runSpeed * pct) / 100);
    } else {
      c.vx[e] = Math.trunc((c.mx[e]! * d.walk * s.move * pct) / 10000);
    }
    c.vy[e] = s.moveY ? Math.trunc((c.my[e]! * d.walkY * s.move * pct) / 10000) : 0;
  } else if (onGround) {
    c.vx[e] = approachZero(c.vx[e]!, s.friction);
    c.vy[e] = 0;
  } else {
    c.vy[e] = 0;
  }
  c.x[e] = c.x[e]! + c.vx[e]!;
  c.y[e] = c.y[e]! + c.vy[e]!;
  if (c.z[e]! > 0 || c.vz[e]! > 0) {
    if (!(c.flags[e]! & F.noGravity)) c.vz[e] = c.vz[e]! - GRAVITY;
    c.z[e] = c.z[e]! + c.vz[e]!;
    if (c.z[e]! <= 0) {
      c.z[e] = 0;
      const vz = c.vz[e]!;
      c.vz[e] = 0;
      land(sim, e, vz);
    }
  }
  clampActor(sim, e);
}

function land(sim: Sim, e: number, impactVz: number): void {
  const c = sim.c;
  const d = sim.def(e);
  const s = sim.st(e);
  if (c.flags[e]! & F.thrownBody) {
    landThrown(sim, e);
    return;
  }
  if (c.flags[e]! & F.teamFly) {
    c.flags[e]! &= ~F.teamFly;
    sim.enterState(e, d.S.land >= 0 ? d.S.land : d.S.idle);
    return;
  }
  if (s.kind === SK.fall || s.kind === SK.thrown || s.kind === SK.hurt) {
    if (!(c.juggle[e]! & 0x80) && impactVz < -intToFx(2)) {
      c.juggle[e] = c.juggle[e]! | 0x80;
      c.vz[e] = intToFx(1) + (FX >> 1);
      c.z[e] = 1;
      c.vx[e] = (c.vx[e]! * 2) / 3;
      sim.emit({ t: "shake", ticks: 3 });
      sim.sfx("land", e);
      if (s.kind !== SK.fall && d.S.fall >= 0) sim.enterState(e, d.S.fall);
      return;
    }
    c.juggle[e] = 0;
    c.vx[e] = 0;
    if (c.hp[e]! <= 0 && d.S.ko >= 0) sim.enterState(e, d.S.ko);
    else sim.enterState(e, d.S.down >= 0 ? d.S.down : d.S.idle);
    return;
  }
  if (s.landTo >= 0) {
    sim.enterState(e, s.landTo);
    return;
  }
  if (s.kind === SK.air || s.kind === SK.special || s.kind === SK.attack || s.kind === SK.teamup) {
    sim.enterState(e, d.S.land >= 0 ? d.S.land : d.S.idle);
    sim.sfx("land", e);
  }
}

function clampActor(sim: Sim, e: number): void {
  const c = sim.c;
  const g = sim.g;
  const xPx = c.x[e]! >> 16;
  const [dmin, dmax] = sim.depthAt(xPx);
  const ymin = intToFx(dmin);
  const ymax = intToFx(dmax);
  if (c.y[e]! < ymin) c.y[e] = ymin;
  if (c.y[e]! > ymax) c.y[e] = ymax;
  const kind = c.kind[e]!;
  if (kind === KIND.player) {
    const lo = g.camX + intToFx(EDGE);
    const hi = g.camX + intToFx(VIEW_W - EDGE);
    if (c.x[e]! < lo) c.x[e] = lo;
    if (c.x[e]! > hi) c.x[e] = hi;
  } else if (c.flags[e]! & F.thrownBody) {
    // Thrown bodies rebound off the screen edges so they stay in play.
    const lo = g.camX + intToFx(4);
    const hi = g.camX + intToFx(VIEW_W - 4);
    if ((c.x[e]! < lo && c.vx[e]! < 0) || (c.x[e]! > hi && c.vx[e]! > 0)) {
      c.vx[e] = -Math.trunc(c.vx[e]! / 2);
      sim.emit({ t: "shake", ticks: 2 });
    }
  } else {
    const lo = -intToFx(120);
    const hi = intToFx(g.segLen + 120);
    if (c.x[e]! < lo) c.x[e] = lo;
    if (c.x[e]! > hi) c.x[e] = hi;
    // Enemies that walked into view stay in view while the camera is locked, so nobody can
    // camp off screen and hold a scroll lock forever.
    if (kind === KIND.enemy || kind === KIND.boss) {
      const vlo = g.camX + intToFx(12);
      const vhi = g.camX + intToFx(VIEW_W - 12);
      if (!(c.flags[e]! & F.entered)) {
        if (c.x[e]! >= vlo && c.x[e]! <= vhi) c.flags[e]! |= F.entered;
      } else if (g.lockActive || g.phase === PHASE.boss) {
        if (c.x[e]! < vlo) c.x[e] = vlo;
        if (c.x[e]! > vhi) c.x[e] = vhi;
      }
    }
  }
}

function moveProjectile(sim: Sim, e: number): void {
  const c = sim.c;
  const p = sim.def(e).projectile!;
  if (c.flags[e]! & F.hidden) return;
  c.x[e] = c.x[e]! + c.vx[e]!;
  c.y[e] = c.y[e]! + c.vy[e]!;
  if (p.gravity !== 0 || c.vz[e] !== 0) {
    c.vz[e] = c.vz[e]! - p.gravity;
    c.z[e] = c.z[e]! + c.vz[e]!;
    if (c.z[e]! <= 0 && p.gravity !== 0) {
      c.z[e] = 0;
      if (p.dropsPickup >= 0) sim.spawnPickup(p.dropsPickup, c.x[e]!, c.y[e]!, 0, 0, 0);
      sim.despawn(e);
      return;
    }
  }
  if (c.life[e]! > 0) {
    c.life[e] = c.life[e]! - 1;
    if (c.life[e] === 0) {
      sim.despawn(e);
      return;
    }
  }
  const xPx = c.x[e]! >> 16;
  const cam = sim.g.camX >> 16;
  if (xPx < cam - 80 || xPx > cam + VIEW_W + 80) sim.despawn(e);
}

function movePickup(sim: Sim, e: number): void {
  const c = sim.c;
  if (c.z[e]! > 0 || c.vz[e]! > 0) {
    c.vz[e] = c.vz[e]! - GRAVITY;
    c.z[e] = c.z[e]! + c.vz[e]!;
    c.x[e] = c.x[e]! + c.vx[e]!;
    if (c.z[e]! <= 0) {
      c.z[e] = 0;
      if (c.vz[e]! < -intToFx(1)) c.vz[e] = -Math.trunc(c.vz[e]! / 3);
      else c.vz[e] = 0;
      c.vx[e] = Math.trunc(c.vx[e]! / 2);
    }
  }
  const [dmin, dmax] = sim.depthAt(c.x[e]! >> 16);
  if (c.y[e]! < intToFx(dmin)) c.y[e] = intToFx(dmin);
  if (c.y[e]! > intToFx(dmax)) c.y[e] = intToFx(dmax);
  if (sim.def(e).pickup!.lifetime > 0) {
    c.life[e] = Math.max(0, c.life[e]! - 1);
    if (c.life[e] === 0) sim.despawn(e);
  }
}

export function collisionSystem(sim: Sim): void {
  const c = sim.c;
  const w = sim.world;
  // Grab attachment and the grab timer.
  for (let e = 0; e < w.high; e++) {
    if (!w.alive[e] || !c.grab[e] || !sim.isActor(e)) continue;
    const v = c.grab[e]! - 1;
    if (!w.alive[v]) {
      c.grab[e] = 0;
      continue;
    }
    const sk = sim.stateKind(e);
    const holder = sim.isHolding(e);
    const vk = sim.stateKind(v);
    if (holder) {
      if (c.grab[v] !== e + 1) {
        c.grab[e] = 0;
        continue;
      }
      const d = sim.def(e);
      const dist = intToFx(Math.trunc((14 * d.scalePct) / 100) + 4);
      if (sim.st(e).tags.includes("teamToss")) {
        c.x[v] = c.x[e]!;
        c.y[v] = c.y[e]! + 1;
        c.z[v] = c.z[e]! + intToFx(Math.trunc((40 * d.scalePct) / 100));
      } else {
        c.x[v] = c.x[e]! + c.facing[e]! * dist;
        c.y[v] = c.y[e]! + 1;
        c.z[v] = c.z[e]!;
        c.facing[v] = -c.facing[e]!;
      }
      c.vx[v] = 0;
      c.vz[v] = 0;
      if (sk === SK.grab && !sim.actorsFrozen) {
        let t = c.grabTimer[e]!;
        // A held player mashes to break free.
        if (c.kind[v] === KIND.player) {
          const slot = sim.playerSlotOf(v);
          const p = sim.g.players[slot];
          if (p) {
            const inp = sim.inputs[slot] ?? 0;
            const pressed = inp & ~p.prevIn;
            let n = 0;
            for (let b = pressed; b; b &= b - 1) n++;
            t = Math.max(0, t - n * 6);
          }
        }
        t = t > 0 ? t - 1 : 0;
        c.grabTimer[e] = t;
        if (t === 0) breakGrab(sim, e, v);
      }
    } else if (sk === SK.grabbed) {
      // The victim side: if the holder is no longer holding, drop.
      if (!sim.isHolding(v) || c.grab[v] !== e + 1) {
        c.grab[e] = 0;
        sim.enterState(e, sim.def(e).S.idle);
      }
    } else if (vk !== SK.grabbed) {
      c.grab[e] = 0;
    }
  }
  // Soft separation between enemies so crowds spread out.
  const ents: number[] = [];
  for (let e = 0; e < w.high; e++) {
    if (!w.alive[e]) continue;
    const k = c.kind[e];
    if ((k === KIND.enemy || k === KIND.boss) && !c.grab[e] && sim.stateKind(e) === SK.free)
      ents.push(e);
  }
  const push = FX >> 2;
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const a = ents[i]!;
      const b = ents[j]!;
      const dx = c.x[b]! - c.x[a]!;
      const dy = c.y[b]! - c.y[a]!;
      const minX = intToFx(sim.def(a).pushW + sim.def(b).pushW);
      if (Math.abs(dx) < minX && Math.abs(dy) < intToFx(5)) {
        const dir = dx >= 0 ? 1 : -1;
        c.x[a] = c.x[a]! - dir * push;
        c.x[b] = c.x[b]! + dir * push;
        const ydir = dy >= 0 ? 1 : -1;
        c.y[a] = c.y[a]! - ydir * (push >> 1);
        c.y[b] = c.y[b]! + ydir * (push >> 1);
      }
    }
  }
}

export function cameraSystem(sim: Sim): void {
  const g = sim.g;
  if (g.flags.camControlled) return;
  if (g.phase !== PHASE.play && g.phase !== PHASE.outro && g.phase !== PHASE.clear) return;
  const players = sim.playerEntities();
  if (players.length === 0) return;
  const c = sim.c;
  let right = -Infinity;
  for (const e of players) right = Math.max(right, c.x[e]!);
  const trigger = g.camX + intToFx(Math.trunc(VIEW_W * 0.55));
  let target = g.camX;
  if (right > trigger) target = right - intToFx(Math.trunc(VIEW_W * 0.55));
  const maxStep = intToFx(3);
  if (target > g.camX + maxStep) target = g.camX + maxStep;
  if (target > g.camMaxX) target = g.camMaxX;
  if (target < g.camMinX) target = g.camMinX;
  if (target > g.camX) {
    g.camX = target;
    g.camMinX = target;
  }
  if (g.lockActive === 0 && sim.livingEnemies() === 0) g.stats.idleScroll++;
}
