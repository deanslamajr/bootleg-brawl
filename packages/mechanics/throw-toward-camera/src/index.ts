// Throw toward the camera: down + attack while holding an enemy hurls it at the screen.
// It grows as it flies, smacks the glass for big damage and drops where it was.

import { F, FX, IN, CMD, SK, intToFx, toFx, type MechanicModule, type Sim } from "@bb/engine";

const FLY_TICKS = 32;

function allowed(sim: Sim): boolean {
  return (
    sim.stage.rules.requires.includes("throw-toward-camera") || (sim.g.flags.throwCam ?? 0) > 0
  );
}

export const throwTowardCameraModule: MechanicModule = {
  id: "throw-toward-camera",
  version: 1,
  flag: "mech.throwCam",
  defaultOn: true,
  components: [{ name: "camFly", type: "u16" }],
  hooks: {
    onCommands(sim, e, pressed, held) {
      if (!allowed(sim)) return;
      if (sim.stateKind(e) !== SK.grab) return;
      if (pressed & IN.ATTACK && held & IN.DOWN) {
        sim.c.cmd[e] = (sim.c.cmd[e]! & ~(CMD.grabHit | CMD.throwF | CMD.throwB)) | CMD.throwCam;
      }
    },
    onRelease(sim, grabber, victim, stateName) {
      if (stateName !== "throwCam") return false;
      const c = sim.c;
      c.grab[grabber] = 0;
      c.grab[victim] = 0;
      const d = sim.def(victim);
      sim.enterState(
        victim,
        d.S.camFly >= 0 ? d.S.camFly : d.S.thrown >= 0 ? d.S.thrown : d.S.fall,
      );
      c.flags[victim]! |= F.camFly | F.noGravity | F.invulnerable;
      c.owner[victim] = grabber + 1;
      sim.world.get<Uint16Array>("camFly")[victim] = 1;
      c.vx[victim] = 0;
      c.vz[victim] = 0;
      sim.sfx("throw", grabber);
      sim.text("AT THE SCREEN!", "pop", grabber, 50);
      return true;
    },
  },
  systems: [
    {
      phase: "movement",
      order: 20,
      name: "camFly",
      run(sim) {
        const c = sim.c;
        const fly = sim.world.get<Uint16Array>("camFly");
        for (let e = 0; e < sim.world.high; e++) {
          if (!sim.world.alive[e] || !fly[e]) continue;
          fly[e] = fly[e]! + 1;
          c.z[e] = c.z[e]! + toFx(1.4);
          if (fly[e] === FLY_TICKS) {
            const owner = c.owner[e]! - 1;
            const dmg = 30;
            c.hp[e] = Math.max(0, c.hp[e]! - dmg);
            sim.emit({
              t: "crack",
              x: (c.x[e]! - sim.g.camX) / FX,
              y: c.y[e]! / FX - c.z[e]! / FX - 30,
            });
            sim.emit({ t: "shake", ticks: 14 });
            sim.sfx("slam", e);
            sim.text("SMASH!", "big", e, 60);
            if (owner >= 0 && sim.world.alive[owner]) sim.addScore(owner, 300);
            if (c.hp[e] === 0) sim.emit({ t: "ko", ent: e, def: c.def[e]!, player: false });
            fly[e] = 0;
            c.flags[e]! &= ~(F.camFly | F.noGravity | F.invulnerable);
            c.owner[e] = 0;
            c.vz[e] = 0;
            c.z[e] = Math.min(c.z[e]!, intToFx(30));
            const d = sim.def(e);
            sim.enterState(e, d.S.fall >= 0 ? d.S.fall : d.S.idle);
          }
        }
      },
    },
  ],
  sandboxScene: () => ({
    title: "Throw toward the camera",
    stage: "game-1",
    segment: 3,
    characters: ["boomer"],
    dummies: [{ family: "shoe-clan", tier: 0, x: 260, y: 220 }],
  }),
};

export default throwTowardCameraModule;
