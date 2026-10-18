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
  it("fails when the private deny list is missing", () => {
    const registry = createRegistry();
    const load = loadContent(registry);
    const raw = { ...structuredClone(load.raw), forbiddenTerms: [] };
    const docs = load.docs.filter((d) => d.type !== "forbidden-terms");
    const r = validateRaw(raw, registry, { errors: [], warnings: [], docs });
    expect(r.errors.filter((e) => e.includes("forbidden-terms.json"))).toHaveLength(1);
  });
  it("rejects bystanders on a stage that does not require civilians", () => {
    const registry = createRegistry();
    const load = loadContent(registry);
    const raw = structuredClone(load.raw);
    const rules = raw.stages["game-0"]!.file.rules;
    rules.requires = rules.requires.filter((r) => r !== "civilians");
    const r = validateRaw(raw, registry, { errors: [], warnings: [], docs: load.docs }, "stages/game-0");
    const hits = r.errors.filter((e) => e.includes("civilian"));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("bystanders");
    expect(hits[0]).toContain("rules.requires");
  });
  describe("post-v1 fields no module reads", () => {
    const registry = createRegistry();
    const load = loadContent(registry);
    const check = (tamper: (raw: typeof load.raw) => void, message: string) => {
      const raw = structuredClone(load.raw);
      tamper(raw);
      const r = validateRaw(
        raw,
        registry,
        { errors: [], warnings: [], docs: load.docs },
        "stages/game-0",
      );
      expect(r.errors.filter((e) => e.includes(message))).toHaveLength(1);
    };
    const rules = (raw: typeof load.raw) =>
      raw.stages["game-0"]!.file.rules as Record<string, unknown>;
    for (const key of ["timerHealth", "widescreen", "invertGravity"])
      it(`rejects rules.${key}`, () =>
        check(
          (raw) => (rules(raw)[key] = true),
          `rules.${key} is a post-v1 field that no module reads`,
        ));
    it("rejects a rule no module declares", () =>
      check((raw) => (rules(raw).bogus = 1), "rules.bogus is not a rule any module declares"));
    it("rejects forks", () =>
      check((raw) => {
        raw.stages["game-0"]!.file.forks = [
          {
            at: "main-street",
            options: [
              { label: "LEFT", nextSegment: "front-yard" },
              { label: "RIGHT", nextSegment: "front-yard" },
            ],
          },
        ];
      }, "forks is a post-v1 field that no module reads"));
    for (const kind of ["fork", "qte", "cutscene"] as const)
      it(`rejects segment kind ${kind}`, () =>
        check(
          (raw) => (raw.stages["game-0"]!.segments["main-street"]!.kind = kind),
          `segment kind ${kind} is a post-v1 field that no module reads`,
        ));
    it("rejects a stage type no module runs", () =>
      check(
        (raw) => (raw.stages["game-0"]!.file.type = "vehicle"),
        "stage type vehicle is a post-v1 field that no module reads",
      ));
  });
});
