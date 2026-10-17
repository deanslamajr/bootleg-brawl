// Golden replays: recorded input logs plus the sim's state hash every 60 ticks. Replaying the
// inputs must reproduce every checkpoint bit for bit, on any machine. One per character (training
// room), one per stage (two bots) and one four-player chaos session.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Bot, compileContent, Sim, type InputFrame } from "@bb/engine";
import { createRegistry } from "@bb/mechanics";
import { loadCompiled } from "./headless";
import { standardWave, trainingSim } from "./training";
import { ROOT } from "./paths";

export const GOLDEN_DIR = join(ROOT, "tests", "golden");
export const CHECKPOINT = 60;

export interface GoldenReplay {
  name: string;
  kind: "character" | "stage" | "chaos";
  stage: string;
  party: string[];
  seed: number;
  ticks: number;
  contentHash: string;
  /** Run-length encoded input frames: [repeat, p1, p2, p3, p4]. */
  inputs: number[][];
  checkpoints: Record<string, string>;
  final: string;
}

export function rle(frames: InputFrame[][]): number[][] {
  const out: number[][] = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last && last[1] === f[0] && last[2] === f[1] && last[3] === f[2] && last[4] === f[3])
      last[0]!++;
    else out.push([1, f[0] ?? 0, f[1] ?? 0, f[2] ?? 0, f[3] ?? 0]);
  }
  return out;
}

export function unrle(runs: number[][]): InputFrame[][] {
  const out: InputFrame[][] = [];
  for (const [n, a, b, c, d] of runs) for (let i = 0; i < n!; i++) out.push([a!, b!, c!, d!]);
  return out;
}

interface Driver {
  sim: Sim;
  /** Called before each step (training-room wave upkeep). */
  pre?: (sim: Sim) => void;
}

function driver(g: Pick<GoldenReplay, "kind" | "stage" | "party" | "seed">): Driver {
  const content = loadCompiled();
  if (g.kind === "character") {
    const sim = trainingSim(content, g.party, g.seed);
    return { sim, pre: (s) => s.g.tick >= 50 && standardWave(s) };
  }
  const sim = new Sim({
    content,
    stageId: g.stage,
    seed: g.seed,
    registry: createRegistry(),
    party: [0, 1, 2, 3].map((i) => (g.party[i] ? content.defIndex[g.party[i]!]! : -1)),
  });
  return { sim };
}

function hex(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

export function record(
  spec: Pick<GoldenReplay, "name" | "kind" | "stage" | "party" | "seed" | "ticks">,
): GoldenReplay {
  const { sim, pre } = driver(spec);
  const bots = spec.party.map((_, i) => new Bot(i));
  const frames: InputFrame[][] = [];
  const checkpoints: Record<string, string> = {};
  for (let t = 0; t < spec.ticks; t++) {
    pre?.(sim);
    const f = [0, 1, 2, 3].map((i) => (spec.party[i] ? bots[i]!.input(sim) : 0));
    frames.push(f);
    sim.step(f);
    if (sim.g.tick % CHECKPOINT === 0) checkpoints[sim.g.tick] = hex(sim.hash());
  }
  return {
    ...spec,
    contentHash: loadCompiled().hash,
    inputs: rle(frames),
    checkpoints,
    final: hex(sim.hash()),
  };
}

export interface VerifyResult {
  ok: boolean;
  firstMismatch: number | null;
  message: string;
}

export function verify(g: GoldenReplay): VerifyResult {
  const content = loadCompiled();
  const { sim, pre } = driver(g);
  const frames = unrle(g.inputs);
  for (let t = 0; t < frames.length; t++) {
    pre?.(sim);
    sim.step(frames[t]!);
    const want = g.checkpoints[sim.g.tick];
    if (want && want !== hex(sim.hash())) {
      const why =
        g.contentHash !== content.hash
          ? " (content changed since recording; re-record with a justification)"
          : "";
      return {
        ok: false,
        firstMismatch: sim.g.tick,
        message: `${g.name}: state hash differs at tick ${sim.g.tick}${why}`,
      };
    }
  }
  if (hex(sim.hash()) !== g.final)
    return { ok: false, firstMismatch: frames.length, message: `${g.name}: final hash differs` };
  return {
    ok: true,
    firstMismatch: null,
    message: `${g.name}: ${Object.keys(g.checkpoints).length} checkpoints match`,
  };
}

export function goldenSpecs(): Pick<
  GoldenReplay,
  "name" | "kind" | "stage" | "party" | "seed" | "ticks"
>[] {
  const content = loadCompiled();
  const specs: Pick<GoldenReplay, "name" | "kind" | "stage" | "party" | "seed" | "ticks">[] = [];
  for (const id of content.raw.roster.rosterOrder)
    specs.push({
      name: `character-${id}`,
      kind: "character",
      stage: "training-room",
      party: [id],
      seed: 7,
      ticks: 1800,
    });
  for (const node of content.raw.campaign.nodes)
    specs.push({
      name: `stage-${node.stageId}`,
      kind: "stage",
      stage: node.stageId,
      party: ["sarge", "brat"],
      seed: 11,
      ticks: 60 * 60 * 6,
    });
  specs.push({
    name: "chaos-4p",
    kind: "chaos",
    stage: content.raw.campaign.start,
    party: ["sarge", "boomer", "brat", "mensa"],
    seed: 13,
    ticks: 60 * 90,
  });
  return specs;
}

export function loadGoldens(): GoldenReplay[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".replay.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf8")) as GoldenReplay);
}

export function saveGolden(g: GoldenReplay): void {
  writeFileSync(join(GOLDEN_DIR, `${g.name}.replay.json`), JSON.stringify(g) + "\n");
}

export { compileContent };
