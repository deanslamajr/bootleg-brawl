// Environmental spawns: enemies come out of manholes, dumpsters, doors, ceilings and floors.

import { F, FX, KIND, intToFx, type MechanicModule, type Sim, type SpawnRequest } from "@bb/engine";

/** Nearest spawner prop (manhole, dumpster) inside the view, or -1. */
function nearestSpawner(sim: Sim, kindId: string): number {
  const c = sim.c;
  const cam = sim.g.camX;
  let best = -1;
  let bestD = Infinity;
  for (let e = 0; e < sim.world.high; e++) {
    if (!sim.world.alive[e] || c.kind[e] !== KIND.prop) continue;
    const d = sim.def(e);
    if (!d.prop?.spawner || !d.id.includes(kindId)) continue;
    const dx = Math.abs(c.x[e]! - (cam + intToFx(240)));
    if (dx < bestD) {
      bestD = dx;
      best = e;
    }
  }
  return best;
}

function emergeAt(sim: Sim, req: SpawnRequest, prop: string, dy: number): number {
  let x = req.x;
  let y = req.y;
  if (x < 0) {
    const s = nearestSpawner(sim, prop);
    if (s < 0) return -1;
    x = sim.c.x[s]! / FX;
    y = sim.c.y[s]! / FX;
  }
  const e = sim.spawnActor(req.def, req.tier, Math.round(x), Math.round(y + dy), 0, 1);
  if (e < 0) return -1;
  const d = sim.def(e);
  if (d.S.emerge >= 0) sim.enterState(e, d.S.emerge);
  sim.c.flags[e]! |= F.emerging;
  sim.sfx("whoosh", e);
  return e;
}

export const environmentalSpawnModule: MechanicModule = {
  id: "environmental-spawn",
  version: 1,
  flag: "mech.envSpawn",
  defaultOn: true,
  spawnKinds: {
    manhole: (sim, req) => emergeAt(sim, req, "manhole", 1),
    dumpster: (sim, req) => emergeAt(sim, req, "dumpster", 6),
    door: (sim, req) => emergeAt(sim, req, "door", 2),
    ceiling: (sim, req) => {
      const x = req.x >= 0 ? req.x : (sim.g.camX >> 16) + 80 + sim.rng.int(320);
      const y = req.y >= 0 ? req.y : (sim.g.depthMin + sim.g.depthMax) >> 1;
      return sim.spawnActor(req.def, req.tier, x, y, 200, 1);
    },
    floor: (sim, req) =>
      emergeAt(sim, { ...req, x: req.x >= 0 ? req.x : (sim.g.camX >> 16) + 240 }, "", 0),
  },
  systems: [
    {
      phase: "state",
      order: 60,
      name: "emerge",
      run(sim) {
        const c = sim.c;
        for (let e = 0; e < sim.world.high; e++) {
          if (!sim.world.alive[e] || !(c.flags[e]! & F.emerging)) continue;
          if (sim.st(e).id !== sim.def(e).S.emerge) c.flags[e]! &= ~F.emerging;
        }
      },
    },
  ],
  sandboxScene: () => ({
    title: "Manhole ninjas",
    stage: "game-1",
    segment: 0,
    characters: ["sarge"],
  }),
};

export default environmentalSpawnModule;
