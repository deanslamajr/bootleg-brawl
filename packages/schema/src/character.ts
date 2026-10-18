import { z } from "zod";
import { archetype, id, parodyMeta, rigId, schemaVersion, sfxMap } from "./common";

export const CHARACTER_SCHEMA_VERSION = 1;
export const CHARACTER_MIN_VERSION = 0;

export const characterStats = z.strictObject({
  hp: z.number().int().positive(),
  walkSpeed: z.number().positive(),
  runSpeed: z.number().positive(),
  jumpVel: z.number().positive(),
  /** Throw resistance and knockback scaling, 1 = average. */
  weight: z.number().positive(),
  reach: z.number().positive(),
  damageMult: z.number().positive(),
  /** Health spent by the desperation special. */
  specialCost: z.number().int().nonnegative(),
  magicMeter: z.number().int().optional(),
});
export type CharacterStats = z.infer<typeof characterStats>;

export const improvisedWeapon = z.strictObject({
  id,
  displayName: z.string(),
  /** Connecting hits before it breaks. 0 = never breaks. */
  hits: z.number().int().nonnegative(),
  /** Ticks after breaking until it comes back. */
  respawnTicks: z.number().int().nonnegative().default(600),
  breakText: z.string().optional(),
});

export const teamUp = z.strictObject({
  partnerId: id,
  moveId: z.string(),
  displayName: z.string(),
  bothDirections: z.boolean().default(true),
});

export const kit = z
  .object({
    requires: z.array(z.string()).default([]),
    flags: z.array(z.string()).default([]),
    /** Character gag hooks run by the core (e.g. "hairCatch", "autoEat", "sleepIdle"). */
    gags: z.array(z.string()).default([]),
  })
  .loose();

export const characterVoice = z.strictObject({
  continueLine: z.string(),
  selectLine: z.string(),
  tauntLines: z.array(z.string()).min(1),
  endingText: z.string(),
});

export const characterFile = z.strictObject({
  id,
  schemaVersion,
  displayName: z.string().min(1),
  shortName: z.string().min(1).max(8),
  archetype,
  rig: rigId,
  palette: id,
  /** Optional alternate palettes (player 2-4 duplicates in cabinet mode). */
  altPalettes: z.array(id).default([]),
  overlays: z.string().default("overlays.json"),
  states: z.string().default("states.json"),
  uniqueFrames: z.array(z.string()).default([]),
  stats: characterStats,
  /** State names for the base move set. Defaults come from the archetype template. */
  moves: z
    .strictObject({
      chain: z.array(z.string()).min(1).max(4),
      jumpAttack: z.string(),
      dashAttack: z.string(),
      backAttack: z.string(),
      grabHits: z.string(),
      throwF: z.string(),
      throwB: z.string(),
      stomp: z.string(),
      specials: z.array(z.string()).min(1),
      commands: z.array(z.string()).default([]),
    })
    .optional(),
  kit: kit.default({ requires: [], flags: [], gags: [] }),
  improvisedWeapon: improvisedWeapon.optional(),
  teamUps: z.array(teamUp).default([]),
  voice: characterVoice,
  sfx: sfxMap.default({}),
  unlock: z.string().regex(/^(v1|secret|stageCleared:[a-z0-9-]+)$/),
  portrait: z.string().default("idle:0"),
  /** A generated bust (relative to the character folder). It replaces the atlas crop. */
  portraitImage: z.string().optional(),
  parodyMeta,
});
export type CharacterFile = z.infer<typeof characterFile>;
