import type { World } from "../ecs/world";

export const HIT_LOG = 8;

/** Core per-entity components. Modules define their own through World.define. */
export function defineCore(w: World) {
  return {
    kind: w.define<Uint8Array>({ name: "kind", type: "u8" }),
    def: w.define<Uint16Array>({ name: "def", type: "u16" }),
    team: w.define<Uint8Array>({ name: "team", type: "u8" }),
    tier: w.define<Uint8Array>({ name: "tier", type: "u8" }),
    /** Player slot + 1 (0 = not a player). */
    slot: w.define<Uint8Array>({ name: "slot", type: "u8" }),
    x: w.define<Int32Array>({ name: "x", type: "i32" }),
    y: w.define<Int32Array>({ name: "y", type: "i32" }),
    z: w.define<Int32Array>({ name: "z", type: "i32" }),
    vx: w.define<Int32Array>({ name: "vx", type: "i32" }),
    vy: w.define<Int32Array>({ name: "vy", type: "i32" }),
    vz: w.define<Int32Array>({ name: "vz", type: "i32" }),
    facing: w.define<Int8Array>({ name: "facing", type: "i8" }),
    state: w.define<Uint16Array>({ name: "state", type: "u16" }),
    stick: w.define<Uint16Array>({ name: "stick", type: "u16" }),
    hitstop: w.define<Uint8Array>({ name: "hitstop", type: "u8" }),
    /** Remaining hitstun ticks; hurt states hold while it is non-zero. */
    stun: w.define<Uint16Array>({ name: "stun", type: "u16" }),
    hp: w.define<Int32Array>({ name: "hp", type: "i32" }),
    maxHp: w.define<Int32Array>({ name: "maxHp", type: "i32" }),
    invuln: w.define<Uint16Array>({ name: "invuln", type: "u16" }),
    /** Grab partner + 1. */
    grab: w.define<Int16Array>({ name: "grab", type: "i16" }),
    grabTimer: w.define<Uint16Array>({ name: "grabTimer", type: "u16" }),
    grabCount: w.define<Uint8Array>({ name: "grabCount", type: "u8" }),
    /** Thrower (or projectile owner) + 1. */
    owner: w.define<Int16Array>({ name: "owner", type: "i16" }),
    /** Incremented on every state entry; a hit is identified by (attacker, serial). */
    serial: w.define<Uint16Array>({ name: "serial", type: "u16" }),
    hitLog: w.define<Int32Array>({ name: "hitLog", type: "i32", stride: HIT_LOG }),
    hitLogPos: w.define<Uint8Array>({ name: "hitLogPos", type: "u8" }),
    /** Tick of the last hit from the current state, for rehit intervals. */
    lastHitTick: w.define<Uint32Array>({ name: "lastHitTick", type: "u32" }),
    connected: w.define<Uint8Array>({ name: "connected", type: "u8" }),
    juggle: w.define<Uint8Array>({ name: "juggle", type: "u8" }),
    /** Weapon index + 1 and its remaining hits. */
    weapon: w.define<Uint16Array>({ name: "weapon", type: "u16" }),
    weaponHits: w.define<Uint16Array>({ name: "weaponHits", type: "u16" }),
    impro: w.define<Uint8Array>({ name: "impro", type: "u8" }),
    improHits: w.define<Uint16Array>({ name: "improHits", type: "u16" }),
    improTimer: w.define<Uint16Array>({ name: "improTimer", type: "u16" }),
    /** Commands derived this tick from input or AI. */
    cmd: w.define<Uint32Array>({ name: "cmd", type: "u32" }),
    mx: w.define<Int8Array>({ name: "mx", type: "i8" }),
    my: w.define<Int8Array>({ name: "my", type: "i8" }),
    run: w.define<Uint8Array>({ name: "run", type: "u8" }),
    /** Raw held input bits (players) or virtual held bits (AI). */
    held: w.define<Uint16Array>({ name: "held", type: "u16" }),
    ai: w.define<Uint8Array>({ name: "ai", type: "u8" }),
    aiTimer: w.define<Uint16Array>({ name: "aiTimer", type: "u16" }),
    aiTarget: w.define<Int16Array>({ name: "aiTarget", type: "i16" }),
    aiToken: w.define<Uint8Array>({ name: "aiToken", type: "u8" }),
    aiStep: w.define<Uint8Array>({ name: "aiStep", type: "u8" }),
    aiPattern: w.define<Uint8Array>({ name: "aiPattern", type: "u8" }),
    aiPhase: w.define<Uint8Array>({ name: "aiPhase", type: "u8" }),
    aiSide: w.define<Int8Array>({ name: "aiSide", type: "i8" }),
    aiX: w.define<Int32Array>({ name: "aiX", type: "i32" }),
    aiY: w.define<Int32Array>({ name: "aiY", type: "i32" }),
    /** AI cooldown ticks. On a prop, the rearm countdown of its step, proximity or taunt gag. */
    aiCool: w.define<Uint16Array>({ name: "aiCool", type: "u16" }),
    /** Lifetime counter for projectiles, pickups and effects. */
    life: w.define<Uint16Array>({ name: "life", type: "u16" }),
    pierce: w.define<Uint8Array>({ name: "pierce", type: "u8" }),
    /** Projectile/pickup/prop sub-def index. */
    sub: w.define<Uint16Array>({ name: "sub", type: "u16" }),
    /** Projectile scale percent (charge shots). */
    scale: w.define<Uint16Array>({ name: "scale", type: "u16" }),
    flags: w.define<Uint32Array>({ name: "flags", type: "u32" }),
    poise: w.define<Uint8Array>({ name: "poise", type: "u8" }),
    /** Un-bootleg beam: ticks left as a tiny 8-bit sprite. */
    tiny: w.define<Uint16Array>({ name: "tiny", type: "u16" }),
    idle: w.define<Uint16Array>({ name: "idle", type: "u16" }),
    /** Hair-caught item (pickup index + 1) and when it falls out. */
    stuck: w.define<Uint16Array>({ name: "stuck", type: "u16" }),
    stuckTimer: w.define<Uint16Array>({ name: "stuckTimer", type: "u16" }),
    /** Generic per-entity counter for props (gag hits) and actors. */
    counter: w.define<Uint16Array>({ name: "counter", type: "u16" }),
    gag: w.define<Int16Array>({ name: "gag", type: "i16" }),
    /** Spawn ordinal used for stable iteration and lock bookkeeping. */
    lock: w.define<Uint8Array>({ name: "lock", type: "u8" }),
    combo: w.define<Uint16Array>({ name: "combo", type: "u16" }),
    comboTimer: w.define<Uint16Array>({ name: "comboTimer", type: "u16" }),
    /** Costume index (Deadweight Dave) or variant. */
    variant: w.define<Uint8Array>({ name: "variant", type: "u8" }),
    /** Ticks since the last running double-tap press, per direction. */
    tapL: w.define<Uint16Array>({ name: "tapL", type: "u16" }),
    tapR: w.define<Uint16Array>({ name: "tapR", type: "u16" }),
    awayHeld: w.define<Uint16Array>({ name: "awayHeld", type: "u16" }),
    /** Recent unanswered hits on a player; at four the next hit knocks down (stun-lock breaker). */
    strain: w.define<Uint8Array>({ name: "strain", type: "u8" }),
    strainTimer: w.define<Uint16Array>({ name: "strainTimer", type: "u16" }),
  };
}

export type Core = ReturnType<typeof defineCore>;
