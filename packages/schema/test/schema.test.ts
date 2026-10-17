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
