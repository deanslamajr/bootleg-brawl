// tools play <stage> [party] [--seed N] [--ticks N]: a headless bot playthrough with a summary.

import { runBots } from "../lib/headless";

export function playCommand(args: string[]): number {
  const pos = args.filter((a) => !a.startsWith("--"));
  const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  const stage = pos[0] ?? "game-0";
  const party = (pos[1] ?? "sarge,boomer").split(",");
  const t0 = Date.now();
  const r = runBots({
    stage,
    party,
    seed: Number(opt("seed") ?? 1),
    maxTicks: Number(opt("ticks") ?? 60 * 60 * 15),
    onTick(sim, events) {
      for (const ev of events)
        if (
          [
            "segment",
            "lockClear",
            "bossCard",
            "bossDefeated",
            "stageClear",
            "gameOver",
            "continue",
          ].includes(ev.t)
        )
          console.log(
            `${String(sim.g.tick).padStart(6)} ${ev.t}${"id" in ev ? ` ${ev.id}` : ""}${ev.t === "bossCard" ? ` ${sim.content.defs[ev.def]!.id}` : ""}`,
          );
    },
  });
  const secs = (r.ticks / 60).toFixed(0);
  console.log(
    `${stage}: ${r.cleared ? "CLEARED" : r.gameOver ? "GAME OVER" : "TIMED OUT"} after ${r.ticks} ticks (${secs} s game time, ${Date.now() - t0} ms wall)`,
  );
  for (const [i, p] of r.sim.g.players.entries()) {
    if (p.def < 0) continue;
    console.log(
      `  P${i + 1} ${r.sim.content.defs[p.def]!.id.padEnd(8)} score ${p.score} KOs ${p.kos} deaths ${p.deaths} dealt ${p.dealt} taken ${p.taken}`,
    );
  }
  return r.cleared ? 0 : 1;
}
