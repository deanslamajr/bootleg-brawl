// pack: bakes and writes content-hashed bundles plus the manifest. One bundle per character,
// enemy family, boss and stage, plus `core` (rigs, templates, items, interludes, music, sfx).
// Every bundle is a directory with content.json and its binary assets.

import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { join } from "node:path";
import type { ManifestEntry, ManifestFile, BeatmapFile } from "@bb/schema";
import { compileContent, type RawContent } from "@bb/engine";
import { encodeIndexedPng } from "@bb/engine/render/png";
import { encodeWav, renderSfx } from "@bb/engine/audio";
import { bakeActor, bakeItems, posesUsed, type SheetMeta } from "../art/bake";
import { LayerPainter } from "../art/layers";
import { IndexedImage } from "../art/raster";
import { CONTENT, PUBLIC } from "./paths";

export const BUDGETS = { core: 3_000_000, stage: 4_000_000, character: 1_000_000 } as const;

interface BundleFile {
  path: string;
  bytes: Uint8Array;
}

interface Bundle {
  id: string;
  type: ManifestEntry["type"];
  content: unknown;
  files: BundleFile[];
  requires: string[];
  unlock?: string;
  parodyMeta?: { bootlegOf: string; gag: string };
  portrait?: string;
  displayName?: string;
}

export interface PackResult {
  manifest: ManifestFile;
  warnings: string[];
  errors: string[];
  sheets: Record<string, SheetMeta>;
  bytes: Record<string, number>;
}

function sha(parts: Uint8Array[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex").slice(0, 10);
}

const enc = new TextEncoder();

function beatmap(track: RawContent["tracks"][string]): BeatmapFile {
  const rows = track.order.reduce((n, p) => {
    const pat = track.patterns[p] ?? {};
    const len = Math.max(0, ...Object.values(pat).map((s) => s.trim().split(/\s+/).length));
    return n + len;
  }, 0);
  return {
    schemaVersion: 1,
    track: track.id,
    bpm: track.bpm,
    offset: 0,
    bars: Math.max(1, Math.round(rows / (track.rowsPerBeat * 4))),
    cues: track.cues,
  };
}

function portraitPng(
  sheet: SheetMeta,
  atlas: IndexedImage | null,
  pose: string,
): Uint8Array | null {
  if (!atlas) return null;
  const f = sheet.frames[pose];
  if (!f) return null;
  // 48x48 crop centered on the head.
  const out = new IndexedImage(48, 48);
  const hx = f.x + f.head[0];
  const hy = f.y + f.head[1];
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48; x++) {
      const sx = hx - 24 + x;
      const sy = hy - 18 + y;
      if (sx < f.x || sy < f.y || sx >= f.x + f.w || sy >= f.y + f.h) continue;
      out.data[y * 48 + x] = atlas.get(sx, sy);
    }
  return encodeIndexedPng(
    { width: 48, height: 48, data: out.data, palette: sheet.palette },
    (r) => new Uint8Array(deflateSync(r, { level: 9 })),
  );
}

export function buildBundles(raw: RawContent): {
  bundles: Bundle[];
  warnings: string[];
  sheets: Record<string, SheetMeta>;
} {
  const warnings: string[] = [];
  const sheets: Record<string, SheetMeta> = {};
  const bundles: Bundle[] = [];

  // core
  const items = bakeItems(raw);
  sheets.items = items.meta;
  const sfxFiles: BundleFile[] = [];
  for (const id of Object.keys(raw.sfx.sounds).sort()) {
    sfxFiles.push({ path: `sfx/${id}.wav`, bytes: encodeWav(renderSfx(raw.sfx.sounds[id]!)) });
  }
  const beatmaps = Object.fromEntries(Object.values(raw.tracks).map((t) => [t.id, beatmap(t)]));
  bundles.push({
    id: "core",
    type: "core",
    content: {
      rigs: raw.rigs,
      templates: raw.templates,
      palettes: raw.palettes,
      masterPalette: raw.masterPalette,
      items: raw.items,
      interludes: raw.interludes,
      campaign: raw.campaign,
      roster: raw.roster,
      sfx: raw.sfx,
      tracks: raw.tracks,
      beatmaps,
      arenas: raw.arenas,
      flags: raw.flags,
      sheets: { items: items.meta },
    },
    files: [{ path: "items.png", bytes: items.png }, ...sfxFiles],
    requires: [],
  });

  const actorBundle = (
    type: "character" | "enemy" | "boss",
    id: string,
    src: {
      file: { rig: string; displayName: string; parodyMeta: { bootlegOf: string; gag: string } };
      states: RawContent["templates"][string];
      overlays: RawContent["characters"][string]["overlays"];
    },
    palette: string,
    extraPoses: string[],
    extra: Record<string, unknown> = {},
  ) => {
    const rig = raw.rigs[src.file.rig]!;
    const pal = raw.palettes[palette] ?? [];
    const templates = { ...raw.templates };
    const poses = posesUsed(src.states, templates, extraPoses);
    if (type === "character") {
      const w = raw.templates["template:weapons"];
      if (w) for (const p of posesUsed(w, templates)) if (!poses.includes(p)) poses.push(p);
    }
    const baked = bakeActor(id, rig, src.overlays, poses.sort(), pal);
    warnings.push(...baked.warnings);
    sheets[id] = baked.meta;
    const files: BundleFile[] = [{ path: "atlas.png", bytes: baked.png }];
    let portrait: string | undefined;
    if (type === "character") {
      const atlas = decodeForPortrait(baked.meta, baked.png);
      const pp = portraitPng(
        baked.meta,
        atlas,
        (src.file as { portrait?: string }).portrait ?? "idle:0",
      );
      if (pp) {
        files.push({ path: "portrait.png", bytes: pp });
        portrait = "portrait.png";
      }
    }
    bundles.push({
      id,
      type,
      content: { ...src, sheet: baked.meta, ...extra },
      files,
      requires:
        type === "character"
          ? ((src.file as { kit?: { requires?: string[] } }).kit?.requires ?? [])
          : [],
      unlock: (src.file as { unlock?: string }).unlock,
      parodyMeta: { bootlegOf: src.file.parodyMeta.bootlegOf, gag: src.file.parodyMeta.gag },
      portrait,
      displayName: src.file.displayName,
    });
  };

  for (const id of Object.keys(raw.characters).sort()) {
    const src = raw.characters[id]!;
    actorBundle("character", id, src, src.file.palette, [src.file.portrait]);
  }
  for (const id of Object.keys(raw.enemies).sort()) {
    const src = raw.enemies[id]!;
    actorBundle("enemy", id, src, src.file.tiers[0]!.palette, []);
  }
  for (const id of Object.keys(raw.bosses).sort()) {
    const src = raw.bosses[id]!;
    actorBundle("boss", id, src, src.file.palette, [src.file.card.portrait]);
  }
  for (const id of Object.keys(raw.stages).sort()) {
    const st = raw.stages[id]!;
    const painter = new LayerPainter(st.file.palette, raw.items, raw.palettes);
    const files: BundleFile[] = [];
    const layerMeta: Record<string, { width: number; height: number; file: string }> = {};
    for (const lid of Object.keys(st.layers).sort()) {
      const layer = st.layers[lid]!;
      const img = painter.paintLayer(layer, `content/stages/${id}/layers/${lid}.json`);
      const png = encodeIndexedPng(
        {
          width: img.width,
          height: img.height,
          data: img.data,
          palette: ["#000000", ...st.file.palette],
        },
        (r) => new Uint8Array(deflateSync(r, { level: 9 })),
      );
      files.push({ path: `layers/${lid}.png`, bytes: png });
      layerMeta[lid] = { width: layer.width, height: layer.height, file: `layers/${lid}.png` };
    }
    warnings.push(...painter.errors);
    bundles.push({
      id,
      type: "stage",
      content: { file: st.file, segments: st.segments, layers: layerMeta },
      files,
      requires: st.file.rules.requires,
      parodyMeta: { bootlegOf: st.file.parodyMeta.bootlegOf, gag: st.file.parodyMeta.gag },
      displayName: st.file.titleCard.title,
    });
  }
  return { bundles, warnings, sheets };
}

/** Portrait extraction needs atlas indices; a sync decode of what encodeIndexedPng writes (filter 0). */
function decodeForPortrait(meta: SheetMeta, png: Uint8Array): IndexedImage | null {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  const idat: Uint8Array[] = [];
  while (o < png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const z = Buffer.concat(idat.map((d) => Buffer.from(d)));
  const raw = inflateSync(z);
  const img = new IndexedImage(meta.width, meta.height);
  for (let y = 0; y < meta.height; y++)
    img.data.set(
      raw.subarray(y * (meta.width + 1) + 1, y * (meta.width + 1) + 1 + meta.width),
      y * meta.width,
    );
  return img;
}

/** The largest baked sheet side. Older WebGL devices cap textures near this size. */
export const MAX_SHEET_SIDE = 1024;

/** One line per baked sheet whose sides are not powers of two up to MAX_SHEET_SIDE. */
export function sheetSizeErrors(sheets: Record<string, SheetMeta>): string[] {
  const ok = (n: number) => n > 0 && n <= MAX_SHEET_SIDE && (n & (n - 1)) === 0;
  return Object.entries(sheets)
    .filter(([, m]) => !ok(m.width) || !ok(m.height))
    .map(
      ([id, m]) =>
        `sheet ${id} is ${m.width}x${m.height}; each side must be a power of two up to ${MAX_SHEET_SIDE}`,
    );
}

/** Writes bundles to generated/public/bundles and the manifest; returns the manifest. */
export function pack(raw: RawContent, outDir = PUBLIC): PackResult {
  const { bundles, warnings, sheets } = buildBundles(raw);
  const errors: string[] = sheetSizeErrors(sheets);
  const bytes: Record<string, number> = {};
  const bundlesDir = join(outDir, "bundles");
  mkdirSync(bundlesDir, { recursive: true });
  const keep = new Set<string>();
  const entries: ManifestEntry[] = [];
  for (const b of bundles) {
    const json = enc.encode(JSON.stringify(b.content));
    const hash = sha([json, ...b.files.map((f) => f.bytes)]);
    const dirName = `${b.type}-${b.id}-${hash}`;
    keep.add(dirName);
    const dir = join(bundlesDir, dirName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "content.json"), json);
      for (const f of b.files) {
        mkdirSync(join(dir, f.path, ".."), { recursive: true });
        writeFileSync(join(dir, f.path), f.bytes);
      }
    }
    const size = json.length + b.files.reduce((n, f) => n + f.bytes.length, 0);
    bytes[`${b.type}:${b.id}`] = size;
    const budget =
      b.type === "core"
        ? BUDGETS.core
        : b.type === "stage"
          ? BUDGETS.stage
          : b.type === "character"
            ? BUDGETS.character
            : Infinity;
    if (size > budget)
      errors.push(`bundle ${b.type}:${b.id} is ${size} bytes, over its ${budget} byte budget`);
    entries.push({
      id: b.id,
      type: b.type,
      schemaVersion: 1,
      bundle: `bundles/${dirName}/`,
      hash,
      bytes: size,
      requires: b.requires,
      ...(b.unlock ? { unlock: b.unlock } : {}),
      ...(b.parodyMeta ? { parodyMeta: b.parodyMeta } : {}),
      ...(b.portrait ? { portrait: b.portrait } : {}),
      ...(b.displayName ? { displayName: b.displayName } : {}),
    });
  }
  // Remove stale bundle directories.
  for (const d of readdirSync(bundlesDir))
    if (!keep.has(d)) rmSync(join(bundlesDir, d), { recursive: true, force: true });
  const contentHash = createHash("sha256")
    .update(entries.map((e) => e.hash).join(","))
    .digest("hex")
    .slice(0, 12);
  // The compiled content hash also lands in the manifest so peers can compare builds.
  let compiledHash = "";
  try {
    compiledHash = compileContent(raw).hash;
  } catch (e) {
    errors.push(`compile: ${(e as Error).message}`);
  }
  const manifest: ManifestFile = {
    schemaVersion: 1,
    contentHash: `${contentHash}-${compiledHash}`,
    entries,
    rosterOrder: raw.roster.rosterOrder,
  };
  const manifestJson = JSON.stringify(manifest, null, 1);
  writeFileSync(join(outDir, "manifest.json"), manifestJson);
  writeFileSync(join(CONTENT, "manifest.json"), manifestJson + "\n");
  return { manifest, warnings, errors, sheets, bytes };
}
