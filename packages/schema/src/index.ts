import { z } from "zod";
import { overlaysFile } from "./common";
import { characterFile, kit, CHARACTER_MIN_VERSION, CHARACTER_SCHEMA_VERSION } from "./character";
import { enemyFamilyFile } from "./enemy";
import { arenaFile, bossFile } from "./boss";
import { layerFile, segmentBase, stageFile } from "./stage";
import { itemsFile } from "./items";
import { campaignFile, interludeFile, rosterFile } from "./interlude";
import {
  beatmapFile,
  forbiddenTermsFile,
  manifestFile,
  masterPaletteFile,
  palettesFile,
  rigFile,
  settingsFile,
  sfxFile,
  trackFile,
} from "./assets";
import { statesFile } from "./states";

export * from "./common";
export * from "./states";
export * from "./character";
export * from "./enemy";
export * from "./boss";
export * from "./stage";
export * from "./items";
export * from "./interlude";
export * from "./assets";
export * from "./forbidden";
export * from "./migrations";

/** Shapes a mechanic module merges into content schemas. Every field must be optional. */
export interface SchemaFragments {
  character?: z.ZodRawShape;
  stage?: z.ZodRawShape;
  segment?: z.ZodRawShape;
  enemy?: z.ZodRawShape;
  boss?: z.ZodRawShape;
}

export type ContentType =
  | "character"
  | "states"
  | "overlays"
  | "enemy"
  | "boss"
  | "arena"
  | "stage"
  | "segment"
  | "layer"
  | "items"
  | "interlude"
  | "campaign"
  | "roster"
  | "palettes"
  | "master-palette"
  | "rig"
  | "track"
  | "beatmap"
  | "sfx"
  | "forbidden-terms"
  | "settings"
  | "manifest";

export interface ContentTypeInfo {
  current: number;
  minimum: number;
}

/** Current and minimum supported schema version per content type. */
export const CONTENT_VERSIONS: Record<ContentType, ContentTypeInfo> = {
  character: { current: CHARACTER_SCHEMA_VERSION, minimum: CHARACTER_MIN_VERSION },
  states: { current: 1, minimum: 1 },
  overlays: { current: 1, minimum: 1 },
  enemy: { current: 1, minimum: 1 },
  boss: { current: 1, minimum: 1 },
  arena: { current: 1, minimum: 1 },
  stage: { current: 1, minimum: 1 },
  segment: { current: 1, minimum: 1 },
  layer: { current: 1, minimum: 1 },
  items: { current: 1, minimum: 1 },
  interlude: { current: 1, minimum: 1 },
  campaign: { current: 1, minimum: 1 },
  roster: { current: 1, minimum: 1 },
  palettes: { current: 1, minimum: 1 },
  "master-palette": { current: 1, minimum: 1 },
  rig: { current: 1, minimum: 1 },
  track: { current: 1, minimum: 1 },
  beatmap: { current: 1, minimum: 1 },
  sfx: { current: 1, minimum: 1 },
  "forbidden-terms": { current: 1, minimum: 1 },
  settings: { current: 1, minimum: 1 },
  manifest: { current: 1, minimum: 1 },
};

function fileSchemas(fragments: readonly SchemaFragments[]) {
  const merge = (key: keyof SchemaFragments): z.ZodRawShape =>
    Object.assign({}, ...fragments.map((f) => f[key] ?? {}));
  const characterKit = kit.extend(merge("character"));
  const character = characterFile.extend({
    kit: characterKit.default({ requires: [], flags: [], gags: [] }),
  });
  const stage = stageFile.extend({ rules: stageFile.shape.rules.extend(merge("stage")) });
  return { merge, character, stage };
}

/** Character and stage schemas for files as bundles ship them, without parodyMeta (D62). */
export function buildShippedSchemas(fragments: readonly SchemaFragments[] = []) {
  const { character, stage } = fileSchemas(fragments);
  return {
    character: character.omit({ parodyMeta: true }),
    stage: stage.omit({ parodyMeta: true }),
  };
}

/** Builds the full schema set with every registered module's fragments merged in. */
export function buildSchemas(fragments: readonly SchemaFragments[] = []) {
  const { merge, character, stage } = fileSchemas(fragments);
  const segment = segmentBase.extend(merge("segment")).strict();
  const enemy = enemyFamilyFile.extend(merge("enemy"));
  const boss = bossFile.extend(merge("boss"));
  const schemas: Record<ContentType, z.ZodType> = {
    character,
    states: statesFile,
    overlays: overlaysFile,
    enemy,
    boss,
    arena: arenaFile,
    stage,
    segment,
    layer: layerFile,
    items: itemsFile,
    interlude: interludeFile,
    campaign: campaignFile,
    roster: rosterFile,
    palettes: palettesFile,
    "master-palette": masterPaletteFile,
    rig: rigFile,
    track: trackFile,
    beatmap: beatmapFile,
    sfx: sfxFile,
    "forbidden-terms": forbiddenTermsFile,
    settings: settingsFile,
    manifest: manifestFile,
  };
  return schemas;
}

export type SegmentFile = z.infer<typeof segmentBase> & Record<string, unknown>;

export function formatIssues(file: string, error: z.ZodError): string[] {
  return error.issues.map((i) => `${file}: ${i.path.join(".") || "<root>"}: ${i.message}`);
}
