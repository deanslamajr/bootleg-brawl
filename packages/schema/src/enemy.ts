import { z } from "zod";
import { id, parodyMeta, rigId, schemaVersion, sfxMap } from "./common";

export const ENEMY_SCHEMA_VERSION = 1;

export const tierName = z.enum(["intern", "associate", "senior-associate", "vice-president"]);
export type TierName = z.infer<typeof tierName>;

export const aiKind = z.enum([
  "brawler",
  "grabber",
  "thrower",
  "charger",
  "acrobat",
  "swarm",
  "civilian",
  "dummy",
  "boss",
]);
export type AiKind = z.infer<typeof aiKind>;

export const aiParams = z
  .strictObject({
    /** Preferred x distance to the target before attacking, px. */
    range: z.number().default(26),
    /** Ticks between decisions. */
    think: z.number().int().positive().default(20),
    /** Percent chance per decision to attack when in range. */
    aggression: z.number().int().min(0).max(100).default(45),
    /** Hang back at this distance while waiting for an attack token. */
    hover: z.number().default(70),
    /** States the AI may pick from when attacking (filtered by tier.moves). */
    attacks: z.array(z.string()).default(["atk1"]),
    /** Ranged attack state, for throwers. */
    ranged: z.string().optional(),
    rangedMin: z.number().default(90),
    /** Charger dash state. */
    charge: z.string().optional(),
    jumpChance: z.number().int().min(0).max(100).default(0),
  })
  .default({
    range: 26,
    think: 20,
    aggression: 45,
    hover: 70,
    attacks: ["atk1"],
    rangedMin: 90,
    jumpChance: 0,
  });
export type AiParams = z.infer<typeof aiParams>;

export const tier = z.strictObject({
  name: tierName,
  displayName: z.string(),
  palette: id,
  hp: z.number().int().positive(),
  damageMult: z.number().positive().default(1),
  speedMult: z.number().positive().default(1),
  /** States this tier may use, in addition to the reactions every actor has. */
  moves: z.array(z.string()).min(1),
  /** VP tiers wear a badge and count as a mini-boss with their own health bar. */
  badge: z.string().optional(),
  miniBoss: z.boolean().default(false),
  score: z.number().int().default(100),
  aggressionBonus: z.number().int().default(0),
});
export type Tier = z.infer<typeof tier>;

export const enemyFamilyFile = z.strictObject({
  id,
  schemaVersion,
  displayName: z.string(),
  catalogType: z.array(z.string()).min(1),
  rig: rigId,
  overlays: z.string().default("overlays.json"),
  states: z.string().default("states.json"),
  stats: z.strictObject({
    walkSpeed: z.number().positive(),
    runSpeed: z.number().positive().default(2),
    jumpVel: z.number().positive().default(4.5),
    weight: z.number().positive().default(1),
  }),
  tiers: z.array(tier).min(1).max(4),
  ai: z.strictObject({ kind: aiKind, params: aiParams }),
  /** Light enemies can be grabbed at any time; others only while dazed. */
  light: z.boolean().default(false),
  grabbable: z.boolean().default(true),
  /** Weapon the family carries; dropped as a pickup when knocked down (disarm). */
  weapon: z.string().optional(),
  /** Hit-to-KO for civilians: score penalty instead of damage. */
  civilian: z
    .strictObject({ penalty: z.number().int(), rescueDrop: z.string().optional() })
    .optional(),
  /** Shadow size multiplier. */
  shadow: z.number().default(1),
  sfx: sfxMap.default({}),
  /** Lines shown in a speech bubble on spawn or KO (Deadweight Dave). */
  lines: z
    .strictObject({ spawn: z.array(z.string()).default([]), ko: z.array(z.string()).default([]) })
    .default({ spawn: [], ko: [] }),
  parodyMeta,
});
export type EnemyFamilyFile = z.infer<typeof enemyFamilyFile>;
