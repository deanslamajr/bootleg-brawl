// Sync PNG decoders for the art tool and the content loader. Runware returns 8-bit RGB or RGBA
// PNGs; accepted sprites are 8-bit indexed PNGs. Both share the unfilter loop in render/png.ts.

import { inflateSync } from "node:zlib";
import { readPngChunks, unfilter, type IndexedPng } from "@bb/engine/render/png";

export interface RgbaImage {
  width: number;
  height: number;
  /** Four bytes per pixel, row-major. */
  data: Uint8Array;
}

/** Decodes an 8-bit, non-interlaced RGB (type 2) or RGBA (type 6) PNG to RGBA bytes. */
export function decodeRgbaPng(bytes: Uint8Array): RgbaImage {
  const c = readPngChunks(bytes);
  if (c.depth !== 8 || (c.colorType !== 2 && c.colorType !== 6))
    throw new Error(
      `only 8-bit RGB and RGBA PNGs are supported (got type ${c.colorType}, depth ${c.depth})`,
    );
  if (c.interlace !== 0) throw new Error("interlaced PNGs are not supported");
  const bpp = c.colorType === 6 ? 4 : 3;
  const px = unfilter(new Uint8Array(inflateSync(c.idat)), c.width, c.height, bpp);
  if (bpp === 4) return { width: c.width, height: c.height, data: px };
  const data = new Uint8Array(c.width * c.height * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) {
    data[j] = px[i]!;
    data[j + 1] = px[i + 1]!;
    data[j + 2] = px[i + 2]!;
    data[j + 3] = 255;
  }
  return { width: c.width, height: c.height, data };
}

/** The sync twin of decodeIndexedPng, for the loader, which is sync. */
export function decodeIndexedPngSync(bytes: Uint8Array): IndexedPng {
  const c = readPngChunks(bytes);
  if (c.colorType !== 3 || c.depth !== 8)
    throw new Error(
      `only 8-bit indexed PNGs are supported (got type ${c.colorType}, depth ${c.depth})`,
    );
  if (c.interlace !== 0) throw new Error("interlaced PNGs are not supported");
  const raw = new Uint8Array(inflateSync(c.idat));
  return {
    width: c.width,
    height: c.height,
    data: unfilter(raw, c.width, c.height, 1),
    palette: c.palette,
  };
}
