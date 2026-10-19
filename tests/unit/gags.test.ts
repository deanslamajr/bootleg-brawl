// Scenery gags with a step trigger fire once when a player arrives, and arm again only after the
// zone has been empty for the rearm window (D78). The Game 0 sprinkler is the shipped example.

import { beforeAll, describe, expect, it } from "vitest";
import { Sim, intToFx, type CompiledContent } from "@bb/engine";
import { createRegistry } from "@bb/mechanics";
import { loadCompiled } from "../../packages/tools/src/lib/headless";

let content: CompiledContent;
beforeAll(() => {
  content = loadCompiled();
});

/** The sprinkler's spot in content/stages/game-0/segments/front-yard.json. */
const SPRINKLER_X = 470;
const SPRINKLER_Y = 206;
/** A spot on the lawn outside the sprinkler's 12 px step radius. */
const OFF_X = 400;

/** Game 0 with one player, stepped past the intro banner. */
function frontYard(): { sim: Sim; p: number } {
  const sim = new Sim({
    content,
    stageId: "game-0",
    seed: 1,
    registry: createRegistry(),
    party: [content.defIndex["sarge"]!, -1, -1, -1],
  });
  for (let i = 0; i < 120; i++) sim.step([0, 0, 0, 0]);
  return { sim, p: sim.g.players[0]!.ent };
}

/**
 * Holds the player at (x, 206, 0) for `ticks` steps and counts the PSSSHH texts. The pin runs
 * before every step, so enemies can neither push the player off the spot nor launch them.
 */
function stand(sim: Sim, p: number, x: number, ticks: number): number {
  let fires = 0;
  for (let i = 0; i < ticks; i++) {
    sim.c.x[p] = intToFx(x);
    sim.c.y[p] = intToFx(SPRINKLER_Y);
    sim.c.z[p] = 0;
    sim.c.vz[p] = 0;
    sim.step([0, 0, 0, 0]);
    fires += sim.events.filter((e) => e.t === "text" && e.text === "PSSSHH").length;
  }
  return fires;
}

describe("step gags", () => {
  it("fires once while a player stands on the sprinkler", () => {
    const { sim, p } = frontYard();
    const score = sim.g.players[0]!.score;
    expect(stand(sim, p, SPRINKLER_X, 180)).toBe(1);
    expect(sim.g.players[0]!.score - score).toBe(5);
  });

  it("fires again after the player leaves and comes back", () => {
    const { sim, p } = frontYard();
    let fires = stand(sim, p, SPRINKLER_X, 60);
    fires += stand(sim, p, OFF_X, 60);
    fires += stand(sim, p, SPRINKLER_X, 60);
    expect(fires).toBe(2);
  });

  it("does not fire again when the player steps off for less than the rearm window", () => {
    const { sim, p } = frontYard();
    let fires = stand(sim, p, SPRINKLER_X, 60);
    fires += stand(sim, p, OFF_X, 10);
    fires += stand(sim, p, SPRINKLER_X, 60);
    expect(fires).toBe(1);
  });
});
