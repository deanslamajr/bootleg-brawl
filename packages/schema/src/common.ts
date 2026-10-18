import { z } from "zod";

export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const id = z.string().regex(ID_RE, "ids are lowercase words joined by hyphens");
export const hexColor = z.string().regex(/^#[0-9a-f]{6}$/, "colors are lowercase #rrggbb");

/** Every content file carries one. Runtime refuses files below the type's minimum. */
export const schemaVersion = z.number().int().nonnegative();

export const ticks = z.number().int().nonnegative();
export const px = z.number();
/** [x, z, w, h] in unit space: x from the anchor toward the facing direction, z up from the feet. */
export const box = z.tuple([px, px, z.number().positive(), z.number().positive()]);
export type Box = z.infer<typeof box>;

export const parodyMeta = z.strictObject({
  /** Generic description of the role being parodied. Never a name from the source. */
  bootlegOf: z.string().min(3),
  gag: z.string().min(3),
  /** Extra per-file terms on top of content/forbidden-terms.json. */
  forbiddenTerms: z.array(z.string()).default([]),
  /** Visible bootleg tells (section 10). Characters and stages need at least two. */
  tells: z.array(z.string()).default([]),
});
export type ParodyMeta = z.infer<typeof parodyMeta>;

export const archetype = z.enum([
  "balanced",
  "fast",
  "grappler",
  "ranged",
  "weird",
  "nonhuman",
  "class-party",
  "family",
  "mascot-vehicle",
]);
export type Archetype = z.infer<typeof archetype>;

export const rigId = z.enum(["small", "medium", "large", "huge", "nonhuman"]);
export type RigId = z.infer<typeof rigId>;

export const sfxMap = z.record(z.string(), z.string());

/** Input-derived commands that state transitions can listen for. */
export const command = z.enum([
  "attack",
  "attackHeld",
  "attackRelease",
  "jump",
  "special",
  "specialF",
  "specialB",
  "specialU",
  "specialD",
  "back",
  "dash",
  "dashAttack",
  "airAttack",
  "dive",
  "stomp",
  "pickup",
  "throwF",
  "throwB",
  "throwCam",
  "grabHit",
  "taunt",
  "teamup",
  "land",
  "chargeRelease",
  "any",
  "drop",
]);
export type Command = z.infer<typeof command>;

export const shapeKind = z.enum(["ellipse", "rect", "poly", "line", "circle", "tri", "sprite"]);

/**
 * A vector primitive drawn by the bake step onto a rig pose. A `sprite` shape blits a generated
 * indexed PNG instead: `file` names it, `scale` and `flip` transform it, and `color` is unused.
 */
const shapeObject = z.strictObject({
  shape: shapeKind,
  /** Joint the shape is attached to. */
  at: z.string().default("hip"),
  /**
   * For `line`: second joint. For `alignTo`: rotate the shape along at -> alignTo. A sprite turns
   * by the change from the idle pose, so it looks as generated at rest, and it snaps to a quarter
   * turn within 9 degrees of one.
   */
  to: z.string().optional(),
  alignTo: z.string().optional(),
  dx: z.number().default(0),
  dy: z.number().default(0),
  w: z.number().default(4),
  h: z.number().default(4),
  r: z.number().default(2),
  /** Rotation in 1/256 turns. */
  rot: z.number().default(0),
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  color: z.number().int().min(1).max(15),
  outline: z.boolean().default(true),
  shade: z.boolean().default(true),
  /** Draw order. Lower draws first. Built-in limbs use: armB 10, legB 20, torso 30, legF 40, head 50, armF 60. */
  z: z.number().default(55),
  /** Only drawn on poses whose name starts with one of these prefixes. */
  states: z.array(z.string()).optional(),
  exceptStates: z.array(z.string()).optional(),
  /** Only drawn while the entity holds its improvised weapon (or only when it does not). */
  whenWeapon: z.boolean().optional(),
  /** `sprite` only: the PNG, relative to the folder of the file that holds the shape. */
  file: z.string().optional(),
  /** `sprite` only: pixel scale of the PNG (1 when unset). The rig scale does not apply to it. */
  scale: z.number().positive().optional(),
  /** `sprite` only: mirror the PNG horizontally (false when unset). */
  flip: z.boolean().optional(),
});

/**
 * Sprite shapes need no color and draw no outline unless asked, because the converter already
 * drew one. `scale` and `flip` stay optional so vector shapes parse exactly as before.
 */
export const shape = z.preprocess(
  (v) =>
    v && typeof v === "object" && (v as { shape?: unknown }).shape === "sprite"
      ? { color: 1, outline: false, shade: false, ...(v as object) }
      : v,
  shapeObject.refine((s) => s.shape !== "sprite" || !!s.file, {
    message: "a sprite shape needs a file",
    path: ["file"],
  }),
);
export type Shape = z.infer<typeof shape>;

export const overlaysFile = z.strictObject({
  schemaVersion,
  body: z
    .strictObject({
      scale: z.number().positive().default(1),
      headR: z.number().default(7),
      headW: z.number().optional(),
      headH: z.number().optional(),
      torsoW: z.number().default(9),
      armW: z.number().default(3),
      legW: z.number().default(4),
      footL: z.number().default(5),
      handR: z.number().default(2),
      /** Palette indices for built-in limbs. */
      skin: z.number().int().default(2),
      torso: z.number().int().default(6),
      legs: z.number().int().default(8),
      feet: z.number().int().default(13),
      arms: z.number().int().default(2),
      /** Built-in parts to skip (e.g. a bowling pin has no torso). */
      hide: z
        .array(z.enum(["head", "torso", "armF", "armB", "legF", "legB", "hands", "feet", "face"]))
        .default([]),
    })
    .default({
      scale: 1,
      headR: 7,
      torsoW: 9,
      armW: 3,
      legW: 4,
      footL: 5,
      handR: 2,
      skin: 2,
      torso: 6,
      legs: 8,
      feet: 13,
      arms: 2,
      hide: [],
    }),
  layers: z
    .strictObject({
      head: z.array(shape).default([]),
      torso: z.array(shape).default([]),
      legs: z.array(shape).default([]),
      weapon: z.array(shape).default([]),
      fx: z.array(shape).default([]),
    })
    .default({ head: [], torso: [], legs: [], weapon: [], fx: [] }),
  /**
   * Frames that cannot be composed from the rig alone. The key is a pose name states can use;
   * `base` names the rig pose used as the skeleton (defaults to the key itself).
   */
  uniqueFrames: z
    .record(
      z.string(),
      z.strictObject({
        base: z.string().optional(),
        shapes: z.array(shape),
        keepBody: z.boolean().default(true),
        keepOverlays: z.boolean().default(true),
      }),
    )
    .default({}),
});
export type OverlaysFile = z.infer<typeof overlaysFile>;
