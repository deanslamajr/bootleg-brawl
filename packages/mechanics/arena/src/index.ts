// Boss arenas: hazards on rails (the un-bootleg beam cannon), currents that drift everyone,
// HP-threshold phases with spawns, and arena rules such as throw-toward-camera.

import { F, FX, KIND, SK, intToFx, toFx, VIEW_W, type MechanicModule, type Sim } from "@bb/engine";
import type { ArenaFile } from "@bb/schema";

function arena(sim: Sim): ArenaFile | undefined {
  const id = sim.g.flags.arenaId;
  if (!id) return undefined;
  return Object.values(sim.content.raw.arenas).sort((a, b) => (a.id < b.id ? -1 : 1))[id - 1];
}

function arenaIndex(sim: Sim, id: string): number {
  return (
    Object.values(sim.content.raw.arenas)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .findIndex((a) => a.id === id) + 1
  );
}

function fireBeam(sim: Sim): void {
  const g = sim.g;
  const def = sim.content.defIndex["proj:unbootleg-beam"];
  if (def === undefined) return;
  sim.spawnProjectile(def, -1, g.flags.railX ?? 0, g.flags.railY ?? intToFx(220), 0, 0, 0, 1);
  sim.sfx("zap");
  sim.emit({ t: "shake", ticks: 4 });
}

export const arenaModule: MechanicModule = {
  id: "arena",
  version: 1,
  flag: "mech.arena",
  defaultOn: true,
  hooks: {
    onBossStart(sim, bosses, arenaId) {
      const g = sim.g;
      if (!arenaId) return;
      const idx = arenaIndex(sim, arenaId);
      if (idx <= 0) return;
      g.flags.arenaId = idx;
      g.flags.arenaPhase = 0;
      const a = arena(sim)!;
      if (a.rules.throwTowardCamera) g.flags.throwCam = 1;
      for (const h of a.hazards) {
        if (h.kind === "rail") {
          g.flags.railX = g.camX + intToFx(VIEW_W / 2);
          g.flags.railY = intToFx((a.depth[0] + a.depth[1]) >> 1);
          g.flags.railTimer = Number(h.params.cooldown ?? 80);
          g.flags.railTell = 0;
        }
      }
      void bosses;
    },
    onBossEnd(sim) {
      const g = sim.g;
      g.flags.arenaId = 0;
      g.flags.throwCam = 0;
      g.flags.railTell = 0;
      g.flags.railTimer = 0;
    },
    onHit(sim, _a, t, hit) {
      if (!hit.tags.includes("unbootleg")) return false;
      const c = sim.c;
      if (c.kind[t] !== KIND.player) return true;
      let ticks = 360;
      for (const b of sim.g.bosses) {
        if (!sim.world.alive[b]) continue;
        const p = sim.def(b).boss?.gimmicks.get("unbootlegBeam");
        if (p && typeof p.tinyTicks === "number") ticks = p.tinyTicks;
      }
      if (!c.tiny[t]) sim.emit({ t: "tiny", ent: t, on: true });
      c.tiny[t] = ticks;
      sim.text("UN-BOOTLEGGED!", "pop", t, 70);
      return true;
    },
    onGimmick(sim, _boss, gimmick, tick) {
      if (gimmick !== "beamVolley") return false;
      // During a volley the cannon fires on a short fuse.
      const g = sim.g;
      if (tick === 1) sim.text("UN-BOOTLEG BEAM: CHARGING", "banner", -1, 90);
      if ((g.flags.railTimer ?? 0) > 30) g.flags.railTimer = 30;
      return true;
    },
  },
  systems: [
    {
      phase: "movement",
      order: 5,
      name: "arenaHazards",
      run(sim) {
        const a = arena(sim);
        if (!a || sim.actorsFrozen) return;
        const g = sim.g;
        const c = sim.c;
        for (const h of a.hazards) {
          if (h.kind === "current") {
            const v = toFx(Number(h.params.speed ?? -0.3));
            for (let e = 0; e < sim.world.high; e++) {
              if (!sim.world.alive[e] || !sim.isActor(e) || c.z[e]! > 0) continue;
              const k = sim.stateKind(e);
              if (k === SK.grabbed || c.flags[e]! & F.boss) continue;
              c.x[e] = c.x[e]! + v;
            }
          }
          if (h.kind === "rail") {
            const players = sim.targetablePlayers();
            if (players.length === 0) continue;
            const target = players[(g.tick >> 8) % players.length]!;
            const speed = toFx(Number(h.params.speed ?? 1.5));
            const rx = g.flags.railX ?? g.camX;
            if ((g.flags.railTell ?? 0) === 0) {
              g.flags.railX = rx + Math.max(-speed, Math.min(speed, c.x[target]! - rx));
              g.flags.railY = c.y[target]!;
            }
            if ((g.flags.railTell ?? 0) > 0) {
              g.flags.railTell = (g.flags.railTell ?? 0) - 1;
              if (g.flags.railTell === 0) fireBeam(sim);
              continue;
            }
            g.flags.railTimer = (g.flags.railTimer ?? 0) - 1;
            if ((g.flags.railTimer ?? 0) <= 0) {
              g.flags.railTell = Number(h.params.telegraph ?? 36);
              const pct = phasePct(sim);
              const base = Number(h.params.cooldown ?? 80);
              g.flags.railTimer = pct < 60 ? Math.trunc((base * 2) / 3) : base;
              sim.sfx("charge");
            }
          }
        }
      },
    },
    {
      phase: "events",
      order: 10,
      name: "arenaPhases",
      run(sim) {
        const a = arena(sim);
        if (!a) return;
        const g = sim.g;
        const pct = phasePct(sim);
        const done = g.flags.arenaPhase ?? 0;
        const next = a.phases[done];
        if (next && pct <= next.hpBelowPct) {
          g.flags.arenaPhase = done + 1;
          if (next.text) sim.text(next.text, "banner", -1, 120);
          if (next.spawn)
            sim.queueWave(
              {
                family: next.spawn.family,
                tier: next.spawn.tier,
                count: next.spawn.count,
                side: "both",
                delayTicks: 0,
                spawnKind: "walk",
                fixed: true,
              },
              0,
            );
        }
      },
    },
  ],
  sandboxScene: () => ({
    title: "Cheesegrater throne",
    stage: "game-1",
    segment: 3,
    characters: ["sarge", "boomer"],
  }),
};

function phasePct(sim: Sim): number {
  const c = sim.c;
  let hp = 0;
  let max = 0;
  for (const b of sim.g.bosses) {
    if (!sim.world.alive[b]) continue;
    hp += Math.max(0, c.hp[b]!);
    max += c.maxHp[b]!;
  }
  return max > 0 ? Math.trunc((hp * 100) / max) : 100;
}

export default arenaModule;
void FX;
