import { z } from "zod";
import { id, parodyMeta, rigId, schemaVersion, sfxMap } from "./common";

export const BOSS_SCHEMA_VERSION = 1;

/** One step of a boss pattern. The boss AI runs steps in order, then picks the next pattern. */
export const bossStep = z.discriminatedUnion("do", [
  z.strictObject({
    do: z.literal("approach"),
    range: z.number().default(30),
    maxTicks: z.number().int().default(120),
    run: z.boolean().default(false),
  }),
  z.strictObject({ do: z.literal("attack"), state: z.string() }),
  z.strictObject({
    do: z.literal("charge"),
    state: z.string(),
    speed: z.number().positive(),
    maxTicks: z.number().int().default(150),
    /** Charge along the target's lane, stopping at the arena wall. */
    toWall: z.boolean().default(true),
  }),
  z.strictObject({
    do: z.literal("spawn"),
    family: id,
    tier: z.number().int().min(0).max(3).default(0),
    count: z.number().int().positive().default(2),
    spawnKind: z.string().default("walk"),
  }),
  z.strictObject({ do: z.literal("retreat"), ticks: z.number().int().default(60) }),
  z.strictObject({ do: z.literal("wait"), ticks: z.number().int().default(30) }),
  z.strictObject({ do: z.literal("taunt"), line: z.string().optional() }),
  z.strictObject({
    do: z.literal("align"),
    /** Move to the target's lane at a distance. */
    distance: z.number().default(120),
    maxTicks: z.number().int().default(120),
  }),
  z.strictObject({ do: z.literal("gimmick"), id: z.string(), ticks: z.number().int().default(60) }),
]);
export type BossStep = z.infer<typeof bossStep>;

export const bossPattern = z.strictObject({
  weight: z.number().int().positive().default(1),
  steps: z.array(bossStep).min(1),
});

export const bossPhase = z.strictObject({
  /** Phase is active while hp% is at or below this value. */
  hpBelowPct: z.number().int().min(1).max(100),
  patterns: z.array(bossPattern).min(1),
  enterText: z.string().optional(),
  /** Aggression modifier: ticks removed between patterns. */
  haste: z.number().int().default(0),
});

export const bossFile = z.strictObject({
  id,
  schemaVersion,
  displayName: z.string(),
  catalogType: z.array(z.string()).min(1),
  rig: rigId,
  palette: id,
  overlays: z.string().default("overlays.json"),
  states: z.string().default("states.json"),
  stats: z.strictObject({
    hp: z.number().int().positive(),
    walkSpeed: z.number().positive(),
    runSpeed: z.number().positive().default(2.5),
    jumpVel: z.number().positive().default(4.5),
    weight: z.number().positive().default(2),
    damageMult: z.number().positive().default(1),
  }),
  card: z.strictObject({
    title: z.string(),
    /** Deliberately wrong select-screen stats. */
    stats: z.array(z.strictObject({ label: z.string(), value: z.string() })).min(2),
    taunt: z.string(),
    /** Bounty in cents, shown on the card from stage one. */
    bounty: z.number().int().positive(),
    portrait: z.string().default("idle:0"),
  }),
  phases: z.array(bossPhase).min(1),
  /** Named gimmicks implemented by the core or by arena modules, with their parameters. */
  gimmicks: z
    .array(
      z.strictObject({ id: z.string(), params: z.record(z.string(), z.unknown()).default({}) }),
    )
    .default([]),
  /** Second boss fought at the same time (duos). */
  partner: id.optional(),
  /** Percent of damage taken outside a vulnerable window (duo collide, armored phases). */
  guardPct: z.number().int().min(0).max(100).default(100),
  grabbable: z.boolean().default(false),
  /** Hits absorbed before flinching; bosses shrug off single jabs. */
  poise: z.number().int().default(3),
  defeat: z.strictObject({
    kind: z.enum(["ko", "towed", "escape"]),
    text: z.string(),
  }),
  shadow: z.number().default(1.6),
  sfx: sfxMap.default({}),
  lines: z
    .strictObject({
      hurt: z.array(z.string()).default([]),
      defeat: z.array(z.string()).default([]),
    })
    .default({ hurt: [], defeat: [] }),
  /** A generated bust (relative to the boss folder). The bake adds it as the frame `portrait`. */
  portraitImage: z.string().optional(),
  parodyMeta,
});
export type BossFile = z.infer<typeof bossFile>;

export const arenaFile = z.strictObject({
  id,
  schemaVersion,
  width: z.number().int().min(240).max(960),
  depth: z.tuple([z.number(), z.number()]),
  /** Layers the arena draws instead of the segment's layers (optional). */
  layers: z.array(z.string()).default([]),
  hazards: z
    .array(
      z.strictObject({
        kind: z.enum(["rail", "current", "respawn"]),
        id: z.string(),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
  phases: z
    .array(
      z.strictObject({
        hpBelowPct: z.number().int(),
        spawn: z
          .strictObject({ family: id, tier: z.number().int().default(0), count: z.number().int() })
          .optional(),
        text: z.string().optional(),
      }),
    )
    .default([]),
  camera: z.strictObject({ lockX: z.number().default(0) }).default({ lockX: 0 }),
  rules: z.record(z.string(), z.unknown()).default({}),
});
export type ArenaFile = z.infer<typeof arenaFile>;
