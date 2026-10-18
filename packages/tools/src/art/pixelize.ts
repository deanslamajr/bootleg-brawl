// The conversion pipeline (plan section 3.5): a Runware PNG becomes an indexed image in an actor,
// item or stage palette. Each step is exported on its own so a test can call it alone.

import type { ArtConversion } from "@bb/schema";
import { IndexedImage } from "./raster";
import type { RgbaImage } from "./png-rgba";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export type PixelizeUse = "part" | "item" | "layer";

export interface PixelizeRecipe {
  use: PixelizeUse;
  /** Final height, outline included. */
  heightPx: number;
  /** Final width. Layers and parts stretch to it; items fit inside widthPx x heightPx. */
  widthPx?: number;
  /** Indices the quantizer may use. Defaults to every palette entry after index 0. */
  indices?: number[];
  /** Anchor as a fraction of the final image, or "neck" (see neckAnchor). */
  anchor?: [number, number] | "neck";
  tile?: boolean;
  conversion?: ArtConversion;
}

export interface ResolvedConversion {
  key: string | null;
  keyDistance: number;
  erode: number;
  dither: boolean;
  outline: boolean;
  cleanup: boolean;
  keep: number[];
}

export interface PixelizeResult {
  img: IndexedImage;
  anchor: [number, number];
  /** Everything needed to repeat the conversion, for the sidecar. */
  conversion: Record<string, unknown>;
}

const DEFAULTS: Record<PixelizeUse, ResolvedConversion> = {
  part: {
    key: "auto",
    keyDistance: 60,
    erode: 1,
    dither: false,
    outline: true,
    cleanup: true,
    keep: [1, 12, 13],
  },
  item: {
    key: "auto",
    keyDistance: 60,
    erode: 1,
    dither: false,
    outline: true,
    cleanup: true,
    keep: [1],
  },
  layer: {
    key: null,
    keyDistance: 60,
    erode: 0,
    dither: true,
    outline: false,
    cleanup: false,
    keep: [],
  },
};

const DEFAULT_ANCHOR: Record<PixelizeUse, [number, number]> = {
  part: [0.5, 0.5],
  item: [0.5, 1],
  layer: [0, 0],
};

/** Columns a tiling layer blends across its seam. */
export const SEAM = 32;

/** Actor palette indices 2 and 3 are skin. */
const SKIN = new Set([2, 3]);

/**
 * Where a head meets the body: under the middle of the skin in the lowest three skin rows, which
 * is the neck or, on a head drawn without one, the chin. A head with no skin gets the bottom
 * middle.
 */
export function neckAnchor(img: IndexedImage): [number, number] {
  let bottom = -1;
  for (let y = img.height - 1; y >= 0 && bottom < 0; y--)
    for (let x = 0; x < img.width; x++) if (SKIN.has(img.get(x, y))) bottom = y;
  if (bottom < 0) return [img.width / 2, img.height];
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, bottom - 2); y <= bottom; y++)
    for (let x = 0; x < img.width; x++)
      if (SKIN.has(img.get(x, y))) {
        sum += x + 0.5;
        n++;
      }
  return [sum / n, bottom + 1];
}

export function resolveConversion(use: PixelizeUse, c: ArtConversion = {}): ResolvedConversion {
  const d = DEFAULTS[use];
  return {
    key: c.key === undefined ? d.key : c.key,
    keyDistance: c.keyDistance ?? d.keyDistance,
    erode: c.erode ?? d.erode,
    dither: c.dither ?? d.dither,
    outline: c.outline ?? d.outline,
    cleanup: c.cleanup ?? d.cleanup,
    keep: c.keep ?? d.keep,
  };
}

export function hexRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function copy(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}

/** The median color of the outer two-pixel frame: the background the model actually painted. */
export function borderColor(img: RgbaImage): string {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (x > 1 && y > 1 && x < img.width - 2 && y < img.height - 2) continue;
      const p = (y * img.width + x) * 4;
      rs.push(img.data[p]!);
      gs.push(img.data[p + 1]!);
      bs.push(img.data[p + 2]!);
    }
  const mid = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
  return "#" + [mid(rs), mid(gs), mid(bs)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Step 2a: the background becomes clear. A pixel is background when it is within `distance` of
 * the key and connected to the border through background, or within 60% of `distance` anywhere,
 * which catches enclosed holes such as the gap between an arm and the body. Mostly transparent
 * pixels are clear too. `key` "auto" samples the border, because models drift from the color
 * the prompt names: the probe saw "magenta" from 36 to 160 away from #ff00ff.
 */
export function keyBackground(img: RgbaImage, key: string, distance: number): RgbaImage {
  const out = copy(img);
  const [kr, kg, kb] = hexRgb(key === "auto" ? borderColor(img) : key);
  const { width: w, height: h } = img;
  const near = new Uint8Array(w * h);
  const d2 = distance * distance;
  const hole2 = d2 * 0.36;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const dr = img.data[p]! - kr;
    const dg = img.data[p + 1]! - kg;
    const db = img.data[p + 2]! - kb;
    const d = dr * dr + dg * dg + db * db;
    near[i] = img.data[p + 3]! < 128 || d <= hole2 ? 2 : d <= d2 ? 1 : 0;
  }
  // Flood from the border through every near pixel.
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (near[i] && !bg[i]) {
      bg[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < (h - 1) * w) push(i + w);
  }
  for (let i = 0; i < w * h; i++) out.data[i * 4 + 3] = bg[i] || near[i] === 2 ? 0 : 255;
  return out;
}

/** Step 2b: clears opaque pixels that touch a clear one, `n` times. This eats the key fringe. */
export function erodeAlpha(img: RgbaImage, n: number): RgbaImage {
  let cur = copy(img);
  const { width: w, height: h } = img;
  for (let k = 0; k < n; k++) {
    const next = copy(cur);
    const clear = (x: number, y: number) =>
      x < 0 || y < 0 || x >= w || y >= h || cur.data[(y * w + x) * 4 + 3] === 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (clear(x, y)) continue;
        if (clear(x - 1, y) || clear(x + 1, y) || clear(x, y - 1) || clear(x, y + 1))
          next.data[(y * w + x) * 4 + 3] = 0;
      }
    cur = next;
  }
  return cur;
}

/** Step 3: crops to the bounds of the opaque pixels. Returns null when nothing is opaque. */
export function cropToAlpha(
  img: RgbaImage,
): { img: RgbaImage; box: [number, number, number, number] } | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return null;
  return {
    img: crop(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1),
    box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1],
  };
}

export function crop(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let yy = 0; yy < h; yy++)
    data.set(
      img.data.subarray(((y + yy) * img.width + x) * 4, ((y + yy) * img.width + x + w) * 4),
      yy * w * 4,
    );
  return { width: w, height: h, data };
}

/** Center crop to the aspect `w / h` (backgrounds). */
export function cropToAspect(img: RgbaImage, w: number, h: number): RgbaImage {
  const want = w / h;
  if (img.width / img.height > want) {
    const cw = Math.max(1, Math.round(img.height * want));
    return crop(img, Math.floor((img.width - cw) / 2), 0, cw, img.height);
  }
  const ch = Math.max(1, Math.round(img.width / want));
  return crop(img, 0, Math.floor((img.height - ch) / 2), img.width, ch);
}

/** Box-filter weights for resampling `n` source cells into `m` destination cells. */
function weights(n: number, m: number): { start: number; w: number[] }[] {
  const scale = n / m;
  const out: { start: number; w: number[] }[] = [];
  for (let d = 0; d < m; d++) {
    const a = d * scale;
    const b = (d + 1) * scale;
    const start = Math.floor(a);
    const w: number[] = [];
    for (let s = start; s < Math.min(n, Math.ceil(b)); s++)
      w.push((Math.min(b, s + 1) - Math.max(a, s)) / scale);
    out.push({ start, w });
  }
  return out;
}

/**
 * Area-average resize to exactly `w` x `h`, weighted by alpha so the key color never bleeds
 * into the edge pixels. A pixel ends up opaque when at least half its area was opaque.
 */
export function resizeArea(img: RgbaImage, w: number, h: number): RgbaImage {
  const wx = weights(img.width, w);
  const wy = weights(img.height, h);
  // Horizontal pass into premultiplied floats, then the vertical pass.
  const tmp = new Float32Array(w * img.height * 4);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < w; x++) {
      const { start, w: ws } = wx[x]!;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      ws.forEach((k, i) => {
        const p = (y * img.width + start + i) * 4;
        const al = (img.data[p + 3]! / 255) * k;
        r += img.data[p]! * al;
        g += img.data[p + 1]! * al;
        b += img.data[p + 2]! * al;
        a += al;
      });
      const q = (y * w + x) * 4;
      tmp[q] = r;
      tmp[q + 1] = g;
      tmp[q + 2] = b;
      tmp[q + 3] = a;
    }
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const { start, w: ws } = wy[y]!;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      ws.forEach((k, i) => {
        const q = ((start + i) * w + x) * 4;
        r += tmp[q]! * k;
        g += tmp[q + 1]! * k;
        b += tmp[q + 2]! * k;
        a += tmp[q + 3]! * k;
      });
      const p = (y * w + x) * 4;
      if (a > 0) {
        data[p] = Math.round(r / a);
        data[p + 1] = Math.round(g / a);
        data[p + 2] = Math.round(b / a);
      }
      data[p + 3] = a >= 0.5 ? 255 : 0;
    }
  return { width: w, height: h, data };
}

/** Step 4: an integer area average first, then an exact resize to the target size. */
export function downsample(
  img: RgbaImage,
  w: number,
  h: number,
): { img: RgbaImage; factor: number } {
  const factor = Math.max(1, Math.min(Math.floor(img.width / w), Math.floor(img.height / h)));
  const mid =
    factor > 1
      ? resizeArea(img, Math.floor(img.width / factor), Math.floor(img.height / factor))
      : img;
  return { img: resizeArea(mid, w, h), factor };
}

/** Cross-fades the last `n` columns into the first `n` and drops them, so the strip tiles. */
export function blendSeam(img: RgbaImage, n: number): RgbaImage {
  const w = img.width - n;
  const out = crop(img, 0, 0, w, img.height);
  for (let y = 0; y < img.height; y++)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const a = (y * img.width + w + i) * 4;
      const b = (y * img.width + i) * 4;
      const o = (y * w + i) * 4;
      for (let k = 0; k < 4; k++)
        out.data[o + k] = Math.round(img.data[a + k]! * (1 - t) + img.data[b + k]! * t);
    }
  return out;
}

/** Weighted RGB distance ("redmean"), closer to perceived difference than plain RGB. */
function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/**
 * Step 5: maps every opaque pixel to the nearest allowed palette entry. With `dither`, a light
 * 4x4 ordered dither nudges each pixel before the match.
 */
export function quantize(
  img: RgbaImage,
  palette: string[],
  indices: number[],
  dither: boolean,
  spread = 24,
): IndexedImage {
  const out = new IndexedImage(img.width, img.height);
  const cols = indices.map((i) => [i, ...hexRgb(palette[i] ?? "#ff00ff")] as const);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const p = (y * img.width + x) * 4;
      if (!img.data[p + 3]) continue;
      const off = dither ? ((BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 - 0.5) * spread : 0;
      const r = img.data[p]! + off;
      const g = img.data[p + 1]! + off;
      const b = img.data[p + 2]! + off;
      let best = cols[0]?.[0] ?? 1;
      let bestD = Infinity;
      for (const [i, cr, cg, cb] of cols) {
        const d = colorDist(r, g, b, cr, cg, cb);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      out.data[y * img.width + x] = best;
    }
  return out;
}

/**
 * Step 6: a pixel that shares its index with none of its eight neighbors takes the most common
 * neighbor index. That clears specks outside the silhouette too. Indices in `keep` (eyes, the
 * outline) stay unless the speck floats in empty space. This runs before the outline, because
 * an outline turns a floating speck into a 3x3 blot.
 */
export function cleanupLonePixels(img: IndexedImage, keep: number[]): IndexedImage {
  const out = new IndexedImage(img.width, img.height);
  out.data.set(img.data);
  const kept = new Set(keep);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const v = img.get(x, y);
      if (!v) continue;
      const counts = new Map<number, number>();
      let same = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const n = img.get(x + dx, y + dy);
          if (n === v) same = true;
          counts.set(n, (counts.get(n) ?? 0) + 1);
        }
      if (same) continue;
      let top = 0;
      let topN = -1;
      for (const [k, n] of [...counts].sort((a, b) => a[0] - b[0]))
        if (n > topN) {
          top = k;
          topN = n;
        }
      if (kept.has(v) && top !== 0) continue;
      out.set(x, y, top);
    }
  return out;
}

/** Step 7: pads by one pixel and outlines every opaque pixel's 4-neighbors in `color`. */
export function addOutline(img: IndexedImage, color = 1): IndexedImage {
  const out = new IndexedImage(img.width + 2, img.height + 2);
  out.blit(img, 1, 1);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      if (out.get(x, y)) continue;
      const sx = x - 1;
      const sy = y - 1;
      if (img.get(sx - 1, sy) || img.get(sx + 1, sy) || img.get(sx, sy - 1) || img.get(sx, sy + 1))
        out.set(x, y, color);
    }
  return out;
}

/** The final content size before the outline, from the cropped source size and the recipe. */
export function targetSize(
  srcW: number,
  srcH: number,
  recipe: PixelizeRecipe,
  outline: boolean,
): [number, number] {
  const pad = outline ? 2 : 0;
  const h = Math.max(1, recipe.heightPx - pad);
  // Layers, and parts with both sizes (torsos that must match the rig's shoulders), stretch.
  if (recipe.use === "layer" || (recipe.use === "part" && recipe.widthPx))
    return [Math.max(1, (recipe.widthPx ?? srcW) - pad), h];
  let th = h;
  let tw = Math.max(1, Math.round((srcW * th) / srcH));
  if (recipe.widthPx && tw > recipe.widthPx - pad) {
    tw = Math.max(1, recipe.widthPx - pad);
    th = Math.max(1, Math.round((srcH * tw) / srcW));
  }
  return [tw, th];
}

/** Runs the whole pipeline. Throws when keying leaves nothing. */
export function pixelize(
  rgba: RgbaImage,
  recipe: PixelizeRecipe,
  palette: string[],
): PixelizeResult {
  const conv = resolveConversion(recipe.use, recipe.conversion);
  let img = rgba;
  let box: [number, number, number, number] = [0, 0, rgba.width, rgba.height];
  let keyColor: string | null = null;
  if (recipe.use === "layer") {
    img = cropToAspect(
      img,
      (recipe.widthPx ?? img.width) + (recipe.tile ? SEAM : 0),
      recipe.heightPx,
    );
  } else {
    if (conv.key) {
      keyColor = conv.key === "auto" ? borderColor(img) : conv.key;
      img = keyBackground(img, keyColor, conv.keyDistance);
    }
    if (conv.erode) img = erodeAlpha(img, conv.erode);
    const c = cropToAlpha(img);
    if (!c) throw new Error("the key removed every pixel; try a smaller keyDistance");
    img = c.img;
    box = c.box;
  }
  const [tw, th] = targetSize(img.width, img.height, recipe, conv.outline);
  const d = downsample(img, recipe.use === "layer" && recipe.tile ? tw + SEAM : tw, th);
  img = d.img;
  if (recipe.use === "layer" && recipe.tile) img = blendSeam(img, SEAM);
  const indices = recipe.indices ?? palette.map((_, i) => i).filter((i) => i > 0);
  let out = quantize(img, palette, indices, conv.dither);
  if (conv.cleanup) out = cleanupLonePixels(out, conv.keep);
  if (conv.outline) out = addOutline(out, 1);
  const frac = recipe.anchor ?? DEFAULT_ANCHOR[recipe.use];
  return {
    img: out,
    anchor: frac === "neck" ? neckAnchor(out) : [frac[0] * out.width, frac[1] * out.height],
    conversion: {
      use: recipe.use,
      ...conv,
      keyColor,
      heightPx: recipe.heightPx,
      ...(recipe.widthPx ? { widthPx: recipe.widthPx } : {}),
      indices,
      tile: recipe.tile ?? false,
      source: [rgba.width, rgba.height],
      crop: box,
      factor: d.factor,
      size: [out.width, out.height],
    },
  };
}
