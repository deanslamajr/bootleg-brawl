// RGBA contact sheets for eyeballing art (not shipped; the game uses indexed atlases).

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import type { IndexedImage } from "./raster";

function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, "ascii");
  Buffer.from(data).copy(b, 8);
  b.writeUInt32BE(crc(new Uint8Array(b.subarray(4, 8 + data.length))), 8 + data.length);
  return b;
}

export function writeRgbaPng(path: string, w: number, h: number, rgba: Uint8Array): void {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}

/** Lays out indexed images in a grid, applies a palette, scales and writes a PNG. */
export function contactSheet(
  path: string,
  images: IndexedImage[],
  palette: string[],
  scale = 3,
  cols = 8,
  bg = "#5a6a7a",
): void {
  const cw = Math.max(...images.map((i) => i.width));
  const ch = Math.max(...images.map((i) => i.height));
  const rows = Math.ceil(images.length / cols);
  const W = cw * cols * scale;
  const H = ch * rows * scale;
  const out = new Uint8Array(W * H * 4);
  const hex = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const bgc = hex(bg);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = bgc[0]!;
    out[i * 4 + 1] = bgc[1]!;
    out[i * 4 + 2] = bgc[2]!;
    out[i * 4 + 3] = 255;
  }
  const cols3 = palette.map(hex);
  images.forEach((img, n) => {
    const ox = (n % cols) * cw;
    const oy = Math.floor(n / cols) * ch;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const v = img.data[y * img.width + x]!;
        if (!v) continue;
        const c = cols3[v] ?? [255, 0, 255];
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++) {
            const p = (((oy + y) * scale + sy) * W + (ox + x) * scale + sx) * 4;
            out[p] = c[0]!;
            out[p + 1] = c[1]!;
            out[p + 2] = c[2]!;
          }
      }
    // Cell separators.
    for (let y = 0; y < ch * scale; y++) {
      const p = ((oy * scale + y) * W + ox * scale) * 4;
      out[p] = 40;
      out[p + 1] = 40;
      out[p + 2] = 50;
    }
  });
  writeRgbaPng(path, W, H, out);
}
