import { describe, expect, it } from "vitest";
import { createRegistry } from "@bb/mechanics";
import { loadContent } from "../src/lib/content-fs";
import { buildBundles, BUDGETS, MAX_SHEET_SIDE, sheetSizeErrors } from "../src/lib/pack";
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
