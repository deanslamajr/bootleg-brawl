// Hold-to-charge ranged shot. Characters opt in through kit.requires and configure it with
// kit.chargeShot. Holding attack in a free state charges; releasing fires the charged state.

import { z } from "zod";
import { CMD, KIND, SK, type MechanicModule, type Sim } from "@bb/engine";

const chargeShotFragment = z.strictObject({
  /** Looping state shown while charging. */
  state: z.string(),
  /** State entered on release; its projectile spawn is scaled by the charge level. */
  fire: z.string(),
  threshold: z.number().int().positive().default(24),
  maxLevel: z.number().int().min(1).max(5).default(3),
  levelTicks: z.number().int().positive().default(24),
});
type ChargeShot = z.infer<typeof chargeShotFragment>;

function kitOf(sim: Sim, e: number): ChargeShot | undefined {
  const p = sim.def(e).player;
  if (!p || !p.requires.includes("charge-shot")) return undefined;
  return p.kit.chargeShot as ChargeShot | undefined;
}

export const chargeShotModule: MechanicModule = {
  id: "charge-shot",
  version: 1,
  flag: "mech.chargeShot",
  defaultOn: true,
  components: [{ name: "charge", type: "u16" }],
  schema: { character: { chargeShot: chargeShotFragment.optional() } },
  hooks: {
    onCommands(sim, e, _pressed, held, released) {
      const k = kitOf(sim, e);
      if (!k) return;
      const charge = sim.world.get<Uint16Array>("charge");
      const c = sim.c;
      const d = sim.def(e);
      const chargeState = d.stateIndex[k.state] ?? -1;
      const fireState = d.stateIndex[k.fire] ?? -1;
      const inCharge = c.state[e] === chargeState;
      const free = sim.stateKind(e) === SK.free;
      if (held & 16 /* attack */) {
        if (free || inCharge) charge[e] = Math.min(0xffff, charge[e]! + 1);
        if (free && charge[e]! >= k.threshold && chargeState >= 0) {
          sim.enterState(e, chargeState);
          sim.sfx("charge", e);
        }
        if (inCharge) {
          const lvl = Math.min(
            k.maxLevel,
            1 + Math.floor((charge[e]! - k.threshold) / k.levelTicks),
          );
          if ((charge[e]! - k.threshold) % k.levelTicks === 0 && lvl > 1)
            sim.text(`CHARGE ${lvl}`, "pop", e, 30);
        }
      }
      if (released & 16) {
        if (inCharge && fireState >= 0) {
          const lvl = Math.min(
            k.maxLevel,
            1 + Math.floor((charge[e]! - k.threshold) / k.levelTicks),
          );
          sim.g.flags[`charge:${e}`] = lvl;
          sim.enterState(e, fireState);
          c.cmd[e] = c.cmd[e]! | CMD.chargeRelease;
        }
        charge[e] = 0;
      }
      if (!(held & 16)) charge[e] = 0;
    },
    onEntitySpawn(sim, e) {
      const c = sim.c;
      if (c.kind[e] !== KIND.projectile) return;
      const owner = c.owner[e]! - 1;
      if (owner < 0) return;
      const lvl = sim.g.flags[`charge:${owner}`];
      if (!lvl) return;
      c.scale[e] = Math.trunc((c.scale[e]! * (100 + 35 * (lvl - 1))) / 100);
      delete sim.g.flags[`charge:${owner}`];
    },
  },
  sandboxScene: () => ({
    title: "Charge shot",
    characters: ["mensa"],
    dummies: [{ family: "interns", tier: 1, x: 340, y: 220 }],
  }),
};

export default chargeShotModule;
