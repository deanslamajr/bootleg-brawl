// Browser asset store: fetches the manifest and bundle data, assembles RawContent for the
// compiler, and lazily decodes atlases, layers and sounds. Palette swaps happen here: an atlas
// is decoded to indices once and recolored per palette on first use.

import { Rectangle, Texture } from "pixi.js";
import {
  speechSettings,
  type ManifestFile,
  type ManifestEntry,
  type SpeechSettings,
} from "@bb/schema";
import type { RawContent } from "../content/types";
import { decodeIndexedPng, type IndexedPng } from "./png";

export interface FrameMeta {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
  hand: [number, number];
  handAngle: number;
  head: [number, number];
  palette?: string;
}

export interface SheetMeta {
  id: string;
  width: number;
  height: number;
  palette: string[];
  frames: Record<string, FrameMeta>;
}

export interface LayerMeta {
  width: number;
  height: number;
  file: string;
}

const CACHE = "bootleg-bundles-v1";

/** Bundles are content-hashed, so a cached response never goes stale: cache first, then network. */
async function cachedFetch(url: string): Promise<Response> {
  if (typeof caches === "undefined" || !url.includes("bundles/")) return fetch(url);
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit;
    const res = await fetch(url);
    if (res.ok) await cache.put(url, res.clone());
    return res;
  } catch {
    return fetch(url);
  }
}

async function inflate(z: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([z as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function colorize(
  img: IndexedPng,
  palette: string[],
  region?: { x: number; y: number; w: number; h: number }[],
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(img.width, img.height);
  const rgb = palette.map(hexToRgb);
  const write = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = y * img.width + x;
        const v = img.data[i]!;
        if (v === 0) continue;
        const c = rgb[v] ?? [255, 0, 255];
        data.data[i * 4] = c[0];
        data.data[i * 4 + 1] = c[1];
        data.data[i * 4 + 2] = c[2];
        data.data[i * 4 + 3] = 255;
      }
  };
  if (region) for (const r of region) write(r.x, r.y, r.w, r.h);
  else write(0, 0, img.width, img.height);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export class AssetStore {
  manifest!: ManifestFile;
  readonly sheets = new Map<string, SheetMeta>();
  readonly layerMeta = new Map<string, Record<string, LayerMeta>>();
  private readonly bundleData = new Map<string, unknown>();
  private readonly indexed = new Map<string, Promise<IndexedPng>>();
  private readonly paletteTextures = new Map<string, Texture>();
  private readonly frameTextures = new Map<string, Texture>();
  private readonly layerTextures = new Map<string, Texture>();
  readonly sfxBytes = new Map<string, ArrayBuffer>();
  palettes: Record<string, string[]> = {};
  /** Bundles fetched, for the ?debug overlay. */
  hits = 0;

  constructor(readonly base = "") {}

  /** Drops every cache, for the sandbox's content reload after a re-pack. */
  reset(): void {
    this.sheets.clear();
    this.layerMeta.clear();
    this.bundleData.clear();
    this.indexed.clear();
    this.decoded.clear();
    for (const t of this.frameTextures.values()) t.destroy();
    for (const t of this.paletteTextures.values()) t.destroy(true);
    for (const t of this.layerTextures.values()) t.destroy(true);
    this.frameTextures.clear();
    this.paletteTextures.clear();
    this.layerTextures.clear();
  }

  entry(type: ManifestEntry["type"], id: string): ManifestEntry | undefined {
    return this.manifest.entries.find((e) => e.type === type && e.id === id);
  }

  url(entry: ManifestEntry, file: string): string {
    return `${this.base}${entry.bundle}${file}`;
  }

  async loadManifest(): Promise<ManifestFile> {
    const res = await fetch(`${this.base}manifest.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
    this.manifest = (await res.json()) as ManifestFile;
    return this.manifest;
  }

  /** Fetches every bundle's content.json (small) and assembles RawContent. Heavy assets stay lazy. */
  async loadAllData(onProgress?: (done: number, total: number) => void): Promise<RawContent> {
    const entries = this.manifest.entries;
    let done = 0;
    await Promise.all(
      entries.map(async (e) => {
        const res = await cachedFetch(this.url(e, "content.json"));
        if (!res.ok) throw new Error(`${e.bundle}content.json: HTTP ${res.status}`);
        this.bundleData.set(`${e.type}:${e.id}`, await res.json());
        this.hits++;
        onProgress?.(++done, entries.length);
      }),
    );
    return this.assemble();
  }

  private assemble(): RawContent {
    const core = this.bundleData.get("core:core") as Record<string, unknown>;
    if (!core) throw new Error("core bundle missing from manifest");
    this.palettes = core.palettes as Record<string, string[]>;
    const sheets = core.sheets as Record<string, SheetMeta>;
    for (const [k, v] of Object.entries(sheets)) this.sheets.set(k, v);
    const raw: RawContent = {
      rigs: core.rigs as RawContent["rigs"],
      templates: core.templates as RawContent["templates"],
      palettes: this.palettes,
      masterPalette: core.masterPalette as string[],
      items: core.items as RawContent["items"],
      characters: {},
      enemies: {},
      bosses: {},
      arenas: core.arenas as RawContent["arenas"],
      stages: {},
      interludes: core.interludes as RawContent["interludes"],
      campaign: core.campaign as RawContent["campaign"],
      roster: core.roster as RawContent["roster"],
      sfx: core.sfx as RawContent["sfx"],
      tracks: core.tracks as RawContent["tracks"],
      forbiddenTerms: [],
      flags: (core.flags as string[] | undefined) ?? [],
      speech: { ...speechSettings.parse({}), ...(core.speech as Partial<SpeechSettings>) },
    };
    for (const e of this.manifest.entries) {
      const d = this.bundleData.get(`${e.type}:${e.id}`) as Record<string, unknown>;
      if (e.type === "character" || e.type === "enemy" || e.type === "boss") {
        const { sheet, ...src } = d as { sheet: SheetMeta } & Record<string, unknown>;
        this.sheets.set(e.id, sheet);
        const table =
          e.type === "character" ? raw.characters : e.type === "enemy" ? raw.enemies : raw.bosses;
        (table as Record<string, unknown>)[e.id] = src;
      } else if (e.type === "stage") {
        const s = d as {
          file: RawContent["stages"][string]["file"];
          segments: RawContent["stages"][string]["segments"];
          layers: Record<string, LayerMeta>;
          lines?: RawContent["stages"][string]["lines"];
        };
        this.layerMeta.set(e.id, s.layers);
        raw.stages[e.id] = {
          file: s.file,
          segments: s.segments,
          ...(s.lines ? { lines: s.lines } : {}),
          layers: Object.fromEntries(
            Object.entries(s.layers).map(([k, v]) => [
              k,
              { id: k, schemaVersion: 1, width: v.width, height: v.height, ops: [] },
            ]),
          ),
        };
      }
    }
    return raw;
  }

  private sheetEntry(sheet: string): ManifestEntry {
    if (sheet === "items") return this.entry("core", "core")!;
    const e = this.manifest.entries.find(
      (x) => x.id === sheet && (x.type === "character" || x.type === "enemy" || x.type === "boss"),
    );
    if (!e) throw new Error(`no bundle for sheet ${sheet}`);
    return e;
  }

  private loadIndexed(url: string): Promise<IndexedPng> {
    let p = this.indexed.get(url);
    if (!p) {
      p = cachedFetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
          this.hits++;
          return r.arrayBuffer();
        })
        .then((b) => decodeIndexedPng(new Uint8Array(b), inflate));
      this.indexed.set(url, p);
    }
    return p;
  }

  /** Decodes a sheet's atlas so palette textures can be made synchronously later. */
  async preloadSheet(sheet: string): Promise<void> {
    const e = this.sheetEntry(sheet);
    await this.loadIndexed(this.url(e, sheet === "items" ? "items.png" : "atlas.png"));
  }

  private decoded = new Map<string, IndexedPng>();

  async ensureSheets(sheets: string[]): Promise<void> {
    await Promise.all(
      [...new Set(sheets)].map(async (s) => {
        if (this.decoded.has(s)) return;
        const e = this.sheetEntry(s);
        this.decoded.set(
          s,
          await this.loadIndexed(this.url(e, s === "items" ? "items.png" : "atlas.png")),
        );
      }),
    );
  }

  /** Texture of one frame in a palette. Returns null when the sheet is not decoded yet. */
  frame(sheet: string, pose: string, palette: string): { tex: Texture; meta: FrameMeta } | null {
    const meta = this.sheets.get(sheet)?.frames[pose];
    if (!meta) return null;
    const pal = meta.palette ?? palette;
    const key = `${sheet}|${pal}|${pose}`;
    let tex = this.frameTextures.get(key);
    if (!tex) {
      const base = this.paletteTexture(sheet, pal);
      if (!base) return null;
      tex = new Texture({
        source: base.source,
        frame: new Rectangle(meta.x, meta.y, meta.w, meta.h),
      });
      this.frameTextures.set(key, tex);
    }
    return { tex, meta };
  }

  private paletteTexture(sheet: string, palette: string): Texture | null {
    const key = `${sheet}|${palette}`;
    let t = this.paletteTextures.get(key);
    if (t) return t;
    const img = this.decoded.get(sheet);
    if (!img) return null;
    const pal = this.palettes[palette] ?? this.sheets.get(sheet)?.palette ?? img.palette;
    // The items atlas only recolors the frames that use this palette.
    const regions =
      sheet === "items"
        ? Object.values(this.sheets.get("items")!.frames).filter((f) => f.palette === palette)
        : undefined;
    t = Texture.from(colorize(img, pal, regions));
    t.source.scaleMode = "nearest";
    this.paletteTextures.set(key, t);
    return t;
  }

  async ensureLayers(stageId: string): Promise<void> {
    const metas = this.layerMeta.get(stageId) ?? {};
    const e = this.entry("stage", stageId)!;
    await Promise.all(
      Object.entries(metas).map(async ([lid, m]) => {
        const key = `${stageId}/${lid}`;
        if (this.layerTextures.has(key)) return;
        const img = await this.loadIndexed(this.url(e, m.file));
        const t = Texture.from(colorize(img, img.palette));
        t.source.scaleMode = "nearest";
        this.layerTextures.set(key, t);
      }),
    );
  }

  layer(stageId: string, layerId: string): Texture | null {
    return this.layerTextures.get(`${stageId}/${layerId}`) ?? null;
  }

  async portrait(charId: string): Promise<Texture | null> {
    const e = this.entry("character", charId);
    if (!e?.portrait) return null;
    const img = await this.loadIndexed(this.url(e, e.portrait));
    const pal = this.sheets.get(charId)?.palette ?? img.palette;
    const t = Texture.from(colorize(img, pal));
    t.source.scaleMode = "nearest";
    return t;
  }

  async loadSfx(ids: string[]): Promise<void> {
    const core = this.entry("core", "core")!;
    await Promise.all(
      ids.map(async (id) => {
        if (this.sfxBytes.has(id)) return;
        const r = await cachedFetch(this.url(core, `sfx/${id}.wav`));
        if (r.ok) this.sfxBytes.set(id, await r.arrayBuffer());
      }),
    );
  }
}
