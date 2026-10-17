import { describe, expect, it } from "vitest";
import { createRegistry } from "@bb/mechanics";
import { validateRaw, validateRepo } from "../../packages/tools/src/lib/validate";
import { loadContent } from "../../packages/tools/src/lib/content-fs";

describe("content", () => {
  it("validates clean, including the forbidden-terms scan", () => {
    const r = validateRepo(createRegistry());
    expect(r.errors).toEqual([]);
  });
  it("fails validation when a required module is flagged off", () => {
    const r = validateRepo(createRegistry(["-mech.elevator"]), "content/stages/game-2");
    expect(r.errors.some((e) => e.includes("elevator") && e.includes("flag"))).toBe(true);
  });
  it("catches a forbidden term in content text", () => {
    const registry = createRegistry();
    const load = loadContent(registry);
    const raw = structuredClone(load.raw);
    const doc = load.docs.find((d) => d.file.endsWith("characters/brat/character.json"))!;
    const tampered = { ...doc, doc: { ...(doc.doc as object), voice: { continueLine: `${raw.forbiddenTerms[0]}, man.` } } };
    const docs = load.docs.map((d) => (d === doc ? tampered : d));
    const r = validateRaw(raw, registry, { errors: [], warnings: [], docs }, "characters/brat");
    expect(r.errors.some((e) => e.includes("forbidden term"))).toBe(true);
  });
});
