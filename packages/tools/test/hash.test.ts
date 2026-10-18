// The compiled content hash: the browser (no layer ops) and the packer agree, art leaves it
// alone, and every sim-relevant field moves it, so a failed replay can name a content change.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compileContent, type RawContent } from "@bb/engine";
import { createRegistry } from "@bb/mechanics";
import { loadContent } from "../src/lib/content-fs";
import { CONTENT } from "../src/lib/paths";

const raw = loadContent(createRegistry()).raw;
const base = compileContent(raw).hash;

function hashOf(tamper: (r: RawContent) => void): string {
  const r = structuredClone(raw);
  tamper(r);
  return compileContent(r).hash;
}

describe("compiled content hash", () => {
  it("matches the browser's raw content, which has no layer ops", () => {
    // AssetStore.loadAllData fabricates each layer like this (render/assets.ts).
    const browser = hashOf((r) => {
      for (const st of Object.values(r.stages))
        for (const [k, v] of Object.entries(st.layers))
          st.layers[k] = { id: k, schemaVersion: 1, width: v.width, height: v.height, ops: [] };
    });
    expect(browser).toBe(base);
  });

  it("ignores art: a layer op and a palette", () => {
    expect(
      hashOf((r) => {
        const layer = Object.values(r.stages["game-0"]!.layers)[0]!;
        layer.ops = layer.ops.slice(1);
      }),
    ).toBe(base);
    expect(
      hashOf((r) => {
        const pal = r.palettes[Object.keys(r.palettes)[0]!]!;
        pal[1] = pal[2]!;
      }),
    ).toBe(base);
  });

  it("changes with a wave count", () => {
    expect(
      hashOf((r) => {
        const seg = r.stages["game-0"]!.segments["main-street"]!;
        seg.scrollLocks[0]!.waves[0]!.count += 1;
      }),
    ).not.toBe(base);
  });

  it("changes with a tier above the base tier, an AI parameter, a boss phase and a state tag", () => {
    expect(
      hashOf((r) => {
        r.enemies["interns"]!.file.tiers[1]!.hp += 1;
      }),
    ).not.toBe(base);
    expect(
      hashOf((r) => {
        r.enemies["interns"]!.file.ai.params.range = 30;
      }),
    ).not.toBe(base);
    expect(
      hashOf((r) => {
        r.bosses["pinhead-pete"]!.file.phases[1]!.hpBelowPct = 40;
      }),
    ).not.toBe(base);
    expect(
      hashOf((r) => {
        const hit = r.characters["sarge"]!.states.states["special"]!.frames![1]!.hit![0]!;
        hit.tags = [...(hit.tags ?? []), "extra"];
      }),
    ).not.toBe(base);
  });

  describe("a tier hp edit in a copy of content/", () => {
    const tmp = mkdtempSync(join(tmpdir(), "bb-hash-"));
    afterAll(() => rmSync(tmp, { recursive: true, force: true }));
    it("changes the hash", () => {
      const root = join(tmp, "content");
      cpSync(CONTENT, root, { recursive: true });
      const file = join(root, "enemies/interns/family.json");
      const fam = JSON.parse(readFileSync(file, "utf8"));
      expect(fam.tiers[0].hp).toBe(14);
      fam.tiers[0].hp = 15;
      writeFileSync(file, JSON.stringify(fam));
      const copy = loadContent(createRegistry(), root);
      expect(copy.errors).toEqual([]);
      expect(compileContent(copy.raw).hash).not.toBe(base);
    });
  });
});
