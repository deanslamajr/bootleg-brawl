import { z } from "zod";
import { hexColor, id, rigId, schemaVersion } from "./common";

export const masterPaletteFile = z.strictObject({
  schemaVersion,
  colors: z.array(hexColor).length(64),
});

/** 16-color palettes. Index 0 is always transparent and its color is ignored. */
export const palettesFile = z.strictObject({
  schemaVersion,
  palettes: z.record(id, z.array(hexColor).length(16)),
});
export type PalettesFile = z.infer<typeof palettesFile>;

export const joint = z.tuple([z.number(), z.number()]);
export const pose = z.strictObject({
  j: z.record(z.string(), joint),
  /** Whole-body rotation in 1/256 turns about the hip (knockdowns, rolls). */
  rot: z.number().default(0),
});
export type Pose = z.infer<typeof pose>;

export const rigFile = z.strictObject({
  id: rigId,
  schemaVersion,
  kind: z.enum(["humanoid", "nonhuman"]),
  frameBox: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  anchor: z.tuple([z.number().int(), z.number().int()]),
  /** Pose coordinates are authored for the medium rig and multiplied by this. */
  scale: z.number().positive(),
  /** Minimum frames per animation the validator requires. */
  requiredStates: z.record(z.string(), z.number().int().positive()),
  poses: z.record(z.string(), pose),
});
export type RigFile = z.infer<typeof rigFile>;

export const instrument = z.strictObject({
  kind: z.enum(["fm", "square", "triangle", "saw", "noise", "kick", "snare", "hat"]),
  volume: z.number().min(0).max(1).default(0.5),
  attack: z.number().nonnegative().default(0.005),
  decay: z.number().nonnegative().default(0.15),
  sustain: z.number().min(0).max(1).default(0.4),
  release: z.number().nonnegative().default(0.08),
  /** FM: modulator ratio and index. */
  ratio: z.number().positive().default(2),
  index: z.number().nonnegative().default(2),
  duty: z.number().min(0.05).max(0.95).default(0.5),
  detune: z.number().default(0),
});

/**
 * Tracker-style music: each channel is a string of space-separated steps, one per row.
 * A step is a note like C4, D#5, a rest ".", or a hold "-".
 */
export const trackFile = z.strictObject({
  id,
  schemaVersion,
  title: z.string(),
  bpm: z.number().positive(),
  rowsPerBeat: z.number().int().positive().default(4),
  /** Row where the loop restarts after the end. */
  loopRow: z.number().int().nonnegative().default(0),
  loop: z.boolean().default(true),
  instruments: z.record(z.string(), instrument),
  /** Named patterns, each a list of channel strings keyed by instrument. */
  patterns: z.record(z.string(), z.record(z.string(), z.string())),
  order: z.array(z.string()).min(1),
  cues: z.array(z.strictObject({ name: z.string(), bar: z.number().int() })).default([]),
});
export type TrackFile = z.infer<typeof trackFile>;

export const beatmapFile = z.strictObject({
  schemaVersion,
  track: id,
  bpm: z.number().positive(),
  offset: z.number().default(0),
  bars: z.number().int().positive(),
  cues: z.array(z.strictObject({ name: z.string(), bar: z.number().int() })),
});
export type BeatmapFile = z.infer<typeof beatmapFile>;

/** sfxr-style synth parameters, rendered to WAV at build time. */
export const sfxParams = z.strictObject({
  wave: z.enum(["square", "saw", "sine", "noise", "triangle"]),
  /** Seconds. */
  attack: z.number().nonnegative().default(0),
  sustain: z.number().nonnegative().default(0.08),
  punch: z.number().min(0).max(1).default(0),
  decay: z.number().nonnegative().default(0.12),
  /** Hz. */
  freq: z.number().positive(),
  freqEnd: z.number().positive().optional(),
  /** Hz/s change in slide speed. */
  slideAccel: z.number().default(0),
  vibratoDepth: z.number().min(0).max(1).default(0),
  vibratoSpeed: z.number().nonnegative().default(0),
  duty: z.number().min(0.05).max(0.95).default(0.5),
  dutySweep: z.number().default(0),
  /** Low-pass cutoff 0..1. */
  lpf: z.number().min(0).max(1).default(1),
  hpf: z.number().min(0).max(1).default(0),
  arpeggio: z.number().default(0),
  arpeggioAt: z.number().min(0).max(1).default(0.5),
  /** Bit crush for the bootleg sound: 1..16 bits. */
  crush: z.number().int().min(1).max(16).default(16),
  volume: z.number().min(0).max(1).default(0.5),
  /** Repeat the envelope this many times (rapid hits). */
  repeat: z.number().int().min(1).default(1),
});
export type SfxParams = z.infer<typeof sfxParams>;

export const sfxFile = z.strictObject({
  schemaVersion,
  sounds: z.record(z.string(), sfxParams),
});
export type SfxFile = z.infer<typeof sfxFile>;

export const forbiddenTermsFile = z.strictObject({
  schemaVersion,
  /** Case-insensitive whole-word matches across every text field and file name. */
  terms: z.array(z.string().min(2)),
  /** Words that contain a term but are allowed (e.g. a dictionary word). */
  allow: z.array(z.string()).default([]),
});

export const manifestEntry = z.strictObject({
  id: z.string(),
  type: z.enum(["core", "character", "enemy", "boss", "stage", "interlude", "music", "campaign"]),
  schemaVersion,
  bundle: z.string(),
  hash: z.string(),
  bytes: z.number().int().nonnegative(),
  requires: z.array(z.string()).default([]),
  /** Unlock rule for characters; select screen filters on it. */
  unlock: z.string().optional(),
  parodyMeta: z.strictObject({ bootlegOf: z.string(), gag: z.string() }).optional(),
  /** Portrait sheet reference for the select screen, loaded before the full bundle. */
  portrait: z.string().optional(),
  displayName: z.string().optional(),
});
export type ManifestEntry = z.infer<typeof manifestEntry>;

export const manifestFile = z.strictObject({
  schemaVersion,
  contentHash: z.string(),
  entries: z.array(manifestEntry),
  rosterOrder: z.array(z.string()),
});
export type ManifestFile = z.infer<typeof manifestFile>;

/** Build-wide settings: feature flags on by default for this build (URL ?flags= overrides). */
/** How often the game screen shows lines (D80). Chances are percents. */
export const speechSettings = z.strictObject({
  /** An enemy KO shows a line at this chance. */
  koChance: z.number().int().min(0).max(100).default(40),
  spawnChance: z.number().int().min(0).max(100).default(20),
  /** No enemy bubble starts within this many ticks of the last one. */
  enemyGapTicks: z.number().int().min(0).default(120),
  /** A hit on a boss shows a hurt line at this chance, at most once per bossGapTicks. */
  bossHurtChance: z.number().int().min(0).max(100).default(25),
  bossGapTicks: z.number().int().min(0).default(180),
});
export type SpeechSettings = z.infer<typeof speechSettings>;

export const settingsFile = z.strictObject({
  schemaVersion,
  flags: z.array(z.string()).default([]),
  speech: speechSettings.default(speechSettings.parse({})),
});
export type SettingsFile = z.infer<typeof settingsFile>;
