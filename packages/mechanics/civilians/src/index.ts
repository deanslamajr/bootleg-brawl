// Civilians: bystanders wander, panic when a fight comes near, cost points when hit, and drop
// food when rescued from an enemy that grabbed them.

import { F, FX, KIND, SK, TEAM, startGrab, type MechanicModule, type Sim } from "@bb/engine";

function nearestEnemy(sim: Sim, e: number): number {
  const c = sim.c;
  let best = -1;
  let bestD = Infinity;
  for (let o = 0; o < sim.world.high; o++) {
    if (!sim.world.alive[o]) continue;
    const k = c.kind[o];
    if (k !== KIND.enemy && k !== KIND.boss) continue;
    if (c.flags[o]! & F.unfightable) continue;
    const d = Math.abs(c.x[o]! - c.x[e]!) + 2 * Math.abs(c.y[o]! - c.y[e]!);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function civilianAi(sim: Sim, e: number): void {
  const c = sim.c;
  const d = sim.def(e);
  if (sim.stateKind(e) !== SK.free) {
    c.mx[e] = 0;
    c.my[e] = 0;
    return;
  }
  const enemy = nearestEnemy(sim, e);
  const panicId = d.stateIndex.panic ?? -1;
  if (enemy >= 0) {
    const dx = (c.x[enemy]! - c.x[e]!) / FX;
    const dy = (c.y[enemy]! - c.y[e]!) / FX;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist < 110) {
      // Grabbers sometimes harass a bystander, which sets up a rescue.
      const ek = sim.def(enemy).enemy;
      if (
        dist < 22 &&
        ek?.ai === "grabber" &&
        sim.stateKind(enemy) === SK.free &&
        sim.rng.chance(2)
      ) {
        startGrab(sim, enemy, e);
        sim.g.flags[`harassed:${e}`] = 1;
        sim.text("HELP! HELP-ISH!", "bubble", e, 90);
        return;
      }
      if (panicId >= 0 && sim.st(e).id !== panicId) sim.enterState(e, panicId);
      c.mx[e] = dx > 0 ? -1 : 1;
      c.my[e] = dy > 0 ? -1 : 1;
      c.facing[e] = c.mx[e]!;
      return;
    }
  }
  if (panicId >= 0 && sim.st(e).id === panicId) sim.enterState(e, d.S.idle);
  // Amble about.
  if ((sim.g.tick + e * 37) % 120 === 0) {
    const r = sim.rng.int(5);
    c.mx[e] = r === 0 ? -1 : r === 1 ? 1 : 0;
    c.my[e] = r === 2 ? -1 : r === 3 ? 1 : 0;
    if (c.mx[e] !== 0) c.facing[e] = c.mx[e]!;
  }
}

export const civiliansModule: MechanicModule = {
  id: "civilians",
  version: 1,
  flag: "mech.civilians",
  defaultOn: true,
  aiKinds: { civilian: civilianAi },
  hooks: {
    onHit(sim, attacker, target) {
      const c = sim.c;
      if (!(c.flags[target]! & F.civilian)) return false;
      const d = sim.def(target);
      const penalty = d.enemy?.civilian?.penalty ?? -100;
      const scorer = c.kind[attacker] === KIND.projectile ? c.owner[attacker]! - 1 : attacker;
      if (scorer >= 0 && c.team[scorer] === TEAM.players) {
        sim.addScore(scorer, penalty);
        sim.text(`${penalty} PTS. THAT WAS A NEIGHBOR.`, "pop", target, 70);
      }
      return false;
    },
  },
  systems: [
    {
      phase: "state",
      order: 70,
      name: "rescue",
      run(sim) {
        const c = sim.c;
        for (const key of Object.keys(sim.g.flags)) {
          if (!key.startsWith("harassed:")) continue;
          const e = Number(key.slice(9));
          if (!sim.world.alive[e]) {
            delete sim.g.flags[key];
            continue;
          }
          if (sim.stateKind(e) === SK.grabbed) continue;
          delete sim.g.flags[key];
          const drop = sim.def(e).enemy?.civilian?.rescueDrop ?? -1;
          if (drop >= 0) sim.spawnPickup(drop, c.x[e]!, c.y[e]! + 1, 12 * FX, 0, 2 * FX);
          sim.text("MY HERO! HAVE A SNACK.", "bubble", e, 90);
          sim.addScore(e, 0);
        }
      },
    },
  ],
  sandboxScene: () => ({ title: "Bystanders", stage: "game-0", segment: 0, characters: ["sarge"] }),
};

export default civiliansModule;
