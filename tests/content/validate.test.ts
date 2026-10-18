import { describe, expect, it } from "vitest";
import { createRegistry } from "@bb/mechanics";
import { validateRaw, validateRepo } from "../../packages/tools/src/lib/validate";
import { loadContent } from "../../packages/tools/src/lib/content-fs";
import { IndexedImage } from "../../packages/tools/src/art/raster";
import { emptySprites, type SpriteImage } from "../../packages/tools/src/art/sprites";
import { shape, type SpriteMeta } from "@bb/schema";

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
  describe("generated art", () => {
    const registry = createRegistry();
    const load = loadContent(registry);
    const meta = { anchor: [0, 0] } as unknown as SpriteMeta;
    const png = (w: number, h: number, v: number, file: string, withMeta = true): SpriteImage => {
      const img = new IndexedImage(w, h);
      img.fill(v);
      return { img, anchor: [w / 2, h / 2], file, paletteSize: 16, ...(withMeta ? { meta } : {}) };
    };
    const run = (
      scope: string,
      tamper: (raw: typeof load.raw, sprites: ReturnType<typeof emptySprites>) => void,
    ) => {
      const raw = structuredClone(load.raw);
      const sprites = emptySprites();
      sprites.art = load.sprites.art;
      tamper(raw, sprites);
      return validateRaw(raw, registry, { errors: [], warnings: [], docs: load.docs, sprites }, scope)
        .errors;
    };
    const head = (file = "sprites/head.png") =>
      shape.parse({ shape: "sprite", file, at: "head", z: 51 });
    const F = "content/enemies/interns/sprites/head.png";

    it("reports a sprite shape whose file is missing", () => {
      const errors = run("enemies/interns", (raw) => {
        raw.enemies["interns"]!.overlays.layers.head.push(head("sprites/nope.png"));
      });
      expect(errors).toEqual(["content/enemies/interns/overlays.json: sprite sprites/nope.png is missing"]);
    });
    it("reports an index past the actor palette, a disallowed index and a missing sidecar", () => {
      const errors = run("enemies/interns", (raw, sp) => {
        raw.enemies["interns"]!.overlays.layers.head.push(head());
        sp.actors["interns"] = { "sprites/head.png": png(4, 4, 16, F, false) };
      });
      expect(errors).toEqual([
        `${F}: index 16 is outside the 16-color actor palette`,
        `${F}: uses index 16, which part head does not allow`,
        `${F}: generated image has no sidecar head.gen.json`,
      ]);
      const ok = run("enemies/interns", (raw, sp) => {
        raw.enemies["interns"]!.overlays.layers.head.push(head());
        sp.actors["interns"] = { "sprites/head.png": png(4, 4, 4, F) };
      });
      expect(ok).toEqual([]);
      const bad = run("enemies/interns", (_raw, sp) => {
        sp.actors["interns"] = { "sprites/head.png": png(4, 4, 9, F) };
      });
      expect(bad).toEqual([`${F}: uses index 9, which part head does not allow`]);
    });
    it("rejects a sprite that pushes the idle pose out of the frame box", () => {
      const errors = run("enemies/interns", (raw, sp) => {
        raw.enemies["interns"]!.overlays.layers.head.push(head());
        sp.actors["interns"] = { "sprites/head.png": png(60, 10, 4, F) };
      });
      expect(errors.some((e) => e.includes("fall outside the medium rig frame box"))).toBe(true);
    });
    it("reports an image op whose file is missing, too large or past the stage palette", () => {
      const L = "content/stages/game-0/layers";
      const errors = run("stages/game-0", (raw, sp) => {
        const layers = raw.stages["game-0"]!.layers;
        layers["sky"]!.ops.unshift({ op: "image", file: "gone.png", x: 0, y: 0 });
        layers["hedge"]!.ops.unshift({ op: "image", file: "hedge.png", x: 0, y: 0 });
        sp.layers["game-0"] = { "hedge.png": png(970, 30, 33, `${L}/hedge.png`) };
      });
      expect(errors).toEqual([
        `${L}/hedge.json: image hedge.png is 970x30, larger than the 960x30 layer`,
        `${L}/sky.json: image gone.png is missing`,
        `${L}/hedge.png: index 33 is outside the 32-color stage palette`,
      ]);
    });
  });
});

