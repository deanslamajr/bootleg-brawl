// Elevator fights: the platform climbs between floors; each floor stops for its waves.
// The camera stays put and the background scrolls vertically through camY.

import { z } from "zod";
import { toFx, type MechanicModule, type Sim, type SegmentController } from "@bb/engine";
import { wave } from "@bb/schema";

const elevatorFragment = z.strictObject({
  floors: z.array(z.strictObject({ label: z.string(), waves: z.array(wave).min(1) })).min(1),
  /** Background scroll speed while travelling, px/tick. */
  speed: z.number().positive().default(1.5),
  travelTicks: z.number().int().positive().default(150),
});
type ElevatorConfig = z.infer<typeof elevatorFragment>;

function config(sim: Sim): ElevatorConfig {
  return (sim.segment() as unknown as { elevator: ElevatorConfig }).elevator;
}

function controller(): SegmentController {
  return {
    start(sim) {
      const g = sim.g;
      g.flags.camControlled = 1;
      g.camX = 0;
      g.camMaxX = 0;
      g.flags.elevFloor = 0;
      g.flags.elevFighting = 0;
      g.flags.elevTimer = config(sim).travelTicks;
    },
    tick(sim) {
      const g = sim.g;
      const cfg = config(sim);
      if (!g.flags.elevFighting) {
        g.camY += toFx(cfg.speed);
        g.flags.elevTimer = (g.flags.elevTimer ?? 0) - 1;
        if ((g.flags.elevTimer ?? 0) <= 0) {
          const floor = cfg.floors[g.flags.elevFloor ?? 0]!;
          sim.text(floor.label, "banner", -1, 150);
          sim.sfx("go");
          for (const w of floor.waves) sim.queueWave(w, 30);
          g.flags.elevFighting = 1;
          g.lockActive = 1;
        }
        return false;
      }
      if (g.pending.length === 0 && sim.livingEnemies(true) === 0) {
        g.flags.elevFighting = 0;
        g.lockActive = 0;
        g.flags.elevFloor = (g.flags.elevFloor ?? 0) + 1;
        g.flags.elevTimer = cfg.travelTicks;
        if ((g.flags.elevFloor ?? 0) >= cfg.floors.length) return true;
        sim.emit({ t: "go" });
      }
      return false;
    },
  };
}

export const elevatorModule: MechanicModule = {
  id: "elevator",
  version: 1,
  flag: "mech.elevator",
  defaultOn: true,
  schema: { segment: { elevator: elevatorFragment.optional() } },
  segmentControllers: { elevator: controller },
  sandboxScene: () => ({
    title: "Elevator fight",
    stage: "game-2",
    segment: 3,
    characters: ["boomer", "brat"],
  }),
};

export default elevatorModule;
