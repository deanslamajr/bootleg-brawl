import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reconvertDir } from "../src/commands/art";
import {
  addOutline,
  blendSeam,
  cleanupLonePixels,
  cropToAlpha,
  downsample,
  erodeAlpha,
  keyBackground,
  pixelize,
  quantize,
} from "../src/art/pixelize";
import { decodeIndexedPngSync, type RgbaImage } from "../src/art/png-rgba";
import { writeRgbaPng } from "../src/art/preview";
import { IndexedImage } from "../src/art/raster";

const MAGENTA: [number, number, number] = [255, 0, 255];

/** A w x h image filled with `bg`, with `fill(x, y)` painting over it. */
function image(
  w: number,
  h: number,
  bg: [number, number, number],
  fill: (x: number, y: number) => [number, number, number] | null = () => null,
): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = fill(x, y) ?? bg;
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

const alpha = (img: RgbaImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

// Index 1 outline, 2 skin, 3 dark, 4 blue: a stand-in for an actor palette.
const PALETTE = ["#000000", "#1a1420", "#ffd0a8", "#2e2a3a", "#4aa0f0"];

describe("the conversion pipeline", () => {
  it("keys the flat background, near misses included", () => {
    const img = image(4, 1, MAGENTA, (x) =>
      x === 1 ? [240, 20, 230] : x === 2 ? [10, 200, 10] : null,
    );
    const k = keyBackground(img, "#ff00ff", 60);
    expect([0, 1, 2, 3].map((x) => alpha(k, x, 0))).toEqual([0, 0, 255, 0]);
  });

  it("erodes the mask by one pixel", () => {
    const img = image(5, 5, MAGENTA, (x, y) =>
      x >= 1 && x <= 3 && y >= 1 && y <= 3 ? [0, 0, 255] : null,
    );
    const e = erodeAlpha(keyBackground(img, "#ff00ff", 60), 1);
    const opaque = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (alpha(e, x, y)) opaque.push([x, y]);
    expect(opaque).toEqual([[2, 2]]);
  });

  it("crops to the alpha bounds", () => {
    const img = keyBackground(
      image(10, 8, MAGENTA, (x, y) => (x >= 3 && x < 6 && y >= 2 && y < 7 ? [0, 0, 0] : null)),
      "#ff00ff",
      60,
    );
    const c = cropToAlpha(img)!;
    expect(c.box).toEqual([3, 2, 3, 5]);
    expect([c.img.width, c.img.height]).toEqual([3, 5]);
    expect(cropToAlpha(keyBackground(image(3, 3, MAGENTA), "#ff00ff", 60))).toBeNull();
  });

  it("downsamples by area, so a 2x2 checker averages to gray", () => {
    const img = image(8, 8, [0, 0, 0], (x, y) => ((x + y) % 2 ? [255, 255, 255] : null));
    const d = downsample(img, 2, 2);
    expect(d.factor).toBe(4);
    for (let i = 0; i < 4; i++) expect(Math.abs(d.img.data[i * 4]! - 128)).toBeLessThanOrEqual(1);
  });

  it("weights by alpha, so the key color never bleeds into edge pixels", () => {
    const img = keyBackground(
      image(4, 2, MAGENTA, (x) => (x < 3 ? [0, 0, 255] : null)),
      "#ff00ff",
      60,
    );
    const d = downsample(img, 2, 1);
    // The right pixel is half blue and half key. It stays blue, not purple.
    expect(Array.from(d.img.data.subarray(4, 8))).toEqual([0, 0, 255, 255]);
  });

  it("quantizes only to the allowed indices", () => {
    const img = image(2, 1, [255, 208, 168], (x) => (x === 1 ? [70, 160, 240] : null));
    expect(Array.from(quantize(img, PALETTE, [2, 4], false).data)).toEqual([2, 4]);
    // With blue not allowed, the blue pixel takes the nearest allowed color (skin) instead.
    expect(Array.from(quantize(img, PALETTE, [2, 3], false).data)).toEqual([2, 2]);
  });

  it("dithers a mid tone into a pattern of both neighbors", () => {
    const pal = ["#000000", "#000000", "#ffffff"];
    const q = quantize(image(4, 4, [128, 128, 128]), pal, [1, 2], true, 255);
    const set = new Set(q.data);
    expect(set.has(1) && set.has(2)).toBe(true);
    expect(new Set(quantize(image(4, 4, [128, 128, 128]), pal, [1, 2], false).data).size).toBe(1);
  });

  it("removes lone pixels but keeps eyes", () => {
    const img = new IndexedImage(5, 5);
    img.fill(2);
    img.set(1, 1, 4); // a speck of blue in skin
    img.set(3, 3, 3); // an eye
    const out = cleanupLonePixels(img, [3]);
    expect(out.get(1, 1)).toBe(2);
    expect(out.get(3, 3)).toBe(3);
    const floating = new IndexedImage(5, 5);
    floating.set(2, 2, 3);
    expect(cleanupLonePixels(floating, [3]).get(2, 2)).toBe(0);
  });

  it("outlines in index 1 and grows by one pixel each side", () => {
    const img = new IndexedImage(1, 1);
    img.set(0, 0, 2);
    const o = addOutline(img);
    expect([o.width, o.height]).toEqual([3, 3]);
    expect(Array.from(o.data)).toEqual([0, 1, 0, 1, 2, 1, 0, 1, 0]);
  });

  it("blends the seam so a tiling strip wraps without a jump", () => {
    const img = image(64 + 32, 1, [0, 0, 0], (x) => [x * 2, 0, 0]);
    const b = blendSeam(img, 32);
    expect(b.width).toBe(64);
    const r = (x: number) => b.data[x * 4]!;
    // The last column and the first column are one gradient step apart, not 190 steps.
    expect(Math.abs(r(63) - r(0))).toBeLessThanOrEqual(4);
  });

  it("runs end to end: keyed, cropped, sized, outlined, anchored", () => {
    // A 40x80 skin ellipse with a dark eye on magenta, at about 4x the target scale.
    const img = image(64, 96, MAGENTA, (x, y) => {
      const inside = ((x - 32) / 20) ** 2 + ((y - 50) / 40) ** 2 <= 1;
      if (!inside) return null;
      return Math.abs(x - 40) < 3 && Math.abs(y - 40) < 3 ? [46, 42, 58] : [255, 208, 168];
    });
    const r = pixelize(
      img,
      { use: "part", heightPx: 22, indices: [2, 3], conversion: { keep: [3] } },
      PALETTE,
    );
    expect(r.img.height).toBe(22);
    expect(r.img.width).toBe(12);
    const used = new Set(r.img.data);
    expect([...used].sort()).toEqual([0, 1, 2, 3]);
    expect(r.anchor).toEqual([6, 11]);
    expect(r.conversion.factor).toBe(3);
  });

  it("stretches a part with both sizes to exactly that size", () => {
    const img = image(64, 64, MAGENTA, (x, y) =>
      x > 8 && x < 56 && y > 8 && y < 56 ? [255, 208, 168] : null,
    );
    const r = pixelize(img, { use: "part", heightPx: 20, widthPx: 9 }, PALETTE);
    expect([r.img.width, r.img.height]).toEqual([9, 20]);
  });

  it("sizes a layer to the exact layer size and keeps every pixel", () => {
    const img = image(200, 60, [74, 160, 240]);
    const r = pixelize(img, { use: "layer", heightPx: 27, widthPx: 96 }, [
      "#000000",
      "#4aa0f0",
      "#ffffff",
    ]);
    expect([r.img.width, r.img.height]).toEqual([96, 27]);
    expect(new Set(r.img.data)).toEqual(new Set([1]));
  });
});

describe("art gen --reconvert", () => {
  it("converts the saved raw images again at the new size, with no request", () => {
    const tmp = mkdtempSync(join(tmpdir(), "bb-reconvert-"));
    try {
      const px = image(64, 64, MAGENTA, (x, y) =>
        x >= 16 && x < 48 && y >= 8 && y < 56 ? [200, 40, 40] : null,
      );
      writeRgbaPng(join(tmp, "raw-1.png"), 64, 64, px.data);
      writeFileSync(
        join(tmp, "cand-1.json"),
        JSON.stringify({ anchor: [0, 0], conversion: {}, seed: 7 }),
      );
      const palette = ["#000000", "#1a1420", "#c02030"];
      expect(reconvertDir(tmp, { use: "part", heightPx: 12, anchor: [0.5, 1] }, palette)).toBe(1);
      const png = decodeIndexedPngSync(new Uint8Array(readFileSync(join(tmp, "cand-1.png"))));
      expect(png.height).toBe(12);
      const meta = JSON.parse(readFileSync(join(tmp, "cand-1.json"), "utf8"));
      expect(meta.seed).toBe(7);
      expect(meta.anchor[1]).toBe(12);
      expect(existsSync(join(tmp, "sheet.png"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
