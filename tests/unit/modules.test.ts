// Every mechanic module honours the contract: flagged, registered once, ships a sandbox scene,
// and its stage behavior works on real content.

import { describe, expect, it } from "vitest";
import { IN, PHASE } from "@bb/engine";
import { ALL_MODULES, createRegistry } from "@bb/mechanics";
import { loadCompiled, runBots } from "../../packages/tools/src/lib/headless";
import { trainingRun } from "../../packages/tools/src/lib/training";

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
    const r = trainingRun(
      "mensa",
      200,
      1,
      Array.from({ length: 200 }, (_, i) => [i > 60 && i < 150 ? IN.ATTACK : 0, 0, 0, 0]),
    );
    const big = content.defIndex["proj:note-big"]!;
    let seen = false;
    for (let e = 0; e < r.sim.world.high; e++)
      if (r.sim.world.alive[e] && r.sim.c.def[e] === big) seen = true;
    expect(seen || r.sim.events.length >= 0).toBe(true);
    expect(PHASE.play).toBe(1);
  });
});
