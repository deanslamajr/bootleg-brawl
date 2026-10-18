// Every mechanic module honours the contract: flagged, registered once, ships a sandbox scene,
// and its stage behavior works on real content.

import { describe, expect, it } from "vitest";
import { IN, Sim, World, defineCore, type SystemDef } from "@bb/engine";
import { ALL_MODULES, createRegistry } from "@bb/mechanics";
import { loadCompiled, runBots } from "../../packages/tools/src/lib/headless";
import { trainingSim } from "../../packages/tools/src/lib/training";

describe("module contract", () => {
  it("each module has a flag, a version and a sandbox scene", () => {
    const ids = new Set<string>();
    for (const m of ALL_MODULES) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(m.flag).toMatch(/^mech\./);
      expect(m.sandboxScene).toBeTypeOf("function");
    }
  });
  it("reports flagged-off modules as missing", () => {
    expect(createRegistry(["-mech.elevator"]).missing(["elevator"])).toHaveLength(1);
    expect(createRegistry().missing(["elevator", "nope"])).toEqual(["nope (not registered)"]);
  });
});

// Invariant 4: modules add components, systems and hooks. They never replace or patch a core one.
describe("modules never patch core", () => {
  const CORE_SYSTEMS = [
    "control",
    "ai",
    "movement",
    "camera",
    "collision",
    "combat",
    "fsm",
    "gags",
    "director",
  ];
  const systemsOf = (sim: Sim) => (sim as unknown as { systems: SystemDef[] }).systems;
  const room = (flags: string[]) =>
    new Sim({
      content: loadCompiled(),
      stageId: "training-room",
      seed: 1,
      registry: createRegistry(flags),
      party: [-1, -1, -1, -1],
    });

  it("keeps the core systems, in order, with the same functions", () => {
    const bare = systemsOf(room(ALL_MODULES.map((m) => "-" + m.flag)));
    const full = systemsOf(room([]));
    expect(bare.map((s) => s.name)).toEqual(CORE_SYSTEMS);
    const core = full.filter((s) => CORE_SYSTEMS.includes(s.name));
    expect(core.map((s) => s.name)).toEqual(CORE_SYSTEMS);
    core.forEach((s, i) => expect(s.run).toBe(bare[i]!.run));
    expect(full.length).toBeGreaterThan(bare.length);
  });

  it("never reuses a core system or component name", () => {
    const world = new World(1);
    defineCore(world);
    const coreComponents = (world as unknown as { order: string[] }).order;
    expect(coreComponents.length).toBeGreaterThan(20);
    for (const m of ALL_MODULES) {
      for (const s of m.systems ?? []) expect(CORE_SYSTEMS, `${m.id} system`).not.toContain(s.name);
      for (const c of m.components ?? [])
        expect(coreComponents, `${m.id} component`).not.toContain(c.name);
    }
  });

  it("leaves the Sim class and instance methods alone", () => {
    const methods = () =>
      Object.getOwnPropertyNames(Sim.prototype).map(
        (k) => [k, Object.getOwnPropertyDescriptor(Sim.prototype, k)!.value] as const,
      );
    const before = methods();
    const sim = room([]);
    for (let i = 0; i < 10; i++) sim.step([0, 0, 0, 0]);
    expect(methods()).toEqual(before);
    for (const k of Object.getOwnPropertyNames(sim))
      expect(Object.getOwnPropertyNames(Sim.prototype), `instance field ${k}`).not.toContain(k);
  });
});

describe("module behavior", () => {
  it("elevator: the camera climbs and every floor is fought", () => {
    let maxCamY = 0;
    let floors = 0;
    runBots({
      stage: "game-2",
      party: ["sarge", "boomer"],
      startSegment: 3,
      maxTicks: 60 * 60 * 4,
      onTick(sim) {
        maxCamY = Math.max(maxCamY, sim.g.camY);
        floors = Math.max(floors, sim.g.flags.elevFloor ?? 0);
      },
      until: (sim) => sim.g.seg > 3,
    });
    expect(maxCamY).toBeGreaterThan(0);
    expect(floors).toBe(4);
  });
  it("auto-scroll: the camera advances with nobody walking", () => {
    const r = runBots({
      stage: "game-1",
      party: ["sarge"],
      startSegment: 1,
      maxTicks: 400,
      inputs: [],
    });
    expect(r.sim.g.camX).toBeGreaterThan(0);
  });
  it("charge-shot: holding attack fires the charged note", () => {
    const content = loadCompiled();
    const sim = trainingSim(content, ["mensa"], 1);
    const p = sim.g.players[0]!.ent;
    // A dummy far enough away that nothing hits Mensa while she charges.
    const dummy = sim.spawnActor(
      content.defIndex["interns"]!,
      1,
      (sim.c.x[p]! >> 16) + 200,
      sim.c.y[p]! >> 16,
      0,
      -1,
    );
    sim.c.ai[dummy] = 8;
    const big = content.defIndex["proj:note-big"]!;
    const states = new Set<string>();
    let scale = 0;
    for (let t = 0; t < 110; t++) {
      sim.step([t >= 5 && t <= 80 ? IN.ATTACK : 0, 0, 0, 0]);
      states.add(sim.st(p).name);
      for (let e = 0; e < sim.world.high; e++)
        if (sim.world.alive[e] && sim.c.def[e] === big) scale = Math.max(scale, sim.c.scale[e]!);
    }
    expect(states).toContain("charge");
    expect(states).toContain("chargeShot");
    expect(scale).toBeGreaterThan(100);
  });
});
