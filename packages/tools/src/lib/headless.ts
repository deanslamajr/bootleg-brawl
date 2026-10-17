// Headless runs of the sim with bots, shared by metrics, balance, golden replays and tests.

import {
  Bot,
  compileContent,
  Sim,
  type CompiledContent,
  type Difficulty,
  type InputFrame,
  type SimEvent,
} from "@bb/engine";
import { createRegistry } from "@bb/mechanics";
import { loadContent } from "./content-fs";

let cached: { content: CompiledContent; errors: string[] } | null = null;

export function loadCompiled(): CompiledContent {
  if (cached) return cached.content;
  const registry = createRegistry();
  const { raw, errors } = loadContent(registry);
  if (errors.length) throw new Error(`content has errors:\n${errors.slice(0, 20).join("\n")}`);
  cached = { content: compileContent(raw), errors };
  return cached.content;
}

export interface RunOptions {
  stage: string;
  party: string[];
  seed?: number;
  maxTicks?: number;
  difficulty?: Difficulty;
  startSegment?: number;
  /** Called every tick with the events of that tick. */
  onTick?: (sim: Sim, events: SimEvent[], inputs: InputFrame[]) => void;
  /** Stop when this returns true. */
  until?: (sim: Sim) => boolean;
  inputs?: InputFrame[][];
}

export interface RunResult {
  sim: Sim;
  inputs: InputFrame[][];
  ticks: number;
  cleared: boolean;
  gameOver: boolean;
}

export function runBots(opts: RunOptions): RunResult {
  const content = loadCompiled();
  const registry = createRegistry(content.raw.flags);
  const party = [0, 1, 2, 3].map((i) => (opts.party[i] ? content.defIndex[opts.party[i]!]! : -1));
  const sim = new Sim({
    content,
    stageId: opts.stage,
    seed: opts.seed ?? 1,
    registry,
    party,
    difficulty: opts.difficulty ?? "arcade",
    startSegment: opts.startSegment,
  });
  const bots = party.map((_, i) => new Bot(i));
  const inputs: InputFrame[][] = [];
  const max = opts.maxTicks ?? 60 * 60 * 15;
  let cleared = false;
  let gameOver = false;
  for (let t = 0; t < max; t++) {
    const frame = opts.inputs
      ? (opts.inputs[t] ?? [0, 0, 0, 0])
      : bots.map((b, i) => (party[i]! >= 0 ? b.input(sim) : 0));
    inputs.push(frame);
    sim.step(frame);
    for (const ev of sim.events) {
      if (ev.t === "stageClear") cleared = true;
      if (ev.t === "gameOver") gameOver = true;
    }
    opts.onTick?.(sim, sim.events, frame);
    if (cleared || gameOver || opts.until?.(sim)) break;
  }
  return { sim, inputs, ticks: sim.g.tick, cleared, gameOver };
}
