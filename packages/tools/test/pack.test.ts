import { describe, expect, it } from "vitest";
import { createRegistry } from "@bb/mechanics";
import { loadContent } from "../src/lib/content-fs";
import { buildBundles, BUDGETS, MAX_SHEET_SIDE, sheetSizeErrors } from "../src/lib/pack";
import { decodeIndexedPng } from "@bb/engine/render/png";
import { inflateSync } from "node:zlib";
import { layerFile, shape } from "@bb/schema";
import { bakeActor, drawItem, posesUsed } from "../src/art/bake";
import { LayerPainter } from "../src/art/layers";
import { IndexedImage } from "../src/art/raster";
import { emptySprites, type SpriteImage, type SpriteTable } from "../src/art/sprites";

describe("bundles and manifest", () => {
  const { raw, errors } = loadContent(createRegistry());
  it("loads content without errors", () => expect(errors).toEqual([]));
  const { bundles, sheets } = buildBundles(raw);
  it("builds one bundle per character, enemy family, boss and stage plus core", () => {
    const count = (t: string) => bundles.filter((b) => b.type === t).length;
    expect(count("core")).toBe(1);
    expect(count("character")).toBe(Object.keys(raw.characters).length);
    expect(count("enemy")).toBe(Object.keys(raw.enemies).length);
    expect(count("boss")).toBe(Object.keys(raw.bosses).length);
    expect(count("stage")).toBe(Object.keys(raw.stages).length);
  });
  it("keeps bundles inside their budgets", () => {
    for (const b of bundles) {
      const size =
        JSON.stringify(b.content).length + b.files.reduce((n, f) => n + f.bytes.length, 0);
      const budget =
        b.type === "core"
          ? BUDGETS.core
          : b.type === "stage"
            ? BUDGETS.stage
            : b.type === "character"
              ? BUDGETS.character
              : Infinity;
      expect(size, `${b.type}:${b.id}`).toBeLessThanOrEqual(budget);
    }
  });
  it("bakes indexed atlases with at most 16 colors and power-of-two sides", async () => {
    expect(sheetSizeErrors(sheets)).toEqual([]);
    const atlases = bundles.flatMap((b) =>
      b.files
        .filter((f) => f.path === "atlas.png" || f.path === "items.png")
        .map((f) => [b.id, f.bytes] as const),
    );
    expect(atlases.length).toBe(Object.keys(sheets).length);
    const pow2 = (n: number) => n > 0 && n <= MAX_SHEET_SIDE && (n & (n - 1)) === 0;
    for (const [id, png] of atlases) {
      const img = await decodeIndexedPng(png, (z) => new Uint8Array(inflateSync(z)));
      expect(img.palette.length, id).toBeLessThanOrEqual(16);
      expect(
        img.data.reduce((m, v) => Math.max(m, v), 0),
        id,
      ).toBeLessThan(16);
      expect(pow2(img.width) && pow2(img.height), `${id} ${img.width}x${img.height}`).toBe(true);
    }
    expect(sheets.sarge!.frames["idle:0"]).toBeDefined();
    expect(sheets.sarge!.frames["hairspin:0"]).toBeDefined();
  });
  it("keeps parodyMeta out of every bundle", () => {
    for (const b of bundles) {
      expect(JSON.stringify(b.content), `${b.type}:${b.id}`).not.toContain('"parodyMeta"');
      expect("parodyMeta" in b, `${b.type}:${b.id}`).toBe(false);
    }
  });
  it("rejects a sheet whose side is not a power of two", () => {
    const meta = { ...sheets.sarge!, width: 600 };
    expect(sheetSizeErrors({ sarge: meta })).toHaveLength(1);
    expect(sheetSizeErrors({ sarge: { ...meta, width: 2048 } })).toHaveLength(1);
  });
});

describe("generated sprites in the bake", () => {
  const { raw } = loadContent(createRegistry());
  const solid = (w: number, h: number, v: number, file: string): SpriteImage => {
    const img = new IndexedImage(w, h);
    img.fill(v);
    for (let x = 0; x < w; x++) img.set(x, 0, 1);
    return { img, anchor: [w / 2, h / 2], file, paletteSize: 16 };
  };
  const sprites: SpriteTable = {
    "sprites/head.png": solid(16, 18, 4, "head"),
    "sprites/torso.png": { ...solid(12, 20, 10, "torso"), anchor: [6, 20] },
  };
  const interns = raw.enemies["interns"]!;
  const overlays = structuredClone(interns.overlays);
  overlays.body.hide = ["torso", "face"];
  overlays.layers.head = [
    shape.parse({ shape: "sprite", file: "sprites/head.png", at: "head", z: 51 }),
  ];
  overlays.layers.torso = [
    shape.parse({ shape: "sprite", file: "sprites/torso.png", at: "hip", alignTo: "neck", z: 31 }),
  ];
  const rig = raw.rigs[interns.file.rig]!;
  const poses = posesUsed(interns.states, raw.templates);
  const pal = raw.palettes[interns.file.tiers[0]!.palette]!;
  const vector = bakeActor("interns", rig, interns.overlays, poses, pal);
  const baked = bakeActor("interns", rig, overlays, poses, pal, { sprites });

  it("parses a sprite shape with no color and no outline", () => {
    const s = overlays.layers.head[0]!;
    expect([s.shape, s.file, s.color, s.outline]).toEqual(["sprite", "sprites/head.png", 1, false]);
    expect(shape.safeParse({ shape: "sprite", at: "head" }).success).toBe(false);
  });

  it("composes the sprites into an indexed atlas with at most 16 colors", async () => {
    const img = await decodeIndexedPng(baked.png, (z) => new Uint8Array(inflateSync(z)));
    expect(img.palette.length).toBeLessThanOrEqual(16);
    expect(img.data.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(16);
    expect(img.data.includes(10)).toBe(true);
    expect(baked.overflow).toBe(0);
  });

  it("draws idle:0 upright and down:0 rotated, with the head sprite in both", async () => {
    const img = await decodeIndexedPng(baked.png, (z) => new Uint8Array(inflateSync(z)));
    const count = (key: string, v: number) => {
      const f = baked.meta.frames[key]!;
      let n = 0;
      for (let y = f.y; y < f.y + f.h; y++)
        for (let x = f.x; x < f.x + f.w; x++) if (img.data[y * img.width + x] === v) n++;
      return n;
    };
    const idle = baked.meta.frames["idle:0"]!;
    const down = baked.meta.frames["down:0"]!;
    expect(idle.h).toBeGreaterThan(idle.w);
    expect(down.w).toBeGreaterThan(down.h);
    // The head sprite (index 4) shows in both; the vector head's hair is gone.
    expect(count("idle:0", 4)).toBeGreaterThan(150);
    expect(count("down:0", 4)).toBeGreaterThan(150);
  });

  it("keeps the hand point of the vector bake", () => {
    for (const key of ["idle:0", "atk1:0", "down:0"]) {
      const a = vector.meta.frames[key]!;
      const b = baked.meta.frames[key]!;
      // Relative to the anchor, because trimming moves the frame's top-left.
      expect([b.hand[0] - b.ax, b.hand[1] - b.ay], key).toEqual([
        a.hand[0] - a.ax,
        a.hand[1] - a.ay,
      ]);
      expect(b.handAngle, key).toBe(a.handAngle);
    }
  });

  it("paints a layer image op under later ops, at its offset", () => {
    const painter = new LayerPainter(["#4aa0f0", "#ffffff", "#c02030"], undefined, undefined, {
      layers: { "bg.png": solid(4, 3, 2, "bg") },
    });
    const layer = layerFile.parse({
      id: "bg",
      schemaVersion: 1,
      width: 20,
      height: 10,
      ops: [
        { op: "fill", color: "#4aa0f0" },
        { op: "image", file: "bg.png", x: 3, y: 2 },
        { op: "rect", x: 5, y: 3, w: 1, h: 1, color: "#c02030" },
      ],
    });
    const img = painter.paintLayer(layer, "bg.json");
    expect(painter.errors).toEqual([]);
    expect(img.get(0, 0)).toBe(1);
    expect(img.get(4, 3)).toBe(2);
    expect(img.get(5, 3)).toBe(3);
    expect(img.get(3, 2)).toBe(1); // the image's top row is its outline index
    painter.paintLayer(
      { ...layer, ops: [{ op: "image", file: "gone.png", x: 0, y: 0 }] },
      "bg.json",
    );
    expect(painter.errors).toEqual(["bg.json: image gone.png is missing"]);
  });

  it("bakes an item from its image", () => {
    const sprite = { ...raw.items.props["crate"]!.sprite, image: "sprites/crate.png" };
    const d = drawItem(sprite, undefined, {
      "sprites/crate.png": { ...solid(10, 8, 5, "crate"), anchor: [5, 8] },
    });
    const b = d.img.bounds()!;
    expect([b.w, b.h]).toEqual([10, 8]);
    expect(b.y + b.h).toBe(d.ay);
  });

  it("bakes a generated bust as the portrait frame and the character portrait", async () => {
    const r = structuredClone(raw);
    r.characters["sarge"]!.file.portraitImage = "sprites/portrait.png";
    r.bosses["porkchop"]!.file.portraitImage = "sprites/portrait.png";
    r.bosses["porkchop"]!.file.card.portrait = "portrait";
    const bust = solid(40, 44, 3, "bust");
    const tables = emptySprites();
    tables.actors["sarge"] = { "sprites/portrait.png": bust };
    tables.actors["porkchop"] = { "sprites/portrait.png": bust };
    const built = buildBundles(r, tables);
    expect(built.warnings.filter((w) => w.includes("portrait"))).toEqual([]);
    expect(built.sheets["porkchop"]!.frames["portrait"]).toMatchObject({ w: 40, h: 44 });
    const sarge = built.bundles.find((b) => b.id === "sarge")!;
    const png = sarge.files.find((f) => f.path === "portrait.png")!;
    const img = await decodeIndexedPng(png.bytes, (z) => new Uint8Array(inflateSync(z)));
    expect([img.width, img.height]).toEqual([48, 48]);
    // The bust is centered: its middle row is bust color, the edges are clear.
    expect(img.data[24 * 48 + 24]).toBe(3);
    expect(img.data[24 * 48 + 2]).toBe(0);
  });
});
