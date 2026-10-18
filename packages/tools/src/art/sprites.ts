// Accepted generated PNGs as the bake sees them: indexed images with an anchor. The loader fills
// the tables from content/; RawContent does not carry them, so the browser build is unchanged.

import type { ArtFile, ArtStyleFile, SpriteMeta } from "@bb/schema";
import { IndexedImage } from "./raster";

export interface SpriteImage {
  img: IndexedImage;
  /** The point (in image pixels) the bake puts on the shape's joint or the item's feet. */
  anchor: [number, number];
  /** Repo-relative path, for messages. */
  file: string;
  /** The sidecar, when one exists. */
  meta?: SpriteMeta;
  /** Entries in the PNG's own palette. */
  paletteSize: number;
}

/** A sprite table keyed by path relative to the folder of the file that names it. */
export type SpriteTable = Record<string, SpriteImage>;

export interface SpriteTables {
  /** Actor id to "sprites/head.png" and the like. */
  actors: Record<string, SpriteTable>;
  /** Stage id to "mainstreet.png" (relative to the stage's layers folder). */
  layers: Record<string, SpriteTable>;
  /** "sprites/bat.png" (relative to content/items). */
  items: SpriteTable;
  /** Shared art outside any actor or stage, such as the title marquee (content/art). */
  shared: SpriteTable;
  /** art.json per content folder, keyed by the repo-relative folder ("content/enemies/interns"). */
  art: Record<string, ArtFile>;
  style?: ArtStyleFile;
}

export function emptySprites(): SpriteTables {
  return { actors: {}, layers: {}, items: {}, shared: {}, art: {} };
}

/** The largest index an image uses. */
export function maxIndex(img: IndexedImage): number {
  let m = 0;
  for (const v of img.data) if (v > m) m = v;
  return m;
}

/** Every index an image uses, sorted, without 0. */
export function usedIndices(img: IndexedImage): number[] {
  const seen = new Set<number>();
  for (const v of img.data) if (v) seen.add(v);
  return [...seen].sort((a, b) => a - b);
}

/**
 * Blits a sprite so its anchor lands on (cx, cy), rotated by `turns` about the anchor with
 * nearest sampling. Index 0 is transparent. With `outline`, transparent pixels next to the sprite
 * become index 1 first, the same way `paint` outlines a shape.
 */
export function blitSprite(
  dst: IndexedImage,
  sp: SpriteImage,
  cx: number,
  cy: number,
  turns: number,
  opts: { scale?: number; flip?: boolean; outline?: boolean } = {},
): void {
  const scale = opts.scale ?? 1;
  const flip = opts.flip ? -1 : 1;
  const { img, anchor } = sp;
  // A quarter turn gets exact 0 and 1, so no source pixel is lost to rounding.
  const quarter = Number.isInteger(turns * 4);
  const c = quarter ? Math.round(Math.cos(turns * Math.PI * 2)) : Math.cos(turns * Math.PI * 2);
  const s = quarter ? Math.round(Math.sin(turns * Math.PI * 2)) : Math.sin(turns * Math.PI * 2);
  // Destination bounds: the rotated, scaled source rectangle around the anchor.
  const corners = [
    [0, 0],
    [img.width, 0],
    [0, img.height],
    [img.width, img.height],
  ].map(([x, y]) => {
    const u = (x! - anchor[0]) * scale * flip;
    const v = (y! - anchor[1]) * scale;
    return [cx + u * c - v * s, cy + u * s + v * c] as const;
  });
  const x0 = Math.floor(Math.min(...corners.map((p) => p[0]))) - 1;
  const x1 = Math.ceil(Math.max(...corners.map((p) => p[0]))) + 1;
  const y0 = Math.floor(Math.min(...corners.map((p) => p[1]))) - 1;
  const y1 = Math.ceil(Math.max(...corners.map((p) => p[1]))) + 1;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const ink = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      // Inverse rotation, then inverse scale and flip, back into source pixels.
      const u = ((dx * c + dy * s) / scale) * flip + anchor[0];
      const v = (-dx * s + dy * c) / scale + anchor[1];
      const v0 = img.get(Math.floor(u), Math.floor(v));
      if (v0) ink[(y - y0) * w + (x - x0)] = v0;
    }
  if (opts.outline) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (ink[y * w + x]) continue;
        const n =
          (x > 0 && ink[y * w + x - 1]) ||
          (x < w - 1 && ink[y * w + x + 1]) ||
          (y > 0 && ink[(y - 1) * w + x]) ||
          (y < h - 1 && ink[(y + 1) * w + x]);
        if (n) dst.set(x0 + x, y0 + y, 1);
      }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = ink[y * w + x]!;
      if (v) dst.set(x0 + x, y0 + y, v);
    }
}
