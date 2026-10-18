import { z } from "zod";
import { hexColor, id, parodyMeta, schemaVersion } from "./common";

export const STAGE_SCHEMA_VERSION = 1;

export const stageType = z.enum([
  "walk-right",
  "elevator",
  "auto-scroll",
  "vehicle",
  "mounted",
  "multi-tier",
  "isometric",
  "zoom-out",
  "arena",
  "interlude:minigame",
  "interlude:bonus-room",
  "interlude:shop",
  "interlude:map",
  "interlude:cutscene",
  "interlude:qte",
]);
export type StageType = z.infer<typeof stageType>;

export const spawnKind = z.enum([
  "walk",
  "drop",
  "manhole",
  "dumpster",
  "door",
  "ceiling",
  "floor",
]);
export type SpawnKind = z.infer<typeof spawnKind>;

export const wave = z.strictObject({
  family: id,
  /** 0 intern, 1 associate, 2 senior associate, 3 vice president. */
  tier: z.number().int().min(0).max(3).default(0),
  count: z.number().int().positive(),
  side: z.enum(["left", "right", "both", "top"]).default("right"),
  delayTicks: z.number().int().nonnegative().default(0),
  spawnKind: spawnKind.default("walk"),
  /** World x (segment-relative) and depth for spawnKinds that come out of the scenery. */
  x: z.number().optional(),
  y: z.number().optional(),
  /** Count does not scale with player count. */
  fixed: z.boolean().default(false),
});
export type Wave = z.infer<typeof wave>;

export const scrollLock = z.strictObject({
  id: z.string(),
  /** Segment-relative x of the camera's left edge when the lock engages. */
  at: z.number().nonnegative(),
  waves: z.array(wave).min(1),
  text: z.string().optional(),
  /** Mid-boss or boss fought at this lock instead of plain waves. */
  boss: id.optional(),
  /** false: the waves walk on as the screen scrolls past, without stopping the camera. */
  hold: z.boolean().default(true),
});
export type ScrollLock = z.infer<typeof scrollLock>;

export const layerRef = z.strictObject({
  layer: z.string(),
  /** Draw order: lower is further back. Foreground layers draw over actors. */
  depth: z.number().int(),
  speedX: z.number().default(1),
  speedY: z.number().default(0),
  repeat: z.boolean().default(true),
  y: z.number().int().default(0),
  foreground: z.boolean().default(false),
  /** Frame count for animated strips, laid out vertically in the layer. */
  animated: z.number().int().positive().optional(),
  /** Horizontal drift in px/tick (water, clouds). */
  drift: z.number().default(0),
});
export type LayerRef = z.infer<typeof layerRef>;

export const placement = z.strictObject({
  kind: z.enum(["pickup", "breakable", "hazard", "civilian", "npc", "prop"]),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  drops: z
    .array(z.strictObject({ item: z.string(), weight: z.number().int().positive() }))
    .optional(),
  line: z.string().optional(),
  facing: z.union([z.literal(1), z.literal(-1)]).default(-1),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type Placement = z.infer<typeof placement>;

export const gag = z.strictObject({
  propId: z.string(),
  x: z.number(),
  y: z.number(),
  trigger: z.enum(["hit", "step", "proximity", "taunt"]),
  effect: z.enum(["drop", "spawn", "animate", "text", "score", "hazard", "sfx"]),
  params: z
    .strictObject({
      item: z.string().optional(),
      count: z.number().int().optional(),
      text: z.string().optional(),
      score: z.number().int().optional(),
      family: z.string().optional(),
      sfx: z.string().optional(),
      damage: z.number().int().optional(),
      radius: z.number().optional(),
    })
    .default({}),
  once: z.boolean().default(true),
  /** Hits needed before a hit-triggered gag fires. */
  hits: z.number().int().positive().default(1),
});
export type Gag = z.infer<typeof gag>;

export const segmentKind = z.enum([
  "fight",
  "travel",
  "arena",
  "fork",
  "cutscene",
  "qte",
  "elevator",
]);

export const segmentBase = z.object({
  id,
  schemaVersion,
  kind: segmentKind,
  length: z.number().int().min(480),
  /** Walkable depth band in screen pixels from the top of the 270px frame. */
  depth: z.tuple([z.number().int(), z.number().int()]),
  /** Optional polyline narrowing the band: [x, minY, maxY] points. */
  groundBounds: z.array(z.tuple([z.number(), z.number(), z.number()])).default([]),
  scrollLocks: z.array(scrollLock).default([]),
  layers: z.array(layerRef).min(1),
  placements: z.array(placement).default([]),
  gags: z.array(gag).default([]),
  /** Text shown in a banner when the segment starts. */
  intro: z.string().optional(),
  /** Background color behind every layer. */
  sky: hexColor.default("#000000"),
  /** Bounds for the walking start position of players. */
  startX: z.number().default(60),
});

export const bossTrigger = z.strictObject({
  at: z.string(),
  lock: z.string(),
  bossId: id,
  arenaId: id.optional(),
  introCard: z.boolean().default(true),
  midBoss: z.boolean().default(false),
  rescueGate: z.string().optional(),
});

export const stageFile = z.strictObject({
  id,
  schemaVersion,
  gameNumber: z.number().int().min(0).max(999),
  titleCard: z.strictObject({
    title: z.string(),
    subtitle: z.string(),
    houseRulesText: z.string(),
    announcerLine: z.string(),
    /** Shown when the pedant of the party fixes the Announcer's grammar. */
    announcerLineCorrected: z.string().optional(),
    copyright: z.string().default("© NOBODY. ALL RIGHTS RESERVE."),
  }),
  type: stageType,
  rules: z
    .object({
      requires: z.array(z.string()).default([]),
      laneTolerance: z.number().int().positive().default(10),
      difficultyBaseline: z.number().int().min(1).max(10).default(3),
      friendlyFireDefault: z.enum(["off", "weapons", "chaos"]).default("off"),
      timerHealth: z.boolean().optional(),
      invertGravity: z.boolean().optional(),
      gore: z.boolean().optional(),
      widescreen: z.boolean().optional(),
    })
    .loose(),
  palette: z.array(hexColor).min(2).max(32),
  skin: z
    .strictObject({
      outline: hexColor.default("#1a1420"),
      shadow: z.enum(["ellipse", "dither", "none"]).default("ellipse"),
      hud: z.enum(["default", "sewer", "neon"]).default("default"),
    })
    .default({ outline: "#1a1420", shadow: "ellipse", hud: "default" }),
  segments: z.array(z.string()).min(1),
  bossTriggers: z.array(bossTrigger).default([]),
  forks: z
    .array(
      z.strictObject({
        at: z.string(),
        options: z.array(z.strictObject({ label: z.string(), nextSegment: z.string() })).min(2),
      }),
    )
    .default([]),
  interludes: z
    .strictObject({
      before: z.array(z.string()).default([]),
      after: z.array(z.string()).default([]),
    })
    .default({ before: [], after: [] }),
  music: z.strictObject({
    track: z.string(),
    boss: z.string().optional(),
    cues: z
      .array(
        z.strictObject({
          at: z.string(),
          action: z.enum(["switch", "stop", "stinger"]),
          track: z.string().optional(),
        }),
      )
      .default([]),
  }),
  gagHooks: z
    .strictObject({
      /** The recurring first enemy and the costume he wears in this game. */
      deadweightDave: z.strictObject({ costume: z.string(), line: z.string() }).optional(),
      /** Floating-TV news anchor bulletins shown when a scroll lock clears. */
      dirkHeadline: z.array(z.strictObject({ lock: z.string(), line: z.string() })).default([]),
      /** Segments where the family dog shows up in the background. */
      sprinkles: z.array(z.string()).default([]),
      quillbert: z.array(z.strictObject({ segment: z.string(), x: z.number() })).default([]),
    })
    .default({ dirkHeadline: [], sprinkles: [], quillbert: [] }),
  outro: z
    .strictObject({
      /** Lickspittle's escape line at the end of the stage. */
      lickspittle: z.string(),
      announcer: z.string().optional(),
    })
    .optional(),
  parodyMeta,
});
export type StageFile = z.infer<typeof stageFile>;

export const layerOp: z.ZodType<LayerOp> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("fill"), color: hexColor }),
    z.strictObject({
      op: z.literal("rect"),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      color: hexColor,
    }),
    z.strictObject({
      op: z.literal("gradient"),
      y: z.number(),
      h: z.number(),
      colors: z.array(hexColor).min(2),
    }),
    z.strictObject({
      op: z.literal("bricks"),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      color: hexColor,
      mortar: hexColor,
      bw: z.number().default(12),
      bh: z.number().default(6),
    }),
    z.strictObject({
      op: z.literal("windows"),
      x: z.number(),
      y: z.number(),
      cols: z.number().int(),
      rows: z.number().int(),
      ww: z.number(),
      wh: z.number(),
      gapX: z.number(),
      gapY: z.number(),
      color: hexColor,
      lit: hexColor,
      litChance: z.number().int().min(0).max(100).default(30),
      frame: hexColor.optional(),
    }),
    z.strictObject({
      op: z.literal("repeat"),
      x: z.number().default(0),
      every: z.number().positive(),
      count: z.number().int().positive(),
      ops: z.array(layerOp),
    }),
    z.strictObject({
      op: z.literal("circle"),
      x: z.number(),
      y: z.number(),
      r: z.number(),
      color: hexColor,
    }),
    z.strictObject({
      op: z.literal("ellipse"),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      color: hexColor,
    }),
    z.strictObject({
      op: z.literal("line"),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      color: hexColor,
      width: z.number().default(1),
    }),
    z.strictObject({
      op: z.literal("poly"),
      points: z.array(z.tuple([z.number(), z.number()])).min(3),
      color: hexColor,
    }),
    z.strictObject({
      op: z.literal("text"),
      x: z.number(),
      y: z.number(),
      text: z.string(),
      color: hexColor,
      scale: z.number().int().positive().default(1),
    }),
    z.strictObject({
      op: z.literal("noise"),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      color: hexColor,
      density: z.number().int().min(1).max(100),
      seed: z.number().int().default(1),
    }),
    z.strictObject({
      op: z.literal("tiles"),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      tw: z.number(),
      th: z.number(),
      color: hexColor,
      alt: hexColor,
      skew: z.number().default(0),
    }),
    z.strictObject({
      op: z.literal("stripes"),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      every: z.number(),
      width: z.number(),
      color: hexColor,
      vertical: z.boolean().default(false),
    }),
    z.strictObject({
      op: z.literal("image"),
      /** A generated indexed PNG in the stage palette, relative to the layers folder. */
      file: z.string(),
      x: z.number().default(0),
      y: z.number().default(0),
    }),
    z.strictObject({
      op: z.literal("item"),
      /** Draw a prop or pickup sprite into the layer (background clutter). */
      item: z.string(),
      x: z.number(),
      y: z.number(),
    }),
  ]),
);
export type LayerOp =
  | { op: "fill"; color: string }
  | { op: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { op: "gradient"; y: number; h: number; colors: string[] }
  | {
      op: "bricks";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      mortar: string;
      bw: number;
      bh: number;
    }
  | {
      op: "windows";
      x: number;
      y: number;
      cols: number;
      rows: number;
      ww: number;
      wh: number;
      gapX: number;
      gapY: number;
      color: string;
      lit: string;
      litChance: number;
      frame?: string;
    }
  | { op: "repeat"; x: number; every: number; count: number; ops: LayerOp[] }
  | { op: "circle"; x: number; y: number; r: number; color: string }
  | { op: "ellipse"; x: number; y: number; w: number; h: number; color: string }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { op: "poly"; points: [number, number][]; color: string }
  | { op: "text"; x: number; y: number; text: string; color: string; scale: number }
  | {
      op: "noise";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      density: number;
      seed: number;
    }
  | {
      op: "tiles";
      x: number;
      y: number;
      w: number;
      h: number;
      tw: number;
      th: number;
      color: string;
      alt: string;
      skew: number;
    }
  | {
      op: "stripes";
      x: number;
      y: number;
      w: number;
      h: number;
      every: number;
      width: number;
      color: string;
      vertical: boolean;
    }
  | { op: "image"; file: string; x: number; y: number }
  | { op: "item"; item: string; x: number; y: number };

export const layerFile = z.strictObject({
  id: z.string(),
  schemaVersion,
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(1024),
  ops: z.array(layerOp),
});
export type LayerFile = z.infer<typeof layerFile>;
