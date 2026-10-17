// tools balance [ids...] [--record]: a scripted bot plays each character for 60 s against the
// standard wave in the training room. DPS, damage taken and time-to-clear must land within
// ±15% of the archetype band in content/balance/bands.json, or the character is flagged.
// --record writes the current results as the band centers (do this only with a justification).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { trainingRun } from "../lib/training";
import { loadCompiled } from "../lib/headless";
import { CONTENT } from "../lib/paths";

const bandsFile = z.strictObject({
  schemaVersion: z.literal(1),
  tolerancePct: z.number().default(15),
  bands: z.record(
    z.string(),
    z.strictObject({ dps: z.number(), taken: z.number(), clearSeconds: z.number() }),
  ),
});
const BANDS = join(CONTENT, "balance", "bands.json");

export interface BalanceResult {
  id: string;
  archetype: string;
  dps: number;
  taken: number;
  clearSeconds: number;
}

export function measure(id: string): BalanceResult {
  const content = loadCompiled();
  const d = content.defs[content.defIndex[id]!]!;
  const r = trainingRun(id, 3600, 1);
  const p = r.sim.g.players[0]!;
  return {
    id,
    archetype: d.player!.archetype,
    dps: Math.round((p.dealt / 60) * 10) / 10,
    taken: p.taken,
    clearSeconds: r.firstClearTick < 0 ? 60 : Math.round((r.firstClearTick / 60) * 10) / 10,
  };
}

export function balanceCommand(args: string[]): number {
  const content = loadCompiled();
  const ids = args.filter((a) => !a.startsWith("--"));
  const roster = ids.length ? ids : content.raw.roster.rosterOrder;
  const results = roster.map(measure);
  if (args.includes("--record")) {
    const bands: Record<string, { dps: number; taken: number; clearSeconds: number }> = {};
    for (const r of results)
      bands[r.archetype] = { dps: r.dps, taken: r.taken, clearSeconds: r.clearSeconds };
    mkdirSync(join(CONTENT, "balance"), { recursive: true });
    writeFileSync(
      BANDS,
      JSON.stringify({ schemaVersion: 1, tolerancePct: 15, bands }, null, 1) + "\n",
    );
    console.log(
      `balance: recorded ${Object.keys(bands).length} archetype band(s) to content/balance/bands.json`,
    );
    return 0;
  }
  if (!existsSync(BANDS)) {
    console.error("balance: content/balance/bands.json is missing; run with --record once");
    return 1;
  }
  const file = bandsFile.parse(JSON.parse(readFileSync(BANDS, "utf8")));
  let flagged = 0;
  for (const r of results) {
    const band = file.bands[r.archetype];
    const line = `${r.id.padEnd(8)} ${r.archetype.padEnd(9)} dps ${r.dps}  taken ${r.taken}  clear ${r.clearSeconds}s`;
    if (!band) {
      console.log(`${line}  (no band for this archetype)`);
      continue;
    }
    const off = (v: number, b: number) => (b === 0 ? 0 : Math.abs(v - b) / b) * 100;
    const misses = (["dps", "taken", "clearSeconds"] as const).filter(
      (k) => off(r[k], band[k]) > file.tolerancePct,
    );
    if (misses.length) flagged++;
    console.log(
      `${line}  ${misses.length ? `FLAGGED: ${misses.map((k) => `${k} ${r[k]} vs band ${band[k]}`).join(", ")}` : "within band"}`,
    );
  }
  return flagged ? 1 : 0;
}
