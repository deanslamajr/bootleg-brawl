import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildSchemas, CONTENT_VERSIONS, ForbiddenScanner, migrateDoc } from "../src";

describe("migrations", () => {
  it("upgrades the v0 character fixture to the current version", () => {
    const v0 = JSON.parse(readFileSync(join(__dirname, "fixtures/character-v0.json"), "utf8"));
    const info = CONTENT_VERSIONS.character;
    const { doc, applied } = migrateDoc("character", v0, info.current, info.minimum);
    expect(applied).toBe(1);
    const parsed = buildSchemas().character.parse(doc) as {
      displayName: string;
      stats: { hp: number };
      voice: { continueLine: string };
    };
    expect(parsed.displayName).toBe("Fixture Person");
    expect(parsed.stats.hp).toBe(100);
    expect(parsed.voice.continueLine).toBe("Insert a coin, please.");
  });
  it("refuses files below the minimum and above the current version", () => {
    expect(() => migrateDoc("stage", { schemaVersion: 0 }, 1, 1)).toThrow(/minimum/);
    expect(() => migrateDoc("stage", { schemaVersion: 9 }, 1, 1)).toThrow(/newer/);
  });
});

describe("schema fragments", () => {
  it("merges module fragments into the segment schema", () => {
    const base = buildSchemas();
    const seg = {
      id: "s",
      schemaVersion: 1,
      kind: "fight",
      length: 960,
      depth: [180, 260],
      layers: [{ layer: "a", depth: 0 }],
      widget: { size: 3 },
    };
    expect(base.segment.safeParse(seg).success).toBe(false);
    const withWidget = buildSchemas([
      { segment: { widget: z.strictObject({ size: z.number() }).optional() } },
    ]);
    expect(withWidget.segment.safeParse(seg).success).toBe(true);
  });
});

describe("forbidden terms", () => {
  const scanner = new ForbiddenScanner(["flip my waffles", "zorbleton", "b'zap"]);
  it("matches whole words case-insensitively with flexible punctuation", () => {
    expect(scanner.scanText("FLIP MY WAFFLES!", "x")).toHaveLength(1);
    expect(scanner.scanText("Welcome to Zorbleton", "x")).toHaveLength(1);
    expect(scanner.scanText("bzap", "x")).toHaveLength(1);
    expect(scanner.scanText("bazap", "x")).toHaveLength(0);
    expect(scanner.scanText("B'ZAP", "x")).toHaveLength(1);
  });
  it("does not match inside other words", () => {
    expect(scanner.scanText("zorbletons", "x")).toHaveLength(0);
  });
  it("scans keys, nested strings and file names", () => {
    const hits = scanner.scanDoc(
      { a: { b: ["fine", "Zorbleton again"] } },
      "content/zorbleton.json",
    );
    expect(hits.length).toBe(2);
  });
});

describe("generated art", () => {
  const s = buildSchemas();
  const overlays = (shape: Record<string, unknown>) =>
    s.overlays.safeParse({ schemaVersion: 1, layers: { head: [shape] } });
  const layer = (op: Record<string, unknown>) =>
    s.layer.safeParse({ id: "a", schemaVersion: 1, width: 10, height: 10, ops: [op] });

  it("parses a sprite shape with a file, and refuses one without", () => {
    const r = overlays({ shape: "sprite", file: "sprites/head.png", at: "head", dy: -2, z: 50 });
    expect(r.success).toBe(true);
    expect(overlays({ shape: "sprite", at: "head" }).success).toBe(false);
    expect(overlays({ shape: "sprite", file: "a.png", bogus: 1 }).success).toBe(false);
  });

  it("leaves vector shapes exactly as before", () => {
    const r = overlays({ shape: "rect", color: 2 });
    const parsed = (r.data as { layers: { head: Record<string, unknown>[] } }).layers.head[0]!;
    expect(Object.keys(parsed)).not.toContain("scale");
    expect(Object.keys(parsed)).not.toContain("flip");
    expect(parsed.outline).toBe(true);
    expect(overlays({ shape: "rect" }).success).toBe(false);
  });

  it("parses an image op and refuses an unknown key on it", () => {
    expect(layer({ op: "image", file: "mainstreet.png", x: 0, y: 0 }).success).toBe(true);
    expect(layer({ op: "image", file: "mainstreet.png", alpha: 1 }).success).toBe(false);
  });

  it("parses the plan's art.json sample and refuses an unknown key", () => {
    const sample = {
      schemaVersion: 1,
      model: "klein4b",
      seed: 1234567,
      look: { prompt: "a tired office intern, standing, facing right", width: 512, height: 768 },
      parts: [
        {
          id: "head",
          joint: "head",
          heightPx: 18,
          indices: [2, 3, 4, 5, 12, 13],
          prompt: "only the head",
        },
        { id: "hairwhip:0", heightPx: 30, prompt: "a hair whip" },
      ],
    };
    expect(s.art.safeParse(sample).success).toBe(true);
    expect(s.art.safeParse({ ...sample, style: "x", palette: "y" }).success).toBe(false);
    expect(s.art.safeParse({ ...sample, parts: [{ id: "Head", prompt: "abc" }] }).success).toBe(
      false,
    );
  });

  it("lets an item sprite use an image instead of shapes, but not neither", () => {
    const items = (sprite: Record<string, unknown>) =>
      s.items.safeParse({ schemaVersion: 1, props: { crate: { sprite } } });
    expect(
      items({ size: [8, 8], shapes: [], palette: "items-a", image: "sprites/crate.png" }).success,
    ).toBe(true);
    expect(items({ size: [8, 8], shapes: [], palette: "items-a" }).success).toBe(false);
  });
});
