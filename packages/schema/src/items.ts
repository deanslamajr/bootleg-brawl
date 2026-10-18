import { z } from "zod";
import { box, id, schemaVersion, shape } from "./common";

export const ITEMS_SCHEMA_VERSION = 1;

/**
 * A static sprite drawn from shapes around a single anchor joint named "c" at the item's feet.
 * With `image`, the bake blits that indexed PNG (relative to content/items) instead, and
 * `shapes` can be empty. `frameImages` does the same per extra frame.
 */
export const itemSprite = z
  .strictObject({
    size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    shapes: z.array(shape),
    /** Extra frames, e.g. "broken" or animation frames "f1", "f2". */
    frames: z.record(z.string(), z.array(shape)).default({}),
    palette: id,
    image: z.string().optional(),
    frameImages: z.record(z.string(), z.string()).optional(),
  })
  .refine((s) => s.shapes.length > 0 || !!s.image, {
    message: "an item sprite needs shapes or an image",
    path: ["shapes"],
  });
export type ItemSprite = z.infer<typeof itemSprite>;

export const propDef = z.strictObject({
  sprite: itemSprite,
  hp: z.number().int().nonnegative().default(0),
  breakable: z.boolean().default(false),
  hurt: box.default([-8, 0, 16, 20]),
  drops: z
    .array(z.strictObject({ item: z.string(), weight: z.number().int().positive() }))
    .default([]),
  score: z.number().int().default(50),
  breakSfx: z.string().default("break"),
  /** Liftable scenery (post-v1 lift-and-throw). */
  liftable: z.boolean().default(false),
  /** Spawn holes (manholes, dumpsters) that environmental spawns come out of. */
  spawner: z.boolean().default(false),
});
export type PropDef = z.infer<typeof propDef>;

export const pickupDef = z.strictObject({
  kind: z.enum(["food", "weapon", "coin", "ammo", "potion", "credit", "mascot"]),
  sprite: itemSprite,
  heal: z.number().int().default(0),
  score: z.number().int().default(0),
  weapon: z.string().optional(),
  /** Despawn after this many ticks; 0 = never. */
  lifetime: z.number().int().nonnegative().default(0),
  text: z.string().optional(),
});
export type PickupDef = z.infer<typeof pickupDef>;

export const weaponDef = z.strictObject({
  displayName: z.string(),
  /** Connecting hits before the weapon breaks. */
  hits: z.number().int().positive(),
  moveset: z.enum(["swing", "stab", "heavy"]),
  damage: z.number().int().positive(),
  reach: z.number().positive(),
  /** Sprite drawn in the wielder's front hand; joint "c" is the grip. */
  sprite: itemSprite,
  pickup: z.string(),
  breakText: z.string().default("IT BROKE."),
  /** Ranged weapons: the projectile thrown by down+attack. */
  throwProjectile: z.string().optional(),
});
export type WeaponDef = z.infer<typeof weaponDef>;

export const projectileDef = z.strictObject({
  sprite: itemSprite,
  speed: z.number().positive(),
  damage: z.number().int().nonnegative(),
  knock: z.tuple([z.number(), z.number()]).default([2, 0]),
  hitstop: z.number().int().default(4),
  hitstun: z.number().int().default(18),
  knockdown: z.boolean().default(false),
  lifetime: z.number().int().positive().default(120),
  /** Number of targets it passes through before vanishing. 0 = unlimited. */
  pierce: z.number().int().nonnegative().default(1),
  gravity: z.number().default(0),
  box: box.default([-4, 0, 8, 8]),
  sfx: z.string().default("hit"),
  tags: z.array(z.string()).default([]),
  /** Item dropped where it lands or hits (thrown knives become pickups). */
  dropsPickup: z.string().optional(),
  /** Spins the sprite while flying. */
  spin: z.boolean().default(false),
  /** Scale growth for charged variants (charge-shot level 2+). */
  scale: z.number().default(1),
});
export type ProjectileDef = z.infer<typeof projectileDef>;

export const itemsFile = z.strictObject({
  schemaVersion,
  props: z.record(z.string(), propDef).default({}),
  pickups: z.record(z.string(), pickupDef).default({}),
  weapons: z.record(z.string(), weaponDef).default({}),
  projectiles: z.record(z.string(), projectileDef).default({}),
});
export type ItemsFile = z.infer<typeof itemsFile>;
