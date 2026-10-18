// The background painter: turns a layer file's ops into an indexed image using the stage's
// sub-palette. Index 0 is transparent; stage palette color i is index i + 1.

import type { ItemsFile, LayerFile, LayerOp } from "@bb/schema";
import { rasterText } from "@bb/engine/render/font";
import { IndexedImage, capsuleGeo, ellipseGeo, paint, polyGeo } from "./raster";
import { drawShape } from "./sprite";
import { blitSprite, type SpriteTable } from "./sprites";
import { itemImage } from "./bake";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function hexRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export class LayerPainter {
  readonly errors: string[] = [];
  private readonly index = new Map<string, number>();

  constructor(
    private readonly palette: string[],
    private readonly items?: ItemsFile,
    private readonly itemPalettes?: Record<string, string[]>,
    /** Generated layer PNGs (relative to the layers folder) and item PNGs (to content/items). */
    private readonly images: { layers?: SpriteTable; items?: SpriteTable } = {},
  ) {
    palette.forEach((c, i) => this.index.set(c, i + 1));
  }

  /** Stage palette index for a color; unknown colors are an error and map to the nearest. */
  color(hex: string, where: string): number {
    const i = this.index.get(hex);
    if (i !== undefined) return i;
    this.errors.push(`${where}: color ${hex} is not in the stage palette`);
    return this.nearest(hex);
  }

  private nearest(hex: string): number {
    const [r, g, b] = hexRgb(hex);
    let best = 1;
    let bestD = Infinity;
    this.palette.forEach((c, i) => {
      const [r2, g2, b2] = hexRgb(c);
      const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i + 1;
      }
    });
    return best;
  }

  paintLayer(layer: LayerFile, file: string): IndexedImage {
    const img = new IndexedImage(layer.width, layer.height);
    for (const op of layer.ops) this.op(img, op, 0, file);
    return img;
  }

  private op(img: IndexedImage, op: LayerOp, ox: number, file: string): void {
    const C = (hex: string) => this.color(hex, `${file} ${op.op}`);
    switch (op.op) {
      case "fill":
        img.fill(C(op.color));
        return;
      case "rect": {
        const c = C(op.color);
        for (let y = Math.round(op.y); y < Math.round(op.y + op.h); y++)
          for (let x = Math.round(ox + op.x); x < Math.round(ox + op.x + op.w); x++)
            img.set(x, y, c);
        return;
      }
      case "gradient": {
        const cols = op.colors.map(C);
        const bands = cols.length - 1;
        for (let y = Math.round(op.y); y < Math.round(op.y + op.h); y++) {
          const t = ((y - op.y) / Math.max(1, op.h)) * bands;
          const band = Math.min(bands - 1, Math.floor(t));
          const f = t - band;
          for (let x = 0; x < img.width; x++) {
            const thr = (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
            img.set(x, y, f > thr ? cols[band + 1]! : cols[band]!);
          }
        }
        return;
      }
      case "bricks": {
        const c = C(op.color);
        const m = C(op.mortar);
        for (let y = 0; y < op.h; y++)
          for (let x = 0; x < op.w; x++) {
            const row = Math.floor(y / op.bh);
            const off = row % 2 ? op.bw / 2 : 0;
            const mortar = y % op.bh === op.bh - 1 || (x + off) % op.bw === op.bw - 1;
            img.set(Math.round(ox + op.x + x), Math.round(op.y + y), mortar ? m : c);
          }
        return;
      }
      case "windows": {
        const c = C(op.color);
        const lit = C(op.lit);
        const fr = op.frame ? C(op.frame) : 0;
        let seed = Math.round(op.x * 31 + op.y * 17) >>> 0;
        const rnd = () => {
          seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
          return (seed >>> 16) % 100;
        };
        for (let r = 0; r < op.rows; r++)
          for (let k = 0; k < op.cols; k++) {
            const wx = Math.round(ox + op.x + k * (op.ww + op.gapX));
            const wy = Math.round(op.y + r * (op.wh + op.gapY));
            const col = rnd() < op.litChance ? lit : c;
            for (let y = 0; y < op.wh; y++)
              for (let x = 0; x < op.ww; x++) {
                const edge = fr && (x === 0 || y === 0 || x === op.ww - 1 || y === op.wh - 1);
                img.set(wx + x, wy + y, edge ? fr : col);
              }
          }
        return;
      }
      case "repeat":
        for (let i = 0; i < op.count; i++)
          for (const sub of op.ops) this.op(img, sub, ox + op.x + i * op.every, file);
        return;
      case "circle":
        paint(img, ellipseGeo(ox + op.x, op.y, op.r, op.r), {
          color: C(op.color),
          outline: false,
          shade: false,
        });
        return;
      case "ellipse":
        paint(img, ellipseGeo(ox + op.x, op.y, op.w / 2, op.h / 2), {
          color: C(op.color),
          outline: false,
          shade: false,
        });
        return;
      case "line":
        paint(img, capsuleGeo(ox + op.x1, op.y1, ox + op.x2, op.y2, Math.max(0.5, op.width / 2)), {
          color: C(op.color),
          outline: false,
          shade: false,
        });
        return;
      case "poly":
        paint(img, polyGeo(op.points.map(([x, y]) => [ox + x, y] as [number, number])), {
          color: C(op.color),
          outline: false,
          shade: false,
        });
        return;
      case "text": {
        const c = C(op.color);
        rasterText(op.text, Math.round(ox + op.x), Math.round(op.y), op.scale, (x, y) =>
          img.set(x, y, c),
        );
        return;
      }
      case "noise": {
        const c = C(op.color);
        let seed = (op.seed * 2654435761) >>> 0;
        for (let y = 0; y < op.h; y++)
          for (let x = 0; x < op.w; x++) {
            seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 1) >>> 0;
            if (seed % 100 < op.density)
              img.set(Math.round(ox + op.x + x), Math.round(op.y + y), c);
          }
        return;
      }
      case "tiles": {
        const a = C(op.color);
        const b = C(op.alt);
        for (let y = 0; y < op.h; y++)
          for (let x = 0; x < op.w; x++) {
            const sx = x + Math.round((y * op.skew) / Math.max(1, op.h));
            const odd = (Math.floor(sx / op.tw) + Math.floor(y / op.th)) % 2;
            img.set(Math.round(ox + op.x + x), Math.round(op.y + y), odd ? b : a);
          }
        return;
      }
      case "stripes": {
        const c = C(op.color);
        for (let y = 0; y < op.h; y++)
          for (let x = 0; x < op.w; x++) {
            const v = op.vertical ? x : y;
            if (v % op.every < op.width)
              img.set(Math.round(ox + op.x + x), Math.round(op.y + y), c);
          }
        return;
      }
      case "image": {
        // Generated backgrounds use stage indices directly; later ops paint on top.
        const sp = this.images.layers?.[op.file];
        if (!sp) {
          this.errors.push(`${file}: image ${op.file} is missing`);
          return;
        }
        img.blit(sp.img, Math.round(ox + op.x), Math.round(op.y));
        return;
      }
      case "item": {
        const it = this.items;
        const def = it?.props[op.item]?.sprite ?? it?.pickups[op.item]?.sprite;
        if (!def) {
          this.errors.push(`${file}: unknown item ${op.item}`);
          return;
        }
        const pal = this.itemPalettes?.[def.palette] ?? [];
        const image = itemImage(def, undefined, this.images.items ?? {});
        const tmp = new IndexedImage(
          Math.max(def.size[0], image?.img.width ?? 0) + 8,
          Math.max(def.size[1], image?.img.height ?? 0) + 8,
        );
        const ax = Math.floor(tmp.width / 2);
        const ay = tmp.height - 3;
        if (image) blitSprite(tmp, image, ax, ay, 0);
        else for (const s of def.shapes) drawShape(tmp, s, () => [ax, ay], 1, 0);
        // Map the item's palette onto the nearest stage colors.
        const map = pal.map((h, i) => (i === 0 ? 0 : (this.index.get(h) ?? this.nearest(h))));
        for (let y = 0; y < tmp.height; y++)
          for (let x = 0; x < tmp.width; x++) {
            const v = tmp.data[y * tmp.width + x]!;
            if (v) img.set(Math.round(ox + op.x - ax + x), Math.round(op.y - ay + y), map[v] ?? 1);
          }
        return;
      }
    }
  }
}
