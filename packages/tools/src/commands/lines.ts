// tools lines [--seeds=N]: how fast each line pool runs out (DECISIONS D80). Bots play the
// campaign at 1, 2 and 4 players with the speech gate's chance and gap rules. A pool fails when
// one 4-player playthrough shows more lines than it holds. It gets a warning when it lasts fewer
// than 5 playthroughs at 2 players, or when it is smaller than its minimum size.

import type { SimEvent } from "@bb/engine";
import { SpeechGate } from "@bb/engine/render/line-book";
import { loadCompiled, runBots } from "../lib/headless";

const PARTY = ["sarge", "boomer", "brat", "mensa"];
const PLAYERS = [1, 2, 4];
/** Minimum sizes from the plan, whatever the bots measure. Every other pool needs MIN_OTHER. */
const MIN: Record<string, number> = { ko: 100, spawn: 40, taunt: 100 };
const MIN_OTHER = 12;
/** Pools the bots never reach: the select screen does not show its line yet. */
const UNUSED = new Set(["select"]);
const GOAL_RUNS = 5;

/** A seeded stand-in for Math.random, so two runs print the same table. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function linesCommand(args: string[]): number {
  const seeds = Number(args.find((a) => a.startsWith("--seeds="))?.split("=")[1] ?? 3);
  const content = loadCompiled();
  const stages = content.raw.campaign.nodes.map((n) => n.stageId);
  const def = (id: string) => content.defs[content.defIndex[id]!]!;
  /** Players to pool index to the most lines one playthrough showed. */
  const most = new Map<number, Map<number, number>>();
  for (const n of PLAYERS) {
    const party = PARTY.slice(0, n);
    const top = new Map<number, number>();
    for (let seed = 1; seed <= seeds; seed++) {
      const shown = new Map<number, number>();
      const add = (pool: number | undefined) => {
        if (pool !== undefined && pool >= 0) shown.set(pool, (shown.get(pool) ?? 0) + 1);
      };
      const random = seeded(seed * 7919 + n);
      for (const stage of stages) {
        const gate = new SpeechGate(content.raw.speech, random);
        add(content.stagePools[stage]?.announcer);
        runBots({
          stage,
          party,
          seed,
          onTick(sim, events: SimEvent[]) {
            for (const ev of events) {
              if (ev.t === "say") {
                const pool = content.lines[ev.pool];
                if (pool && gate.allow(pool.role, sim.g.tick)) add(ev.pool);
              } else if (ev.t === "bossCard") add(content.defs[ev.def]?.boss?.pools.card);
              else if (ev.t === "continue" && ev.seconds === 10) {
                const d = content.defs[sim.g.players[ev.slot]!.def];
                add(d?.player?.pools.continue);
              }
            }
          },
        });
      }
      for (const id of party) add(def(id).player!.pools.ending);
      for (const [pool, k] of shown) top.set(pool, Math.max(top.get(pool) ?? 0, k));
    }
    most.set(n, top);
  }

  // Every pool the content could fill, empty ones included, so missing pools show up too.
  const rows: { key: string; role: string; size: number }[] = content.lines.map((p) => ({
    key: p.key,
    role: p.role,
    size: p.lines.length,
  }));
  const named = new Set(rows.map((r) => r.key));
  const expect = (prefix: string, names: string[]) => {
    for (const name of names)
      if (!named.has(`${prefix}/${name}`))
        rows.push({ key: `${prefix}/${name}`, role: name, size: 0 });
  };
  for (const id of Object.keys(content.raw.characters))
    expect(`character/${id}`, ["taunt", "continue", "ending", "select"]);
  for (const id of Object.keys(content.raw.enemies))
    expect(
      `enemy/${id}`,
      id === "bystanders" ? ["ko", "spawn", "help", "rescue"] : ["ko", "spawn"],
    );
  for (const [id, b] of Object.entries(content.raw.bosses)) {
    // A boss speaks pattern lines only from taunt steps with a line, and phase banners only when
    // a phase has an enterText, so it needs those pools only then.
    const steps = b.file.phases.flatMap((ph) => ph.patterns.flatMap((pt) => pt.steps));
    expect(`boss/${id}`, [
      "hurt",
      "defeat",
      "card",
      "defeatBanner",
      ...(steps.some((st) => st.do === "taunt" && st.line) ? ["pattern"] : []),
      ...(b.file.phases.some((ph) => ph.enterText) ? ["phase"] : []),
    ]);
  }
  for (const id of stages)
    expect(`stage/${id}`, ["costume", "bulletin", "outro", "outroBanner", "announcer"]);
  // Stages outside the campaign, such as the training room, are not playthroughs.
  const kept = rows.filter(
    (r) => !r.key.startsWith("stage/") || stages.includes(r.key.split("/")[1]!),
  );
  rows.length = 0;
  rows.push(...kept);
  rows.sort((a, b) => (a.key < b.key ? -1 : 1));

  let fails = 0;
  let warns = 0;
  console.log(
    `${"pool".padEnd(36)} ${"size".padStart(5)} ${PLAYERS.map((n) => `${n}P`.padStart(5)).join(" ")}  runs@2P  note`,
  );
  for (const r of rows) {
    const index = content.lines.findIndex((p) => p.key === r.key);
    const k = PLAYERS.map((n) => (index >= 0 ? (most.get(n)!.get(index) ?? 0) : 0));
    const runs = k[1]! > 0 ? r.size / k[1]! : Infinity;
    const notes: string[] = [];
    if (k[2]! > r.size) {
      notes.push("REPEATS in one 4P playthrough");
      fails++;
    }
    const min = MIN[r.role] ?? MIN_OTHER;
    if (!UNUSED.has(r.role) && r.size < min) notes.push(`below the minimum of ${min}`);
    if (runs < GOAL_RUNS && k[2]! <= r.size)
      notes.push(`lasts under ${GOAL_RUNS} playthroughs at 2P`);
    if (notes.length && !notes[0]!.startsWith("REPEATS")) warns++;
    console.log(
      `${r.key.padEnd(36)} ${String(r.size).padStart(5)} ${k.map((v) => String(v).padStart(5)).join(" ")}  ${(runs === Infinity ? "-" : runs.toFixed(1)).padStart(7)}  ${notes.join("; ")}`,
    );
  }
  console.log(
    `lines: ${rows.length} pools, ${fails} repeat within a 4P playthrough, ${warns} with warnings (${seeds} seed(s), most lines per playthrough)`,
  );
  return fails ? 1 : 0;
}
