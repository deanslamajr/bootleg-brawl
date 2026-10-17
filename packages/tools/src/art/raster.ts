// Indexed-color raster with shape masks. Shapes are rasterized by sampling pixel centers; each
// part gets a 1-pixel outline by dilating its mask, and a shade index on its lower-back side.

export class IndexedImage {
  readonly data: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x]!;
  }

  set(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data[y * this.width + x] = v;
  }

  fill(v: number): void {
    this.data.fill(v);
  }

  /** Bounding box of non-zero pixels, or null when empty. */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let x0 = this.width;
    let y0 = this.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.data[y * this.width + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  crop(x: number, y: number, w: number, h: number): IndexedImage {
    const out = new IndexedImage(w, h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) out.data[yy * w + xx] = this.get(x + xx, y + yy);
    return out;
  }

  blit(src: IndexedImage, dx: number, dy: number, transparent = true): void {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const v = src.data[y * src.width + x]!;
        if (transparent && v === 0) continue;
        this.set(dx + x, dy + y, v);
      }
  }
}

/** A shape in pixel space: inside test plus normalized local coords for shading. */
export interface Geometry {
  bbox: [number, number, number, number];
  /** Returns null when outside, else local [u, v] in about -1..1 (u toward front, v down). */
  local(px: number, py: number): [number, number] | null;
}

export function ellipseGeo(cx: number, cy: number, rx: number, ry: number, rotTurns = 0): Geometry {
  const a = rotTurns * Math.PI * 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const R = Math.max(rx, ry) + 1;
  return {
    bbox: [Math.floor(cx - R), Math.floor(cy - R), Math.ceil(cx + R), Math.ceil(cy + R)],
    local(px, py) {
      const dx = px - cx;
      const dy = py - cy;
      const u = (dx * ca + dy * sa) / Math.max(0.5, rx);
      const v = (-dx * sa + dy * ca) / Math.max(0.5, ry);
      return u * u + v * v <= 1 ? [u, v] : null;
    },
  };
}

export function rectGeo(cx: number, cy: number, w: number, h: number, rotTurns = 0): Geometry {
  const a = rotTurns * Math.PI * 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const R = Math.hypot(w, h) / 2 + 1;
  return {
    bbox: [Math.floor(cx - R), Math.floor(cy - R), Math.ceil(cx + R), Math.ceil(cy + R)],
    local(px, py) {
      const dx = px - cx;
      const dy = py - cy;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      return Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2 ? [u / (w / 2), v / (h / 2)] : null;
    },
  };
}

export function capsuleGeo(x1: number, y1: number, x2: number, y2: number, r: number): Geometry {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = Math.max(1e-6, dx * dx + dy * dy);
  const len = Math.sqrt(len2);
  // Perpendicular pointing "down" relative to the segment, for shading.
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    bbox: [
      Math.floor(Math.min(x1, x2) - r - 1),
      Math.floor(Math.min(y1, y2) - r - 1),
      Math.ceil(Math.max(x1, x2) + r + 1),
      Math.ceil(Math.max(y1, y2) + r + 1),
    ],
    local(px, py) {
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
      const qx = x1 + t * dx;
      const qy = y1 + t * dy;
      const ex = px - qx;
      const ey = py - qy;
      if (ex * ex + ey * ey > r * r) return null;
      const side = (ex * nx + ey * ny) / Math.max(0.5, r);
      return [-side * 0.5, side];
    },
  };
}

export function polyGeo(points: [number, number][]): Geometry {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = Math.max(0.5, (x1 - x0) / 2);
  const hh = Math.max(0.5, (y1 - y0) / 2);
  return {
    bbox: [Math.floor(x0 - 1), Math.floor(y0 - 1), Math.ceil(x1 + 1), Math.ceil(y1 + 1)],
    local(px, py) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i]!;
        const [xj, yj] = points[j]!;
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside ? [(px - cx) / hw, (py - cy) / hh] : null;
    },
  };
}

export interface PaintOpts {
  color: number;
  outline: boolean;
  shade: boolean;
  /** Color used for the shaded side; defaults to color + 1. */
  shadeColor?: number;
  outlineColor?: number;
}

/** Shade-capable fills: even indices 2..14 shade to the next index. */
export function shadeOf(color: number): number {
  return color >= 2 && color <= 14 && color % 2 === 0 ? color + 1 : color;
}

/** Paints a geometry: outline (dilated mask) first, then the fill with shading. */
export function paint(img: IndexedImage, g: Geometry, opts: PaintOpts): void {
  const [bx0, by0, bx1, by1] = g.bbox;
  const w = bx1 - bx0 + 3;
  const h = by1 - by0 + 3;
  const mask = new Uint8Array(w * h);
  const loc = new Float32Array(w * h * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = g.local(bx0 - 1 + x + 0.5, by0 - 1 + y + 0.5);
      if (l) {
        mask[y * w + x] = 1;
        loc[(y * w + x) * 2] = l[0];
        loc[(y * w + x) * 2 + 1] = l[1];
      }
    }
  if (opts.outline) {
    const oc = opts.outlineColor ?? 1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) continue;
        const n =
          (x > 0 && mask[y * w + x - 1]) ||
          (x < w - 1 && mask[y * w + x + 1]) ||
          (y > 0 && mask[(y - 1) * w + x]) ||
          (y < h - 1 && mask[(y + 1) * w + x]);
        if (n) img.set(bx0 - 1 + x, by0 - 1 + y, oc);
      }
  }
  const sc = opts.shadeColor ?? shadeOf(opts.color);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const u = loc[(y * w + x) * 2]!;
      const v = loc[(y * w + x) * 2 + 1]!;
      const shaded = opts.shade && -u * 0.45 + v * 0.9 > 0.42;
      img.set(bx0 - 1 + x, by0 - 1 + y, shaded ? sc : opts.color);
    }
}
