// The deterministic fixed-step simulation. Everything the sim needs each tick is the array of
// InputFrames; the renderer and audio only read what it produced.

import type { SegmentFile, StageFile, Wave } from "@bb/schema";
import { World, type WorldSnapshot } from "../ecs/world";
import { FX, intToFx, toFx } from "../math/fixed";
import { Hasher } from "../math/hash";
import { Rng } from "../math/prng";
import type { CDef, CState, CompiledContent, CFrame } from "../content/types";
import {
  PHASES,
  type MechanicModule,
  type ModuleRegistry,
  type SegmentController,
  type SystemDef,
} from "../modules/registry";
import { defineCore, type Core, HIT_LOG } from "./components";
import {
  DIFFICULTY,
  F,
  KIND,
  MAX_ENTITIES,
  MAX_PLAYERS,
  PHASE,
  SK,
  SLOT,
  TEAM,
  type Difficulty,
  type FriendlyFire,
  type InputFrame,
} from "./types";
import { controlSystem } from "./systems/control";
import { stateSystem } from "./systems/fsm";
import { movementSystem, collisionSystem, cameraSystem } from "./systems/physics";
import { combatSystem } from "./systems/combat";
import { aiSystem } from "./systems/ai";
import { directorSystem, startSegment, defaultSegmentController } from "./systems/director";
import { gagSystem } from "./systems/gags";

export type SimEvent =
  | { t: "sfx"; id: string; x?: number }
  | {
      t: "hit";
      x: number;
      y: number;
      z: number;
      power: number;
      attacker: number;
      target: number;
      damage: number;
      tags: string[];
    }
  | {
      /** A line from a pool (D80). The game screen picks the text, so the sim never reads it. */
      t: "say";
      pool: number;
      kind: "bubble" | "banner" | "bulletin";
      ent?: number;
      x?: number;
      y?: number;
      ticks: number;
    }
  | {
      t: "text";
      text: string;
      kind: "pop" | "banner" | "bubble" | "big" | "bulletin";
      ent?: number;
      x?: number;
      y?: number;
      ticks: number;
      color?: string;
    }
  | { t: "shake"; ticks: number }
  | { t: "flash"; ticks: number }
  | { t: "ko"; ent: number; def: number; player: boolean }
  | { t: "spawn"; ent: number; def: number }
  | { t: "despawn"; ent: number }
  | { t: "bossCard"; def: number; partner: number; midBoss: boolean }
  | { t: "bossDefeated"; def: number }
  | { t: "go" }
  | { t: "lockStart"; id: string }
  | { t: "lockClear"; id: string }
  | { t: "segment"; index: number; intro?: string }
  | { t: "stageClear" }
  | { t: "gameOver" }
  | { t: "static" }
  | { t: "music"; action: "switch" | "stop" | "stinger" | "boss" | "stage"; track?: string }
  | { t: "combo"; slot: number; count: number }
  | { t: "join"; slot: number }
  | { t: "drop"; slot: number }
  | { t: "continue"; slot: number; seconds: number }
  | { t: "life"; slot: number }
  | { t: "signal"; name: string; ent: number }
  | { t: "crack"; x: number; y: number }
  | { t: "tiny"; ent: number; on: boolean };

export interface PlayerSlotState {
  status: number;
  def: number;
  cursor: number;
  ent: number;
  lives: number;
  score: number;
  contTimer: number;
  startHeld: number;
  prevIn: number;
  kos: number;
  dealt: number;
  taken: number;
  deaths: number;
  bestCombo: number;
  palette: number;
}

export interface PendingSpawn {
  at: number;
  def: number;
  tier: number;
  side: number;
  kind: string;
  x: number;
  y: number;
  first: number;
}

export interface Globals {
  tick: number;
  phase: number;
  phaseTimer: number;
  seg: number;
  segLen: number;
  depthMin: number;
  depthMax: number;
  camX: number;
  camY: number;
  camMaxX: number;
  camMinX: number;
  lockIdx: number;
  lockActive: number;
  pending: PendingSpawn[];
  bosses: number[];
  bossTrigger: number;
  bossMid: number;
  credits: number;
  players: PlayerSlotState[];
  attackers: number;
  outroEnt: number;
  firstEnemyDone: number;
  stageCleared: number;
  /** Module-owned numeric state, snapshotted with everything else. */
  flags: Record<string, number>;
  /** Run statistics for metrics. */
  stats: {
    idleScroll: number;
    lockTicks: number;
    segTicks: number[];
    enemiesOnScreenSum: number;
    samples: number;
  };
}

export interface SimOptions {
  content: CompiledContent;
  stageId: string;
  seed: number;
  registry: ModuleRegistry;
  difficulty?: Difficulty;
  friendlyFire?: FriendlyFire;
  /** Def index per player slot, or -1 for an empty slot. */
  party: number[];
  scores?: number[];
  lives?: number[];
  credits?: number;
  startSegment?: number;
  cabinetMode?: boolean;
  /** Arena-only sandbox: no locks, no waves. */
  sandbox?: boolean;
}

export interface SimSnapshot {
  tick: number;
  world: WorldSnapshot;
  g: Globals;
  rng: number[];
}

export class Sim {
  readonly world = new World(MAX_ENTITIES);
  readonly c: Core;
  readonly rng: Rng;
  readonly content: CompiledContent;
  readonly stage: StageFile;
  /** The stage's line pools by name (costume, bulletin, outro, outroBanner, announcer). */
  readonly stageLines: Record<string, number>;
  readonly segments: SegmentFile[];
  readonly registry: ModuleRegistry;
  readonly modules: MechanicModule[];
  readonly difficulty: Difficulty;
  readonly friendlyFire: FriendlyFire;
  readonly cabinetMode: boolean;
  readonly sandbox: boolean;
  readonly laneTol: number;
  g: Globals;
  events: SimEvent[] = [];
  /** Previous-tick positions for render interpolation (not part of the snapshot). */
  readonly prevX = new Int32Array(MAX_ENTITIES);
  readonly prevY = new Int32Array(MAX_ENTITIES);
  readonly prevZ = new Int32Array(MAX_ENTITIES);
  prevCamX = 0;
  prevCamY = 0;
  inputs: InputFrame[] = [0, 0, 0, 0];
  private readonly systems: SystemDef[];
  segController: SegmentController;
  /** Module-provided segment controllers keyed by segment kind or field. */
  readonly segmentControllers: Record<string, () => SegmentController> = {};

  constructor(opts: SimOptions) {
    this.content = opts.content;
    const st = opts.content.raw.stages[opts.stageId];
    if (!st) throw new Error(`unknown stage ${opts.stageId}`);
    this.stage = st.file;
    this.stageLines = opts.content.stagePools[opts.stageId] ?? {};
    this.segments = st.file.segments.map((id) => {
      const s = st.segments[id];
      if (!s) throw new Error(`stage ${opts.stageId}: missing segment ${id}`);
      return s;
    });
    this.registry = opts.registry;
    const missing = opts.registry.missing(st.file.rules.requires);
    if (missing.length)
      throw new Error(
        `stage ${opts.stageId} needs modules that are not available: ${missing.join(", ")}`,
      );
    this.modules = opts.registry.enabled();
    this.difficulty = opts.difficulty ?? "arcade";
    this.friendlyFire = opts.friendlyFire ?? (st.file.rules.friendlyFireDefault as FriendlyFire);
    this.cabinetMode = opts.cabinetMode ?? false;
    this.sandbox = opts.sandbox ?? false;
    this.laneTol = st.file.rules.laneTolerance;
    this.rng = new Rng(opts.seed);
    this.c = defineCore(this.world);
    for (const m of this.modules) for (const def of m.components ?? []) this.world.define(def);
    for (const m of this.modules)
      Object.assign(this.segmentControllers, m.segmentControllers ?? {});

    const core: SystemDef[] = [
      { phase: "input", order: 0, name: "control", run: controlSystem },
      { phase: "ai", order: 0, name: "ai", run: aiSystem },
      { phase: "movement", order: 0, name: "movement", run: movementSystem },
      { phase: "movement", order: 90, name: "camera", run: cameraSystem },
      { phase: "collision", order: 0, name: "collision", run: collisionSystem },
      { phase: "combat", order: 0, name: "combat", run: combatSystem },
      { phase: "state", order: 0, name: "fsm", run: stateSystem },
      { phase: "state", order: 50, name: "gags", run: gagSystem },
      { phase: "events", order: 0, name: "director", run: directorSystem },
    ];
    const all = [...core, ...this.modules.flatMap((m) => m.systems ?? [])];
    this.systems = all.sort((a, b) => {
      const pa = PHASES.indexOf(a.phase);
      const pb = PHASES.indexOf(b.phase);
      return pa !== pb ? pa - pb : a.order - b.order || (a.name < b.name ? -1 : 1);
    });

    const diff = DIFFICULTY[this.difficulty];
    const players: PlayerSlotState[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const def = opts.party[i] ?? -1;
      players.push({
        status: def >= 0 ? SLOT.playing : SLOT.empty,
        def,
        cursor: 0,
        ent: -1,
        lives: opts.lives?.[i] ?? diff.lives,
        score: opts.scores?.[i] ?? 0,
        contTimer: 0,
        startHeld: 0,
        prevIn: 0,
        kos: 0,
        dealt: 0,
        taken: 0,
        deaths: 0,
        bestCombo: 0,
        palette: 0,
      });
    }
    this.g = {
      tick: 0,
      phase: PHASE.intro,
      phaseTimer: 45,
      seg: opts.startSegment ?? 0,
      segLen: 0,
      depthMin: 180,
      depthMax: 260,
      camX: 0,
      camY: 0,
      camMaxX: 0,
      camMinX: 0,
      lockIdx: 0,
      lockActive: 0,
      pending: [],
      bosses: [],
      bossTrigger: -1,
      bossMid: 0,
      credits: opts.credits ?? diff.credits,
      players,
      attackers: 0,
      outroEnt: -1,
      firstEnemyDone: 0,
      stageCleared: 0,
      flags: {},
      stats: { idleScroll: 0, lockTicks: 0, segTicks: [], enemiesOnScreenSum: 0, samples: 0 },
    };
    this.assignPalettes();
    this.segController = defaultSegmentController();
    for (const m of this.modules) m.hooks?.onStageLoad?.(this);
    startSegment(this, this.g.seg);
  }

  // ---------------------------------------------------------------- stepping

  step(inputs: readonly InputFrame[]): void {
    for (let i = 0; i < MAX_PLAYERS; i++) this.inputs[i] = inputs[i] ?? 0;
    this.events = [];
    const c = this.c;
    for (let e = 0; e < this.world.high; e++) {
      this.prevX[e] = c.x[e]!;
      this.prevY[e] = c.y[e]!;
      this.prevZ[e] = c.z[e]!;
    }
    this.prevCamX = this.g.camX;
    this.prevCamY = this.g.camY;
    for (const s of this.systems) s.run(this);
    this.g.tick++;
  }

  /** Actors are frozen during cards, fades and the intro. */
  get actorsFrozen(): boolean {
    const p = this.g.phase;
    return (
      p === PHASE.intro || p === PHASE.bossIntro || p === PHASE.segmentFade || p === PHASE.gameover
    );
  }

  // ---------------------------------------------------------------- queries

  def(e: number): CDef {
    return this.content.defs[this.c.def[e]!]!;
  }

  st(e: number): CState {
    return this.def(e).states[this.c.state[e]!]!;
  }

  frame(e: number): CFrame {
    const s = this.st(e);
    const t = this.c.stick[e]!;
    return s.frames[s.frameAt[t < s.total ? t : s.total - 1]!]!;
  }

  kindOf(e: number): number {
    return this.c.kind[e]!;
  }

  isActor(e: number): boolean {
    const k = this.c.kind[e]!;
    return k === KIND.player || k === KIND.enemy || k === KIND.boss || k === KIND.civilian;
  }

  stateKind(e: number): number {
    return this.st(e).kind;
  }

  /** Grab, throw and "hold"-tagged states (grab hits) keep a victim attached. */
  isHolding(e: number): boolean {
    const s = this.st(e);
    return (
      s.kind === SK.grab ||
      s.kind === SK.throw ||
      s.tags.includes("hold") ||
      s.tags.includes("teamToss")
    );
  }

  playerEntities(): number[] {
    const out: number[] = [];
    for (const p of this.g.players)
      if (p.status === SLOT.playing && p.ent >= 0 && this.world.alive[p.ent]) out.push(p.ent);
    return out;
  }

  /** Living players that can be targeted (not KO'd). */
  targetablePlayers(): number[] {
    return this.playerEntities().filter(
      (e) => this.stateKind(e) !== SK.ko && !(this.c.flags[e]! & F.hidden),
    );
  }

  activePlayerCount(): number {
    let n = 0;
    for (const p of this.g.players)
      if (p.status === SLOT.playing || p.status === SLOT.continue) n++;
    return Math.max(1, n);
  }

  livingEnemies(onlyLock = false): number {
    let n = 0;
    const c = this.c;
    for (let e = 0; e < this.world.high; e++) {
      if (!this.world.alive[e]) continue;
      const k = c.kind[e];
      if (k !== KIND.enemy && k !== KIND.boss) continue;
      if (onlyLock && !(c.flags[e]! & F.lockEnemy)) continue;
      if (c.flags[e]! & F.unfightable) continue;
      n++;
    }
    return n;
  }

  hasModule(id: string): boolean {
    return this.modules.some((m) => m.id === id);
  }

  segment(): SegmentFile {
    return this.segments[this.g.seg]!;
  }

  /** Depth band (px) at world x, honoring the segment's ground polyline. */
  depthAt(xPx: number): [number, number] {
    const gb = this.segment().groundBounds;
    if (!gb || gb.length === 0) return [this.g.depthMin, this.g.depthMax];
    if (xPx <= gb[0]![0]) return [gb[0]![1], gb[0]![2]];
    for (let i = 1; i < gb.length; i++) {
      const a = gb[i - 1]!;
      const b = gb[i]!;
      if (xPx <= b[0]) {
        const t = Math.trunc(((xPx - a[0]) * 1024) / Math.max(1, b[0] - a[0]));
        return [
          a[1] + Math.trunc(((b[1] - a[1]) * t) / 1024),
          a[2] + Math.trunc(((b[2] - a[2]) * t) / 1024),
        ];
      }
    }
    const last = gb[gb.length - 1]!;
    return [last[1], last[2]];
  }

  // ---------------------------------------------------------------- events

  emit(ev: SimEvent): void {
    this.events.push(ev);
    for (const m of this.modules) m.hooks?.onRunEvent?.(this, ev);
  }

  sfx(id: string | undefined, e = -1): void {
    if (!id) return;
    this.emit({ t: "sfx", id, x: e >= 0 ? (this.c.x[e]! - this.g.camX) / FX : undefined });
  }

  /** Names a line pool to speak from. Pool -1 (an empty pool) says nothing. */
  say(
    pool: number | undefined,
    kind: "bubble" | "banner" | "bulletin",
    ent = -1,
    ticks = 90,
  ): void {
    if (pool === undefined || pool < 0) return;
    const ev: SimEvent = { t: "say", pool, kind, ticks };
    if (ent >= 0) {
      ev.ent = ent;
      ev.x = this.c.x[ent]! / FX;
      ev.y = this.c.y[ent]! / FX;
    }
    this.emit(ev);
  }

  text(
    text: string,
    kind: "pop" | "banner" | "bubble" | "big" | "bulletin",
    ent = -1,
    ticks = 90,
    color?: string,
  ): void {
    const ev: SimEvent = { t: "text", text, kind, ticks };
    if (ent >= 0) {
      ev.ent = ent;
      ev.x = this.c.x[ent]! / FX;
      ev.y = this.c.y[ent]! / FX;
    }
    if (color) ev.color = color;
    this.emit(ev);
  }

  // ---------------------------------------------------------------- state machine

  enterState(e: number, sid: number): void {
    const c = this.c;
    const d = this.def(e);
    if (sid === -2) sid = this.weaponState(e);
    if (sid < 0 || sid >= d.states.length) sid = d.S.idle >= 0 ? d.S.idle : 0;
    c.state[e] = sid;
    c.stick[e] = 0;
    c.serial[e] = (c.serial[e]! + 1) & 0xffff;
    c.connected[e] = 0;
    const s = d.states[sid]!;
    if (s.kind === SK.special && !s.costOnHit) {
      // Specials without an explicit cost charge the character's desperation cost.
      const cost = s.costHp || d.player?.specialCost || 0;
      if (cost > 0) this.payCost(e, cost);
    }
    if (s.kind !== SK.free) c.idle[e] = 0;
  }

  payCost(e: number, amount: number): void {
    const c = this.c;
    c.hp[e] = Math.max(1, c.hp[e]! - amount);
  }

  weaponState(e: number): number {
    const w = this.c.weapon[e]!;
    const d = this.def(e);
    if (w === 0) return d.S.idle;
    const ws = this.content.weapons[w - 1]!;
    return d.stateIndex[`wpn-${ws.moveset}-1`] ?? d.S.idle;
  }

  stateId(e: number, name: string): number {
    return this.def(e).stateIndex[name] ?? -1;
  }

  // ---------------------------------------------------------------- spawning

  private assignPalettes(): void {
    // Duplicate picks get alternate palettes, in slot order.
    const seen = new Map<number, number>();
    for (const p of this.g.players) {
      if (p.def < 0) continue;
      const n = seen.get(p.def) ?? 0;
      p.palette = n;
      seen.set(p.def, n + 1);
    }
  }

  spawnActor(defIdx: number, tier: number, xPx: number, yPx: number, zPx = 0, facing = 1): number {
    const e = this.world.alloc();
    if (e < 0) return -1;
    const c = this.c;
    const d = this.content.defs[defIdx]!;
    c.def[e] = defIdx;
    c.kind[e] =
      d.kind === "player"
        ? KIND.player
        : d.kind === "boss"
          ? KIND.boss
          : d.kind === "enemy"
            ? d.enemy?.civilian
              ? KIND.civilian
              : KIND.enemy
            : KIND.actor;
    c.team[e] =
      d.kind === "player" ? TEAM.players : d.enemy?.civilian ? TEAM.neutral : TEAM.enemies;
    c.tier[e] = tier;
    c.x[e] = intToFx(xPx);
    c.y[e] = intToFx(yPx);
    c.z[e] = intToFx(zPx);
    c.facing[e] = facing;
    let hp = d.hp;
    if (d.enemy) {
      const t = d.enemy.tiers[Math.min(tier, d.enemy.tiers.length - 1)]!;
      hp = t.hp;
      if (t.miniBoss) c.flags[e]! |= F.miniBoss;
      if (d.enemy.light) c.flags[e]! |= F.light;
      if (d.enemy.grabbable) c.flags[e]! |= F.grabbable;
      if (d.enemy.civilian) c.flags[e]! |= F.civilian;
      if (d.enemy.weapon >= 0) {
        c.weapon[e] = d.enemy.weapon + 1;
        c.weaponHits[e] = 999;
      }
    }
    if (d.boss) {
      c.flags[e]! |= F.boss;
      c.poise[e] = d.boss.poise;
      if (d.boss.file.grabbable) c.flags[e]! |= F.grabbable;
      // Boss health scales with the party so four players do not melt a boss.
      hp = Math.trunc((hp * (100 + 35 * (this.activePlayerCount() - 1))) / 100);
    }
    c.hp[e] = hp;
    c.maxHp[e] = hp;
    if (d.player?.improvised) {
      c.impro[e] = 1;
      c.improHits[e] = d.player.improvised.hits;
    }
    this.enterState(e, zPx > 0 && d.S.jump >= 0 ? d.S.jump : d.S.idle);
    this.prevX[e] = c.x[e]!;
    this.prevY[e] = c.y[e]!;
    this.prevZ[e] = c.z[e]!;
    this.emit({ t: "spawn", ent: e, def: defIdx });
    for (const m of this.modules) {
      m.hooks?.onEntitySpawn?.(this, e);
      if (d.kind === "player") m.hooks?.onCharacterLoad?.(this, e);
    }
    return e;
  }

  spawnPlayer(slot: number): number {
    const p = this.g.players[slot]!;
    const camPx = Math.trunc(this.g.camX / FX);
    const [dmin, dmax] = this.depthAt(camPx + 60);
    const x = camPx + 50 + slot * 22;
    const y = dmin + Math.trunc(((dmax - dmin) * (slot + 1)) / 5);
    const e = this.spawnActor(p.def, 0, x, y, this.g.tick > 0 ? 140 : 0, 1);
    if (e < 0) return -1;
    this.c.slot[e] = slot + 1;
    this.c.variant[e] = p.palette;
    this.c.invuln[e] = this.g.tick > 0 ? 150 : 0;
    p.ent = e;
    return e;
  }

  spawnProjectile(
    defIdx: number,
    owner: number,
    xFx: number,
    yFx: number,
    zFx: number,
    vx: number,
    vz: number,
    facing: number,
  ): number {
    const e = this.world.alloc();
    if (e < 0) return -1;
    const c = this.c;
    const d = this.content.defs[defIdx]!;
    const p = d.projectile!;
    c.def[e] = defIdx;
    c.kind[e] = KIND.projectile;
    c.team[e] = owner >= 0 ? c.team[owner]! : TEAM.hazards;
    c.owner[e] = owner + 1;
    c.x[e] = xFx;
    c.y[e] = yFx;
    c.z[e] = zFx;
    c.vx[e] = vx;
    c.vz[e] = vz;
    c.facing[e] = facing;
    c.life[e] = p.lifetime;
    c.pierce[e] = p.pierce;
    c.scale[e] = p.scalePct;
    c.flags[e]! |= F.offscreenOk;
    if (owner >= 0 && c.tiny[owner]) c.scale[e] = Math.trunc(p.scalePct / 2);
    this.enterState(e, d.S.idle);
    this.prevX[e] = xFx;
    this.prevY[e] = yFx;
    this.prevZ[e] = zFx;
    this.emit({ t: "spawn", ent: e, def: defIdx });
    for (const m of this.modules) m.hooks?.onEntitySpawn?.(this, e);
    return e;
  }

  spawnPickup(defIdx: number, xFx: number, yFx: number, zFx = 0, vx = 0, vz = 0): number {
    const e = this.world.alloc();
    if (e < 0) return -1;
    const c = this.c;
    const d = this.content.defs[defIdx]!;
    c.def[e] = defIdx;
    c.kind[e] = KIND.pickup;
    c.team[e] = TEAM.neutral;
    c.x[e] = xFx;
    c.y[e] = yFx;
    c.z[e] = zFx;
    c.vx[e] = vx;
    c.vz[e] = vz;
    c.facing[e] = 1;
    c.life[e] = d.pickup?.lifetime ?? 0;
    this.enterState(e, d.S.idle);
    this.prevX[e] = xFx;
    this.prevY[e] = yFx;
    this.prevZ[e] = zFx;
    this.emit({ t: "spawn", ent: e, def: defIdx });
    return e;
  }

  spawnProp(defIdx: number, xPx: number, yPx: number, gagIndex = -1, facing = 1): number {
    const e = this.world.alloc();
    if (e < 0) return -1;
    const c = this.c;
    const d = this.content.defs[defIdx]!;
    c.def[e] = defIdx;
    c.kind[e] = KIND.prop;
    c.team[e] = TEAM.neutral;
    c.x[e] = intToFx(xPx);
    c.y[e] = intToFx(yPx);
    c.facing[e] = facing;
    c.hp[e] = d.prop?.hp ?? 1;
    c.maxHp[e] = c.hp[e]!;
    c.gag[e] = gagIndex + 1;
    this.enterState(e, d.S.idle);
    this.prevX[e] = c.x[e]!;
    this.prevY[e] = c.y[e]!;
    this.prevZ[e] = 0;
    this.emit({ t: "spawn", ent: e, def: defIdx });
    return e;
  }

  despawn(e: number): void {
    if (!this.world.alive[e]) return;
    const c = this.c;
    const partner = c.grab[e]! - 1;
    if (partner >= 0 && this.world.alive[partner] && c.grab[partner] === e + 1) {
      c.grab[partner] = 0;
      if (this.isActor(partner)) {
        const k = this.stateKind(partner);
        if (k === SK.grab || k === SK.grabbed) this.enterState(partner, this.def(partner).S.idle);
      }
    }
    if (c.aiToken[e]) this.g.attackers = Math.max(0, this.g.attackers - 1);
    for (const p of this.g.players) if (p.ent === e) p.ent = -1;
    this.emit({ t: "despawn", ent: e });
    this.world.free(e);
  }

  /** Queues one wave of a scroll lock, scaled by player count. */
  queueWave(w: Wave, at: number, first = false): void {
    const defIdx = this.content.defIndex[w.family];
    if (defIdx === undefined) throw new Error(`wave refers to unknown family ${w.family}`);
    const d = this.content.defs[defIdx]!;
    const players = this.activePlayerCount();
    const count = w.fixed
      ? w.count
      : Math.max(w.count, Math.trunc((w.count * (10 + 6 * (players - 1))) / 10));
    const shift = DIFFICULTY[this.difficulty].tierShift;
    const maxTier = (d.enemy?.tiers.length ?? 1) - 1;
    for (let i = 0; i < count; i++) {
      const side =
        w.side === "left"
          ? -1
          : w.side === "right"
            ? 1
            : w.side === "top"
              ? 0
              : i % 2 === 0
                ? 1
                : -1;
      // The VP tier is a deliberate mini-boss; difficulty never promotes into or out of it.
      let tier = w.tier;
      if (tier < 3)
        tier = Math.max(
          0,
          Math.min(
            Math.min(2, maxTier),
            tier + (shift > 0 && i % 3 === 2 ? 1 : shift < 0 && i % 2 === 1 ? -1 : 0),
          ),
        );
      this.g.pending.push({
        at: this.g.tick + at + w.delayTicks + i * 24,
        def: defIdx,
        tier: Math.min(tier, maxTier),
        side,
        kind: w.spawnKind,
        x: w.x ?? -1,
        y: w.y ?? -1,
        first: first && i === 0 ? 1 : 0,
      });
    }
  }

  // ---------------------------------------------------------------- snapshot

  snapshot(): SimSnapshot {
    return {
      tick: this.g.tick,
      world: this.world.snapshot(),
      g: structuredClone(this.g),
      rng: this.rng.getState(),
    };
  }

  restore(s: SimSnapshot): void {
    this.world.restore(s.world);
    this.g = structuredClone(s.g);
    this.rng.setState(s.rng);
  }

  hash(): number {
    const h = new Hasher();
    this.world.hashInto(h);
    h.value(this.g);
    for (const v of this.rng.getState()) h.u32(v);
    return h.digest();
  }

  // ---------------------------------------------------------------- helpers for systems

  hitLogHas(target: number, key: number): boolean {
    const base = target * HIT_LOG;
    const log = this.c.hitLog;
    for (let i = 0; i < HIT_LOG; i++) if (log[base + i] === key) return true;
    return false;
  }

  hitLogPush(target: number, key: number): void {
    const c = this.c;
    const pos = c.hitLogPos[target]!;
    c.hitLog[target * HIT_LOG + pos] = key;
    c.hitLogPos[target] = (pos + 1) % HIT_LOG;
  }

  playerSlotOf(e: number): number {
    return this.c.slot[e]! - 1;
  }

  addScore(e: number, points: number): void {
    const slot = this.playerSlotOf(e);
    if (slot < 0) {
      const owner = this.c.owner[e]! - 1;
      if (owner >= 0 && owner !== e && this.world.alive[owner]) this.addScore(owner, points);
      return;
    }
    const p = this.g.players[slot]!;
    p.score = Math.max(0, p.score + points);
  }

  px(v: number): number {
    return Math.trunc(v / FX);
  }

  fx(v: number): number {
    return toFx(v);
  }
}
