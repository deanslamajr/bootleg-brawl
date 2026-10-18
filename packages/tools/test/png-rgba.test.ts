import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { decodeRgbaPng, decodeIndexedPngSync } from "../src/art/png-rgba";
import { writeRgbaPng } from "../src/art/preview";
import { encodeIndexedPng } from "@bb/engine/render/png";

function chunk(type: string, data: Uint8Array): Buffer {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, "ascii");
  Buffer.from(data).copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}

/** A PNG whose rows use the given filter types in turn, filtered by hand. */
function filteredPng(
  w: number,
  h: number,
  bpp: 3 | 4,
  px: Uint8Array,
  filters: number[],
): Uint8Array {
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const row = w * bpp;
  const raw = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = filters[y % filters.length]!;
    raw[y * (row + 1)] = f;
    for (let x = 0; x < row; x++) {
      const v = px[y * row + x]!;
      const a = x >= bpp ? px[y * row + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * row + x]! : 0;
      const c = y > 0 && x >= bpp ? px[(y - 1) * row + x - bpp]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]!;
      raw[y * (row + 1) + 1 + x] = (v - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = bpp === 4 ? 6 : 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}

function noise(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

describe("RGBA PNG decoder", () => {
  const tmp = mkdtempSync(join(tmpdir(), "bb-png-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("reads back what writeRgbaPng writes", () => {
    const px = noise(7 * 5 * 4, 3);
    writeRgbaPng(join(tmp, "a.png"), 7, 5, px);
    const img = decodeRgbaPng(new Uint8Array(readFileSync(join(tmp, "a.png"))));
    expect([img.width, img.height]).toEqual([7, 5]);
    expect(Array.from(img.data)).toEqual(Array.from(px));
  });

  it("undoes all five filter types for RGBA and RGB", () => {
    const rgba = noise(9 * 10 * 4, 7);
    const a = decodeRgbaPng(filteredPng(9, 10, 4, rgba, [0, 1, 2, 3, 4]));
    expect(Array.from(a.data)).toEqual(Array.from(rgba));
    const rgb = noise(6 * 5 * 3, 11);
    const b = decodeRgbaPng(filteredPng(6, 5, 3, rgb, [4, 3, 2, 1, 0]));
    for (let i = 0; i < 30; i++) {
      expect([b.data[i * 4], b.data[i * 4 + 1], b.data[i * 4 + 2], b.data[i * 4 + 3]]).toEqual([
        rgb[i * 3],
        rgb[i * 3 + 1],
        rgb[i * 3 + 2],
        255,
      ]);
    }
  });

  it("throws on an indexed PNG and decodes it with the indexed decoder", () => {
    const png = encodeIndexedPng(
      {
        width: 2,
        height: 2,
        data: new Uint8Array([0, 1, 2, 3]),
        palette: ["#000000", "#ff0000", "#00ff00", "#0000ff"],
      },
      (r) => new Uint8Array(deflateSync(r)),
    );
    expect(() => decodeRgbaPng(png)).toThrow(/RGB and RGBA/);
    const ix = decodeIndexedPngSync(png);
    expect(Array.from(ix.data)).toEqual([0, 1, 2, 3]);
    expect(ix.palette[1]).toBe("#ff0000");
  });
});
