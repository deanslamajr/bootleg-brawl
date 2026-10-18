// tools metrics <stage> [--players=1,2,3,4] [--seed=N] [--strict]: bot playthroughs per player
// count with per-segment time-to-clear, enemies on screen, damage taken per family, pickup
// density, idle scroll time, deaths per player and a difficulty curve plot
// (generated/metrics/<stage>.svg).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KIND, PHASE } from "@bb/engine";
import { runBots } from "../lib/headless";
import { GENERATED } from "../lib/paths";

const PARTIES = ["sarge", "boomer", "brat", "mensa"];

export interface SegmentMetrics {
  id: string;
  ticks: number;
  damageTaken: number;
  damagePerMin: number;
  enemiesAvg: number;
  pickups: number;
  pickupsPer1000px: number;
}

export interface StageMetrics {
  stage: string;
  players: number;
  seed: number;
  cleared: boolean;
  ticks: number;
  idleScrollPct: number;
  bossTicks: number;
  segments: SegmentMetrics[];
  damageByFamily: Record<string, number>;
  /** Lives lost per player slot. */
  deaths: number[];
  /** Enemies on screen sampled every second, for the plot. */
  curve: number[];
  failures: string[];
}

export function measureStage(stage: string, players: number, seed = 1): StageMetrics {
  const segs: SegmentMetrics[] = [];
  const byFamily: Record<string, number> = {};
  const curve: number[] = [];
  let cur: SegmentMetrics | null = null;
  let enemySum = 0;
  let samples = 0;
  let playTicks = 0;
  let idle = 0;
  let bossStart = -1;
  let bossTicks = 0;
  const r = runBots({
    stage,
    party: PARTIES.slice(0, players),
    seed,
    onTick(sim, events) {
      const g = sim.g;
      const seg = sim.segment();
      if (!cur || cur.id !== seg.id) {
        if (cur) cur.enemiesAvg = samples ? enemySum / samples : 0;
        enemySum = 0;
        samples = 0;
        let pickups = 0;
        for (const p of seg.placements)
          if (p.kind === "pickup" || p.kind === "breakable") pickups++;
        cur = {
          id: seg.id,
          ticks: 0,
          damageTaken: 0,
          damagePerMin: 0,
          enemiesAvg: 0,
          pickups,
          pickupsPer1000px: (pickups * 1000) / seg.length,
        };
        segs.push(cur);
      }
      cur.ticks++;
      const alive = sim.livingEnemies();
      enemySum += alive;
      samples++;
      if (g.tick % 60 === 0) curve.push(alive);
      if (g.phase === PHASE.play) {
        playTicks++;
        if (!g.lockActive && alive === 0) idle++;
      }
      for (const ev of events) {
        if (ev.t === "hit" && sim.world.alive[ev.target] && sim.c.kind[ev.target] === KIND.player) {
          cur.damageTaken += ev.damage;
          let a = ev.attacker;
          if (sim.world.alive[a] && sim.c.kind[a] === KIND.projectile) a = sim.c.owner[a]! - 1;
          const fam = a >= 0 && sim.world.alive[a] ? sim.def(a).id : "unknown";
          byFamily[fam] = (byFamily[fam] ?? 0) + ev.damage;
        }
        if (ev.t === "bossCard" && !ev.midBoss) bossStart = g.tick;
        if (ev.t === "bossDefeated" && bossStart >= 0 && bossTicks === 0)
          bossTicks = g.tick - bossStart;
      }
    },
  });
  const last = segs[segs.length - 1];
  if (last) last.enemiesAvg = samples ? enemySum / samples : 0;
  for (const s of segs) s.damagePerMin = s.ticks ? (s.damageTaken * 3600) / s.ticks : 0;
  const idlePct = playTicks ? (idle * 100) / playTicks : 0;
  const failures: string[] = [];
  if (!r.cleared)
    failures.push(r.gameOver ? "bots lost (game over)" : "bots did not clear the stage in time");
  if (players === 2) {
    for (const s of segs)
      if (s.ticks > 90 * 60)
        failures.push(
          `segment ${s.id} took ${(s.ticks / 60).toFixed(0)} s at 2 players (target under 90 s)`,
        );
    if (bossTicks > 150 * 60)
      failures.push(`boss took ${(bossTicks / 60).toFixed(0)} s at 2 players (target under 150 s)`);
  }
  if (idlePct > 15) failures.push(`idle scroll is ${idlePct.toFixed(1)}% (target under 15%)`);
  const fights = segs.filter((s) => s.ticks > 600);
  if (fights.length >= 2 && fights[fights.length - 1]!.damagePerMin < fights[0]!.damagePerMin * 0.8)
    failures.push("damage taken falls across the stage (target: rising)");
  return {
    stage,
    players,
    seed,
    cleared: r.cleared,
    ticks: r.ticks,
    idleScrollPct: idlePct,
    bossTicks,
    segments: segs,
    damageByFamily: byFamily,
    deaths: r.sim.g.players.slice(0, players).map((p) => p.deaths),
    curve,
    failures,
  };
}

function svg(all: StageMetrics[]): string {
  const W = 720;
  const H = 240;
  const maxT = Math.max(...all.map((m) => m.curve.length), 1);
  const colors = ["#ffd93a", "#4aa0f0", "#5ac04a", "#ff8ac8"];
  const lines = all
    .map((m, i) => {
      const pts = m.curve
        .map((v, t) => `${(t / maxT) * (W - 40) + 30},${H - 20 - v * 12}`)
        .join(" ");
      return `<polyline fill="none" stroke="${colors[i % 4]}" stroke-width="1.5" points="${pts}"/><text x="${W - 120}" y="${20 + i * 14}" fill="${colors[i % 4]}" font-size="11">${m.players}P ${(m.ticks / 60).toFixed(0)}s</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#1a1420;font-family:monospace"><text x="30" y="16" fill="#f4f0e8" font-size="12">${all[0]?.stage} enemies on screen per second</text><line x1="30" y1="${H - 20}" x2="${W - 10}" y2="${H - 20}" stroke="#6e6a7e"/>${lines}</svg>`;
}

export function metricsCommand(args: string[]): number {
  const stage = args.find((a) => !a.startsWith("--")) ?? "game-0";
  const players = (args.find((a) => a.startsWith("--players="))?.split("=")[1] ?? "1,2,3,4")
    .split(",")
    .map(Number);
  const strict = args.includes("--strict");
  const seed = Number(args.find((a) => a.startsWith("--seed="))?.split("=")[1] ?? 1);
  const all = players.map((p) => measureStage(stage, p, seed));
  const out = join(GENERATED, "metrics");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${stage}.json`), JSON.stringify(all, null, 1));
  writeFileSync(join(out, `${stage}.svg`), svg(all));
  let failed = 0;
  for (const m of all) {
    console.log(
      `\n${stage} at ${m.players}P, seed ${m.seed}: ${m.cleared ? "cleared" : "NOT cleared"} in ${(m.ticks / 60).toFixed(0)} s, idle scroll ${m.idleScrollPct.toFixed(1)}%, boss ${(m.bossTicks / 60).toFixed(0)} s, deaths ${m.deaths.join("/")}`,
    );
    for (const s of m.segments)
      console.log(
        `  ${s.id.padEnd(16)} ${(s.ticks / 60).toFixed(0).padStart(4)} s  dmg/min ${s.damagePerMin.toFixed(0).padStart(4)}  enemies ${s.enemiesAvg.toFixed(1)}  pickups/1000px ${s.pickupsPer1000px.toFixed(1)}`,
      );
    const fam = Object.entries(m.damageByFamily).sort((a, b) => b[1] - a[1]);
    console.log(`  damage taken by family: ${fam.map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const f of m.failures) console.log(`  TARGET MISSED: ${f}`);
    failed += m.failures.length;
  }
  console.log(
    `\nmetrics: wrote generated/metrics/${stage}.json and .svg; ${failed} target(s) missed`,
  );
  return strict && failed ? 1 : 0;
}
