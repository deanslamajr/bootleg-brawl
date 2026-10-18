// The scripted bot: one bot instance kept across sims, as the app's test hook does between
// stages, starts each new sim with fresh cooldowns.

import { beforeAll, describe, expect, it } from "vitest";
import { Bot, IN, type CompiledContent } from "@bb/engine";
import { loadCompiled } from "../../packages/tools/src/lib/headless";
import { standardWave, trainingSim } from "../../packages/tools/src/lib/training";

let content: CompiledContent;
beforeAll(() => {
  content = loadCompiled();
});

describe("bot", () => {
  it("attacks on a fresh sim after a long run on another", () => {
    const bot = new Bot(0);
    const first = trainingSim(content, ["sarge"], 1);
    for (let t = 0; t < 3000; t++) {
      if (t >= 50) standardWave(first);
      first.step([bot.input(first), 0, 0, 0]);
    }
    expect(first.g.tick).toBeGreaterThan(2900);

    const sim = trainingSim(content, ["sarge"], 2);
    for (let i = 0; i < 50; i++) sim.step([0, 0, 0, 0]);
    const p = sim.g.players[0]!.ent;
    const e = sim.spawnActor(
      content.defIndex["interns"]!,
      1,
      (sim.c.x[p]! >> 16) + 22,
      sim.c.y[p]! >> 16,
      0,
      -1,
    );
    sim.c.ai[e] = 8; // dummy
    let attackedAt = -1;
    for (let t = 0; t < 60 && attackedAt < 0; t++) {
      const bits = bot.input(sim);
      if (bits & IN.ATTACK) attackedAt = t;
      sim.step([bits, 0, 0, 0]);
    }
    expect(attackedAt).toBeGreaterThanOrEqual(0);
  });
});
