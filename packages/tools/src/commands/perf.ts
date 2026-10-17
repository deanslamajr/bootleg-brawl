// tools perf: headless sim timing at 4 players + 14 enemies + 40 projectiles. Targets: p95 sim
// tick under 4 ms and snapshot + restore under 1 ms (the rollback budget for later netcode).

import { Bot, F, intToFx, toFx } from "@bb/engine";
import { loadCompiled } from "../lib/headless";
import { trainingSim } from "../lib/training";

export function perfCommand(): number {
  const content = loadCompiled();
  const sim = trainingSim(content, ["sarge", "boomer", "brat", "mensa"], 3);
  const bots = [0, 1, 2, 3].map((i) => new Bot(i));
  const note = content.defIndex["proj:note"]!;
  const families = ["interns", "shoe-clan", "sid", "rollerinas", "mungus", "sewer-rats"];
  const times: number[] = [];
  const snaps: number[] = [];
  for (let t = 0; t < 3600; t++) {
    // Keep the scene at the plan's worst case.
    let enemies = 0;
    let shots = 0;
    for (let e = 0; e < sim.world.high; e++) {
      if (!sim.world.alive[e]) continue;
      const k = sim.c.kind[e];
      if (k === 2) enemies++;
      if (k === 4) shots++;
    }
    for (; enemies < 14; enemies++) {
      const fam = families[enemies % families.length]!;
      const e = sim.spawnActor(
        content.defIndex[fam]!,
        enemies % 3,
        60 + ((enemies * 53) % 360),
        190 + ((enemies * 17) % 60),
        0,
        1,
      );
      if (e >= 0) sim.c.flags[e]! |= F.lockEnemy;
    }
    for (; shots < 40; shots++)
      sim.spawnProjectile(
        note,
        -1,
        intToFx(20 + ((shots * 11) % 440)),
        intToFx(190 + (shots % 60)),
        intToFx(20),
        toFx(shots % 2 ? 1.5 : -1.5),
        0,
        1,
      );
    const f = bots.map((b) => b.input(sim));
    const t0 = performance.now();
    sim.step(f);
    times.push(performance.now() - t0);
    if (t % 60 === 0) {
      const s0 = performance.now();
      const snap = sim.snapshot();
      sim.restore(snap);
      snaps.push(performance.now() - s0);
    }
  }
  const pct = (a: number[], p: number) =>
    [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)]!;
  const p50 = pct(times, 0.5);
  const p95 = pct(times, 0.95);
  const snap95 = pct(snaps, 0.95);
  console.log(
    `perf: sim tick p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms (target under 4 ms); snapshot+restore p95 ${snap95.toFixed(3)} ms (target under 1 ms); ${sim.world.count()} entities`,
  );
  return p95 < 4 && snap95 < 1 ? 0 : 1;
}
