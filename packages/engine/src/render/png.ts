// Minimal indexed-PNG (color type 3, 8-bit) encode and decode. Decoding returns palette indices,
// not colors, so the palette-swap step can recolor them per tier. Works in Node and browsers:
// the caller supplies inflate/deflate (zlib in Node, CompressionStream in browsers).

export interface IndexedPng {
  width: number;
  height: number;
  /** One palette index per pixel. */
  data: Uint8Array;
  /** RGB colors as #rrggbb, index 0 is transparent. */
  palette: string[];
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodeIndexedPng(
  img: IndexedPng,
  deflate: (raw: Uint8Array) => Uint8Array,
): Uint8Array {
  const { width, height, data, palette } = img;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((hex, i) => {
    plte[i * 3] = parseInt(hex.slice(1, 3), 16);
    plte[i * 3 + 1] = parseInt(hex.slice(3, 5), 16);
    plte[i * 3 + 2] = parseInt(hex.slice(5, 7), 16);
  });
  const trns = new Uint8Array(palette.length).fill(255);
  trns[0] = 0;
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(data.subarray(y * width, y * width + width), y * (width + 1) + 1);
  }
  const parts = [
    new Uint8Array(SIG),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("tRNS", trns),
    chunk("IDAT", deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The chunks of a PNG that the decoders need. */
export interface PngChunks {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
  /** PLTE entries as #rrggbb. */
  palette: string[];
  /** The concatenated IDAT payload (still deflated). */
  idat: Uint8Array;
}

export function readPngChunks(bytes: Uint8Array): PngChunks {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) throw new Error("not a PNG");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const palette: string[] = [];
  const idat: Uint8Array[] = [];
  while (o < bytes.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(o + 8);
      height = dv.getUint32(o + 12);
      depth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") {
      for (let i = 0; i < data.length; i += 3)
        palette.push(
          "#" +
            [data[i]!, data[i + 1]!, data[i + 2]!]
              .map((v) => v.toString(16).padStart(2, "0"))
              .join(""),
        );
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const z = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let zo = 0;
  for (const d of idat) {
    z.set(d, zo);
    zo += d.length;
  }
  return { width, height, depth, colorType, interlace, palette, idat: z };
}

/**
 * Reverses the PNG row filters of an inflated, non-interlaced image. `bpp` is bytes per pixel
 * (1 for indexed, 3 for RGB, 4 for RGBA). Returns width * bpp bytes per row with no filter bytes.
 */
export function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  if (raw.length < stride * height) throw new Error("PNG image data is truncated");
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * stride]!;
    if (f > 4) throw new Error(`unknown PNG filter type ${f}`);
    const row = raw.subarray(y * stride + 1, y * stride + 1 + rowBytes);
    const prev = y > 0 ? out.subarray((y - 1) * rowBytes, y * rowBytes) : null;
    const cur = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev ? prev[x]! : 0;
      const c = prev && x >= bpp ? prev[x - bpp]! : 0;
      let v = row[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
  }
  return out;
}

export async function decodeIndexedPng(
  bytes: Uint8Array,
  inflate: (z: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): Promise<IndexedPng> {
  const { width, height, depth, colorType, palette, idat } = readPngChunks(bytes);
  if (colorType !== 3 || depth !== 8)
    throw new Error(
      `only 8-bit indexed PNGs are supported (got type ${colorType}, depth ${depth})`,
    );
  const raw = await inflate(idat);
  return { width, height, data: unfilter(raw, width, height, 1), palette };
}
