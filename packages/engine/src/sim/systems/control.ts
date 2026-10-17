// Input phase: player slots (join, pick, continue, drop) and the command parser that turns
// InputFrames into commands. AI-driven entities get their commands in the ai phase.

import type { Sim } from "../sim";
import { CMD, DIFFICULTY, IN, PHASE, SK, SLOT } from "../types";

const DOUBLE_TAP = 14;
const DROP_HOLD = 90;
const CONTINUE_TICKS = 600;

export function controlSystem(sim: Sim): void {
  const g = sim.g;
  for (let slot = 0; slot < g.players.length; slot++) {
    const p = g.players[slot]!;
    const inp = sim.inputs[slot] ?? 0;
    const pressed = inp & ~p.prevIn;
    slotLogic(sim, slot, inp, pressed);
    if (p.status === SLOT.playing && p.ent >= 0 && sim.world.alive[p.ent])
      parse(sim, p.ent, inp, p.prevIn);
    p.prevIn = inp;
  }
}

function slotLogic(sim: Sim, slot: number, inp: number, pressed: number): void {
  const g = sim.g;
  const p = g.players[slot]!;
  const roster = sim.content.roster;
  switch (p.status) {
    case SLOT.empty:
      if (pressed & IN.START && g.phase !== PHASE.gameover) {
        if (sim.cabinetMode) {
          p.def = roster[slot % roster.length]!;
          joinNow(sim, slot);
        } else {
          p.status = SLOT.picking;
          p.cursor = firstUnused(sim);
        }
        sim.emit({ t: "join", slot });
      }
      break;
    case SLOT.picking: {
      if (pressed & IN.LEFT) p.cursor = (p.cursor + roster.length - 1) % roster.length;
      if (pressed & IN.RIGHT) p.cursor = (p.cursor + 1) % roster.length;
      if (pressed & (IN.ATTACK | IN.START)) {
        p.def = roster[p.cursor]!;
        joinNow(sim, slot);
      }
      break;
    }
    case SLOT.playing:
      if (inp & IN.START) p.startHeld++;
      else p.startHeld = 0;
      if (p.startHeld >= DROP_HOLD) {
        if (p.ent >= 0) sim.despawn(p.ent);
        p.status = SLOT.empty;
        p.ent = -1;
        p.startHeld = 0;
        sim.emit({ t: "drop", slot });
      }
      break;
    case SLOT.continue: {
      if (p.contTimer > 0) p.contTimer--;
      if (p.contTimer % 60 === 0) sim.emit({ t: "continue", slot, seconds: p.contTimer / 60 });
      // Mashing attack speeds the countdown up, the genre's cruelty.
      if (pressed & IN.ATTACK && p.contTimer > 60) p.contTimer -= 20;
      if (pressed & IN.START && (g.credits !== 0 || DIFFICULTY[sim.difficulty].credits < 0)) {
        if (g.credits > 0) g.credits--;
        p.lives = DIFFICULTY[sim.difficulty].lives;
        p.status = SLOT.playing;
        sim.spawnPlayer(slot);
        sim.emit({ t: "life", slot });
      } else if (p.contTimer === 0) {
        p.status = SLOT.out;
      }
      break;
    }
    case SLOT.out:
      if (pressed & IN.START && (g.credits > 0 || DIFFICULTY[sim.difficulty].credits < 0)) {
        if (g.credits > 0) g.credits--;
        p.lives = DIFFICULTY[sim.difficulty].lives;
        p.status = SLOT.playing;
        sim.spawnPlayer(slot);
      }
      break;
  }
}

function firstUnused(sim: Sim): number {
  const used = new Set(sim.g.players.filter((p) => p.status === SLOT.playing).map((p) => p.def));
  const roster = sim.content.roster;
  for (let i = 0; i < roster.length; i++) if (!used.has(roster[i]!)) return i;
  return 0;
}

function joinNow(sim: Sim, slot: number): void {
  const p = sim.g.players[slot]!;
  p.status = SLOT.playing;
  p.lives = DIFFICULTY[sim.difficulty].lives;
  let n = 0;
  for (const q of sim.g.players) if (q !== p && q.def === p.def && q.status === SLOT.playing) n++;
  p.palette = n;
  sim.spawnPlayer(slot);
}

/** The command parser: edges, double-taps, simultaneous presses and direction-relative moves. */
export function parse(sim: Sim, e: number, inp: number, prev: number): void {
  const c = sim.c;
  const pressed = inp & ~prev;
  const released = prev & ~inp;
  const mx = (inp & IN.RIGHT ? 1 : 0) - (inp & IN.LEFT ? 1 : 0);
  const my = (inp & IN.DOWN ? 1 : 0) - (inp & IN.UP ? 1 : 0);
  c.mx[e] = mx;
  c.my[e] = my;
  c.held[e] = inp;
  const facing = c.facing[e]!;
  let cmd = 0;

  // Double-tap to run.
  if (c.tapL[e]! < 0xffff) c.tapL[e] = c.tapL[e]! + 1;
  if (c.tapR[e]! < 0xffff) c.tapR[e] = c.tapR[e]! + 1;
  if (pressed & IN.RIGHT) {
    if (c.tapR[e]! < DOUBLE_TAP) {
      cmd |= CMD.dash;
      c.run[e] = 1;
    }
    c.tapR[e] = 0;
  }
  if (pressed & IN.LEFT) {
    if (c.tapL[e]! < DOUBLE_TAP) {
      cmd |= CMD.dash;
      c.run[e] = 1;
    }
    c.tapL[e] = 0;
  }
  if (pressed & IN.DASH || (inp & IN.DASH && mx !== 0 && !c.run[e])) {
    cmd |= CMD.dash;
    c.run[e] = 1;
  }
  if (
    mx === 0 ||
    (c.run[e] &&
      mx !== 0 &&
      mx !== facing &&
      sim.stateKind(e) === SK.free &&
      sim.st(e).name === "run")
  )
    c.run[e] = 0;

  // How long the direction away from the facing has been held, for the back attack.
  const away = mx !== 0 && mx === -facing;
  c.awayHeld[e] = away ? Math.min(0xffff, c.awayHeld[e]! + 1) : 0;

  const kind = sim.stateKind(e);
  const air = c.z[e]! > 0 || kind === SK.air;
  const special =
    pressed & IN.SPECIAL ||
    ((pressed & (IN.ATTACK | IN.JUMP)) !== 0 && (inp & IN.ATTACK) !== 0 && (inp & IN.JUMP) !== 0);
  if (special) {
    cmd |= CMD.special;
    if (mx === facing) cmd |= CMD.specialF;
    else if (mx === -facing) cmd |= CMD.specialB;
    if (my < 0) cmd |= CMD.specialU;
    else if (my > 0) cmd |= CMD.specialD;
  } else {
    if (pressed & IN.ATTACK) {
      cmd |= CMD.attack;
      if (air) {
        cmd |= CMD.airAttack;
        if (my > 0) cmd |= CMD.dive;
      }
      if (c.run[e] && sim.st(e).name === "run") cmd |= CMD.dashAttack;
      const locked = kind !== SK.free;
      if (away && (locked || c.awayHeld[e]! <= 6)) cmd |= CMD.back;
      if (kind === SK.grab) {
        // Throw toward the camera (down + attack) is added by its module when the stage allows it.
        if (mx === facing) cmd |= CMD.throwF;
        else if (mx === -facing) cmd |= CMD.throwB;
        else cmd |= CMD.grabHit;
      }
    }
    if (pressed & IN.JUMP) cmd |= CMD.jump;
  }
  if (inp & IN.ATTACK) cmd |= CMD.attackHeld;
  if (released & IN.ATTACK) cmd |= CMD.attackRelease;
  if (pressed & IN.TAUNT) cmd |= CMD.taunt;
  if (cmd & (CMD.attack | CMD.jump | CMD.special | CMD.taunt)) cmd |= CMD.any;
  c.cmd[e] = cmd;
  for (const m of sim.modules) m.hooks?.onCommands?.(sim, e, pressed, inp, released);
}

export { CONTINUE_TICKS };
