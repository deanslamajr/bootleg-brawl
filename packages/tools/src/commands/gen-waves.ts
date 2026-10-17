// tools gen-waves <stage> <segment> --difficulty N --families a,b [--write]: fills a segment's
// scroll locks from a difficulty target and a family list using a simple pacing model:
// locks spaced along the segment, a threat budget that rises lock by lock, tiers that climb
// with the budget, and sides that alternate. Deterministic for a given input.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Rng, hashString } from "@bb/engine";
import type { ScrollLock, Wave } from "@bb/schema";
import { createRegistry } from "@bb/mechanics";
import { loadContent } from "../lib/content-fs";
import { CONTENT } from "../lib/paths";

const AI_COST: Record<string, number> = {
  brawler: 1,
  grabber: 2,
  thrower: 1.6,
  charger: 2.2,
  acrobat: 1.4,
  swarm: 0.35,
  civilian: 0,
  dummy: 0,
};

export function generateLocks(
  raw: ReturnType<typeof loadContent>["raw"],
  stageId: string,
  segmentId: string,
  difficulty: number,
  families: string[],
): ScrollLock[] {
  const seg = raw.stages[stageId]?.segments[segmentId];
  if (!seg) throw new Error(`unknown segment ${stageId}/${segmentId}`);
  const rng = new Rng(hashString(`${stageId}/${segmentId}/${difficulty}/${families.join(",")}`));
  const last = Math.max(0, seg.length - 480);
  const n = Math.max(1, Math.min(4, Math.floor(seg.length / 380)));
  const locks: ScrollLock[] = [];
  for (let i = 0; i < n; i++) {
    const at = Math.round(160 + ((last - 160) * i) / Math.max(1, n - 1 || 1));
    let budget = difficulty * (1.2 + i * 0.6);
    const waves: Wave[] = [];
    let k = 0;
    while (budget > 0.3 && waves.length < 6) {
      const fam = families[(i + k) % families.length]!;
      const f = raw.enemies[fam];
      if (!f) throw new Error(`unknown family ${fam}`);
      const maxTier = Math.min(2, f.file.tiers.length - 1);
      const tier = Math.min(maxTier, Math.floor((difficulty + i * 2) / 5));
      const t = f.file.tiers[tier]!;
      const cost = Math.max(0.3, (t.hp / 20) * (AI_COST[f.file.ai.kind] ?? 1));
      const count = Math.max(
        1,
        Math.min(f.file.ai.kind === "swarm" ? 6 : 3, Math.floor(budget / cost)),
      );
      waves.push({
        family: fam,
        tier,
        count,
        side: (["right", "left", "both"] as const)[(i + k) % 3]!,
        delayTicks: k * (60 + rng.int(60)),
        spawnKind: "walk",
        fixed: false,
      });
      budget -= count * cost;
      k++;
    }
    locks.push({ id: `${segmentId}-${i + 1}`, at: Math.min(last, at), waves, hold: true });
  }
  return locks;
}

export function genWavesCommand(args: string[]): number {
  const [stage, segment] = args.filter((a) => !a.startsWith("--"));
  const opt = (k: string, d: string) =>
    args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  if (!stage || !segment) {
    console.error(
      "usage: tools gen-waves <stage> <segment> --difficulty=3 --families=interns,sid [--write]",
    );
    return 1;
  }
  const { raw, errors } = loadContent(createRegistry());
  if (errors.length) {
    errors.forEach((e) => console.error(e));
    return 1;
  }
  const locks = generateLocks(
    raw,
    stage,
    segment,
    Number(opt("difficulty", "3")),
    opt("families", "interns").split(","),
  );
  if (!args.includes("--write")) {
    console.log(JSON.stringify(locks, null, 1));
    return 0;
  }
  const file = join(CONTENT, "stages", stage, "segments", `${segment}.json`);
  const doc = JSON.parse(readFileSync(file, "utf8")) as { scrollLocks: ScrollLock[] };
  // Keep locks that carry boss triggers; replace the rest.
  const bossLocks = new Set(
    raw.stages[stage]!.file.bossTriggers.filter((b) => b.at === segment).map((b) => b.lock),
  );
  const kept = doc.scrollLocks.filter((l) => bossLocks.has(l.id));
  doc.scrollLocks = [...locks.filter((l) => !kept.some((k) => k.at <= l.at)), ...kept].sort(
    (a, b) => a.at - b.at,
  );
  writeFileSync(file, JSON.stringify(doc, null, 1) + "\n");
  console.log(
    `gen-waves: wrote ${locks.length} lock(s) into content/stages/${stage}/segments/${segment}.json`,
  );
  return 0;
}
