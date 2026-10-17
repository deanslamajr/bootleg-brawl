// The training room: a sim with no locks where tools spawn dummies and standard waves. Used by
// balance envelopes, character golden replays, perf runs and the sandbox.

import { Bot, F, Sim, type CompiledContent, type InputFrame } from "@bb/engine";
import { createRegistry } from "@bb/mechanics";
import { loadCompiled } from "./headless";

export const TRAINING_STAGE = "training-room";

export interface TrainingRun {
  sim: Sim;
  inputs: InputFrame[][];
  kos: number;
  firstClearTick: number;
}

export function trainingSim(content: CompiledContent, party: string[], seed = 1): Sim {
  return new Sim({
    content,
    stageId: TRAINING_STAGE,
    seed,
    registry: createRegistry(),
    party: [0, 1, 2, 3].map((i) => (party[i] ? content.defIndex[party[i]!]! : -1)),
    sandbox: true,
    difficulty: "arcade",
  });
}

/** Keeps `alive` enemies of a family on screen, respawning from alternating sides. */
export function standardWave(sim: Sim, family = "interns", tier = 1, alive = 2): void {
  const def = sim.content.defIndex[family]!;
  let n = 0;
  for (let e = 0; e < sim.world.high; e++) if (sim.world.alive[e] && sim.c.def[e] === def) n++;
  const cam = sim.g.camX >> 16;
  for (; n < alive; n++) {
    const side = (sim.g.tick + n) % 2 === 0 ? 1 : -1;
    const e = sim.spawnActor(
      def,
      tier,
      side > 0 ? cam + 440 : cam + 40,
      200 + ((sim.g.tick * 7 + n * 23) % 50),
      0,
      -side,
    );
    if (e >= 0) sim.c.flags[e]! |= F.lockEnemy;
  }
}

/** One character alone against the standard wave for `ticks`. */
export function trainingRun(
  charId: string,
  ticks = 3600,
  seed = 1,
  inputs?: InputFrame[][],
): TrainingRun {
  const content = loadCompiled();
  const sim = trainingSim(content, [charId], seed);
  const bot = new Bot(0);
  const rec: InputFrame[][] = [];
  let kos = 0;
  let firstClear = -1;
  for (let t = 0; t < ticks; t++) {
    if (t >= 50) standardWave(sim);
    const frame = inputs ? (inputs[t] ?? [0, 0, 0, 0]) : [bot.input(sim), 0, 0, 0];
    rec.push(frame);
    sim.step(frame);
    for (const ev of sim.events) if (ev.t === "ko" && !ev.player) kos++;
    if (kos >= 6 && firstClear < 0) firstClear = t;
  }
  return { sim, inputs: rec, kos, firstClearTick: firstClear };
}
