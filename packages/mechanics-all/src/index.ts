// Every mechanic module in the repo, registered in a fixed order. Feature flags decide which
// ones a build runs; content requiring a flagged-off module fails validation.

import { ModuleRegistry, type MechanicModule } from "@bb/engine";
import { elevatorModule } from "@bb/mech-elevator";
import { autoScrollModule } from "@bb/mech-auto-scroll";
import { throwTowardCameraModule } from "@bb/mech-throw-toward-camera";
import { environmentalSpawnModule } from "@bb/mech-environmental-spawn";
import { civiliansModule } from "@bb/mech-civilians";
import { chargeShotModule } from "@bb/mech-charge-shot";
import { arenaModule } from "@bb/mech-arena";

export const ALL_MODULES: MechanicModule[] = [
  arenaModule,
  autoScrollModule,
  chargeShotModule,
  civiliansModule,
  elevatorModule,
  environmentalSpawnModule,
  throwTowardCameraModule,
];

export function createRegistry(flags: readonly string[] = []): ModuleRegistry {
  const r = new ModuleRegistry();
  for (const m of ALL_MODULES) r.register(m);
  r.setFlags(flags);
  return r;
}
