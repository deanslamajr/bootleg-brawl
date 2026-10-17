import { z } from "zod";
import { box, command, schemaVersion, ticks } from "./common";

export const stateKind = z.enum([
  "free",
  "air",
  "attack",
  "special",
  "grab",
  "grabbed",
  "throw",
  "thrown",
  "hurt",
  "fall",
  "down",
  "getup",
  "ko",
  "pickup",
  "teamup",
  "taunt",
  "stomp",
  "misc",
]);
export type StateKind = z.infer<typeof stateKind>;

export const hitbox = z.strictObject({
  box,
  damage: z.number().int().nonnegative(),
  /** Knockback velocity [x, z] in px/tick; x is toward the attacker's facing. */
  knock: z.tuple([z.number(), z.number()]).default([1.5, 0]),
  hitstop: ticks.default(5),
  hitstun: ticks.default(20),
  knockdown: z.boolean().default(false),
  /** Launches into a juggle state rather than a plain knockdown. */
  launch: z.boolean().default(false),
  /** Grab-flagged hitboxes start a grab on hit instead of dealing damage. */
  grab: z.boolean().default(false),
  /** Re-hit the same target every N ticks while active (multi-hit specials). 0 = once. */
  rehit: ticks.default(0),
  sfx: z.string().default("hit"),
  /** Score awarded per connecting hit. */
  score: z.number().int().default(10),
  /** Tags read by gag hooks and modules (e.g. "hair", "note", "fire"). */
  tags: z.array(z.string()).default([]),
});
export type Hitbox = z.infer<typeof hitbox>;

export const frameEvent = z.strictObject({
  at: ticks.default(0),
  sfx: z.string().optional(),
  spawn: z
    .strictObject({
      projectile: z.string(),
      offset: z.tuple([z.number(), z.number()]).default([16, 30]),
      vel: z.tuple([z.number(), z.number()]).default([4, 0]),
    })
    .optional(),
  shake: ticks.optional(),
  /** Throw release point: the held victim leaves the grab. */
  release: z.boolean().optional(),
  text: z.string().optional(),
  flash: z.boolean().optional(),
  /** Module-defined event names (e.g. "chargeStart"). */
  signal: z.string().optional(),
});
export type FrameEvent = z.infer<typeof frameEvent>;

export const frame = z.strictObject({
  pose: z.string(),
  dur: ticks.min(1).default(4),
  hit: z.array(hitbox).optional(),
  /** "auto" derives the hurtbox from the pose's bounds at compile time. */
  hurt: z.union([z.array(box), z.literal("auto"), z.literal("none")]).default("auto"),
  /** Velocity set at frame start, px/tick: [x toward facing, z up]. Omitted axes keep velocity. */
  vel: z.tuple([z.number().nullable(), z.number().nullable()]).optional(),
  events: z.array(frameEvent).optional(),
});
export type Frame = z.infer<typeof frame>;

export const condition = z.enum([
  "hasWeapon",
  "noWeapon",
  "hasImprovised",
  "noImprovised",
  "grabCount<2",
  "grabCount>=2",
  "inAir",
  "onGround",
  "charged",
]);

export const transition = z.strictObject({
  on: command,
  to: z.string(),
  /** Tick window within the state when the transition is accepted. */
  from: ticks.default(0),
  until: ticks.default(9999),
  if: condition.optional(),
});
export type Transition = z.infer<typeof transition>;

export const stateDef = z.strictObject({
  kind: stateKind,
  loop: z.boolean().default(false),
  frames: z.array(frame).min(1),
  next: z.string().optional(),
  transitions: z.array(transition).default([]),
  /** Movement under player or AI control while in this state, as a multiple of walk speed. */
  move: z.number().nonnegative().default(0),
  /** Lets the depth axis move too when move > 0. */
  moveY: z.boolean().default(true),
  facingLock: z.boolean().default(true),
  gravity: z.boolean().default(false),
  /** State entered on touching the ground while in this state. */
  landTo: z.string().optional(),
  /** Hits absorbed without hitstun. -1 = full super armor. */
  armor: z.number().int().default(0),
  invuln: z.tuple([ticks, ticks]).optional(),
  cost: z
    .strictObject({
      hp: z.number().int().nonnegative().default(0),
      /** Only charged if a hitbox connects (the genre's mercy rule). */
      onHit: z.boolean().default(false),
    })
    .optional(),
  /** Friction applied to x velocity per tick in px/tick^2. */
  friction: z.number().nonnegative().default(0.25),
  /** Module hooks this state signals while active (e.g. "chargeShot"). */
  tags: z.array(z.string()).default([]),
});
export type StateDef = z.infer<typeof stateDef>;

export const statesFile = z.strictObject({
  schemaVersion,
  /** "template:<archetype>" or a path-free id of another states file. */
  extends: z.string().optional(),
  states: z.record(z.string(), stateDef).default({}),
  /**
   * Partial overrides merged onto inherited states (frames replace wholesale). Kept as raw
   * objects so only the keys written here override; the merged state is validated at resolve.
   */
  patch: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  remove: z.array(z.string()).default([]),
});
export type StatesFile = z.infer<typeof statesFile>;
