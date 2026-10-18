// Generated art (DECISIONS D50 to D54). art.json holds the prompts for one content folder, and
// every accepted PNG has a sidecar that records how it was made. Prompts are content text, so
// the forbidden-terms scan covers them like any other document.

import { z } from "zod";
import { hexColor, schemaVersion } from "./common";

export const artModel = z.enum(["klein4b", "schnell", "dev", "kontext"]);
export type ArtModel = z.infer<typeof artModel>;

/** Part ids are lowercase words; a colon separates a pose or a frame ("hairwhip:0"). */
export const artPartId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9:-]*$/, "part ids are lowercase words, hyphens and colons");

export const loraRef = z.strictObject({
  model: z.string(),
  weight: z.number().min(-4).max(4).default(1),
});

/** Conversion settings. Unset fields take the defaults for the part's use (see pixelize.ts). */
export const artConversion = z.strictObject({
  /**
   * The background color to clear. "auto" (the default for parts and items) samples the image
   * border. null keeps every pixel (backgrounds, and images from background removal).
   */
  key: z
    .union([hexColor, z.literal("auto")])
    .nullable()
    .optional(),
  keyDistance: z.number().positive().optional(),
  erode: z.number().int().min(0).max(3).optional(),
  dither: z.boolean().optional(),
  outline: z.boolean().optional(),
  cleanup: z.boolean().optional(),
  /** Indices the lone-pixel cleanup never removes, such as eyes. */
  keep: z.array(z.number().int().min(1).max(255)).optional(),
});
export type ArtConversion = z.infer<typeof artConversion>;

export const artPart = z.strictObject({
  id: artPartId,
  /** The joint the part goes on. Informational: overlays.json places the sprite. */
  joint: z.string().optional(),
  /** Final height in pixels, outline included. Layers default to the layer height. */
  heightPx: z.number().int().positive().optional(),
  /**
   * Final width, outline included. Layers and parts stretch to widthPx x heightPx, and items
   * fit inside it. A part without widthPx keeps the aspect of the generated image.
   */
  widthPx: z.number().int().positive().optional(),
  /** Palette indices the quantizer may use. Index 1 (outline) is always allowed. */
  indices: z.array(z.number().int().min(1).max(255)).optional(),
  prompt: z.string().min(3),
  candidates: z.number().int().min(1).max(4).default(2),
  /**
   * The anchor as a fraction of the final image, [0.5, 1] is the bottom middle. "neck" puts it
   * under the lowest skin pixels, where a head meets the body.
   */
  anchor: z
    .union([z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]), z.literal("neck")])
    .optional(),
  model: artModel.optional(),
  /** Actor parts use the accepted look image as the identity reference. */
  reference: z.boolean().default(true),
  seed: z.number().int().nonnegative().optional(),
  /** Generation size. Defaults: parts and items 512x512, layers twice the layer size. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /**
   * Layers that repeat: the converter blends the last 32 columns into the first 32. Unset, it
   * follows the segments: true when any segment repeats the layer.
   */
  tile: z.boolean().optional(),
  conversion: artConversion.optional(),
});
export type ArtPart = z.infer<typeof artPart>;

export const artFile = z.strictObject({
  schemaVersion,
  /** Replaces the style prefix from content/art/style.json for this folder. */
  style: z.string().optional(),
  model: artModel.default("klein4b"),
  seed: z.number().int().nonnegative(),
  /** The whole actor, standing. It is the identity reference for the parts and the busts. */
  look: z
    .strictObject({
      prompt: z.string().min(3),
      width: z.number().int().positive().default(512),
      height: z.number().int().positive().default(768),
      model: artModel.optional(),
    })
    .optional(),
  parts: z.array(artPart).default([]),
});
export type ArtFile = z.infer<typeof artFile>;

export const artModelSettings = z.strictObject({
  steps: z.number().int().positive().optional(),
  CFGScale: z.number().nonnegative().optional(),
  scheduler: z.string().optional(),
  lora: z.array(loraRef).optional(),
});

/** content/art/style.json: the shared prompt prefixes and the model defaults. */
export const artStyleFile = z.strictObject({
  schemaVersion,
  /** Starts every actor, item and bust prompt. */
  prefix: z.string(),
  /** Starts every background prompt. */
  layerPrefix: z.string(),
  models: z.partialRecord(artModel, artModelSettings).default({}),
});
export type ArtStyleFile = z.infer<typeof artStyleFile>;

/** The sidecar `<name>.gen.json` next to every accepted PNG. */
export const spriteMeta = z.strictObject({
  schemaVersion,
  target: z.string(),
  part: z.string(),
  /** The Runware AIR id. */
  model: z.string(),
  positivePrompt: z.string(),
  seed: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  steps: z.number().int().positive(),
  CFGScale: z.number().nonnegative(),
  scheduler: z.string().optional(),
  lora: z.array(loraRef).default([]),
  /** What the request used as its identity reference, if anything. */
  reference: z.string().optional(),
  taskUUID: z.string(),
  imageUUID: z.string(),
  cost: z.number().nonnegative(),
  generatedAt: z.string(),
  /** The anchor in final image pixels. The bake puts it on the shape's joint. */
  anchor: z.tuple([z.number(), z.number()]),
  conversion: z.record(z.string(), z.unknown()),
});
export type SpriteMeta = z.infer<typeof spriteMeta>;
