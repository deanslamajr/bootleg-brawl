import { describe, expect, it } from "vitest";
import { createRegistry } from "@bb/mechanics";
import { loadContent } from "../src/lib/content-fs";
import { buildBundles, BUDGETS } from "../src/lib/pack";
import { decodeIndexedPng } from "@bb/engine/render/png";
import { inflateSync } from "node:zlib";

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
  it("bakes indexed atlases with at most 16 colors and every referenced pose", async () => {
    const sarge = bundles.find((b) => b.id === "sarge")!;
    const png = sarge.files.find((f) => f.path === "atlas.png")!.bytes;
    const img = await decodeIndexedPng(png, (z) => new Uint8Array(inflateSync(z)));
    expect(img.palette.length).toBeLessThanOrEqual(16);
    expect(img.data.reduce((m, v) => Math.max(m, v), 0)).toBeLessThan(16);
    expect(sheets.sarge!.frames["idle:0"]).toBeDefined();
    expect(sheets.sarge!.frames["hairspin:0"]).toBeDefined();
  });
});
