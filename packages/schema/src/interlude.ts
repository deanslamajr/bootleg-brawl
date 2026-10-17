import { z } from "zod";
import { id, schemaVersion } from "./common";

export const INTERLUDE_SCHEMA_VERSION = 1;

export const cutsceneStep = z.strictObject({
  /** Ticks this step holds before the next; players can skip with attack after `minTicks`. */
  ticks: z.number().int().positive().default(150),
  minTicks: z.number().int().nonnegative().default(30),
  speaker: z.string().optional(),
  text: z.string(),
  /** Actor sprites placed on the cutscene stage. */
  actors: z
    .array(
      z.strictObject({
        def: z.string(),
        pose: z.string().default("idle:0"),
        x: z.number(),
        y: z.number(),
        /** Walk to this x over the step. */
        toX: z.number().optional(),
        facing: z.union([z.literal(1), z.literal(-1)]).default(1),
        tier: z.number().int().default(0),
      }),
    )
    .default([]),
  /** Include every party member as an actor. */
  party: z.boolean().default(false),
  background: z.string().optional(),
  effect: z.enum(["none", "static", "shake", "flash", "suck", "fade"]).default("none"),
  sfx: z.string().optional(),
});

export const interludeFile = z.discriminatedUnion("subtype", [
  z.strictObject({
    id,
    schemaVersion,
    type: z.literal("interlude"),
    subtype: z.literal("minigame"),
    title: z.string(),
    instructions: z.string(),
    game: z.enum(["button-mash"]),
    durationTicks: z.number().int().positive(),
    /** Presses needed to finish one item. */
    pressesPerItem: z.number().int().positive(),
    itemNoun: z.string(),
    scorePerItem: z.number().int(),
    winnerBonus: z.number().int(),
    music: z.string().optional(),
  }),
  z.strictObject({
    id,
    schemaVersion,
    type: z.literal("interlude"),
    subtype: z.literal("map"),
    title: z.string(),
    /** Entries shown on the GAME SELECT list. Disabled entries are the loading gag. */
    entries: z
      .array(
        z.strictObject({
          label: z.string(),
          stageId: z.string().optional(),
          disabledText: z.string().optional(),
        }),
      )
      .min(1),
    voteTicks: z.number().int().positive().default(600),
    footer: z.string(),
  }),
  z.strictObject({
    id,
    schemaVersion,
    type: z.literal("interlude"),
    subtype: z.literal("cutscene"),
    title: z.string().optional(),
    steps: z.array(cutsceneStep).min(1),
    music: z.string().optional(),
    /** Ending cutscenes roll credits afterwards. */
    credits: z.boolean().default(false),
  }),
  z.strictObject({
    id,
    schemaVersion,
    type: z.literal("interlude"),
    subtype: z.enum(["shop", "bonus-room", "qte"]),
    title: z.string(),
    requires: z.array(z.string()).min(1),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
]);
export type InterludeFile = z.infer<typeof interludeFile>;
export type CutsceneStep = z.infer<typeof cutsceneStep>;

export const campaignFile = z.strictObject({
  schemaVersion,
  start: id,
  finale: id,
  nodes: z
    .array(
      z.strictObject({
        stageId: id,
        position: z.tuple([z.number(), z.number()]),
        options: z.array(id).default([]),
      }),
    )
    .min(1),
  /** Shown by the cliffhanger ending when the campaign runs out of built stages. */
  endingInterlude: z.string(),
  credits: z.array(z.string()).default([]),
});
export type CampaignFile = z.infer<typeof campaignFile>;

export const rosterFile = z.strictObject({
  schemaVersion,
  rosterOrder: z.array(id).min(1),
});
export type RosterFile = z.infer<typeof rosterFile>;
