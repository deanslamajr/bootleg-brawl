// Auto-scroll: the camera moves on its own (the manhole-cover surf, conveyor floors, train
// roofs). Scroll locks still engage; floating debris must be jumped.

import { z } from "zod";
import {
  defaultSegmentController,
  intToFx,
  toFx,
  VIEW_W,
  type MechanicModule,
  type SegmentController,
  type Sim,
} from "@bb/engine";

const autoScrollFragment = z.strictObject({
  speed: z.number().positive(),
  /** Players ride manhole covers (render hint). */
  surf: z.boolean().default(false),
  pauseAtLocks: z.boolean().default(true),
  /** Segment x positions where debris floats in from the right. */
  hazards: z.array(z.strictObject({ x: z.number(), y: z.number() })).default([]),
});
type AutoScroll = z.infer<typeof autoScrollFragment>;

function cfg(sim: Sim): AutoScroll {
  return (sim.segment() as unknown as { autoScroll: AutoScroll }).autoScroll;
}

function controller(base: () => SegmentController): () => SegmentController {
  return () => {
    const inner = base();
    return {
      start(sim) {
        inner.start(sim);
        sim.g.flags.camControlled = 1;
        sim.g.flags.surf = cfg(sim).surf ? 1 : 0;
        sim.g.flags.hazardIdx = 0;
      },
      tick(sim) {
        const g = sim.g;
        const a = cfg(sim);
        const end = intToFx(Math.max(0, g.segLen - VIEW_W));
        if (!(a.pauseAtLocks && g.lockActive)) {
          g.camX = Math.min(end, g.camX + toFx(a.speed));
          const next = sim.segment().scrollLocks[g.lockIdx];
          if (next && g.camX > intToFx(next.at)) g.camX = intToFx(next.at);
          g.camMinX = g.camX;
        }
        const hi = g.flags.hazardIdx ?? 0;
        const h = a.hazards[hi];
        if (h && g.camX + intToFx(VIEW_W) >= intToFx(h.x)) {
          g.flags.hazardIdx = hi + 1;
          const def = sim.content.defIndex["proj:debris"];
          if (def !== undefined)
            sim.spawnProjectile(
              def,
              -1,
              g.camX + intToFx(VIEW_W + 20),
              intToFx(h.y),
              0,
              -toFx(2.4 + a.speed),
              0,
              -1,
            );
          sim.text("DEBRIS! JUMP!", "pop", -1, 60);
        }
        return inner.tick(sim);
      },
    };
  };
}

export const autoScrollModule: MechanicModule = {
  id: "auto-scroll",
  version: 1,
  flag: "mech.autoScroll",
  defaultOn: true,
  schema: { segment: { autoScroll: autoScrollFragment.optional() } },
  segmentControllers: { autoScroll: controller(defaultSegmentController) },
  sandboxScene: () => ({
    title: "Manhole surf",
    stage: "game-1",
    segment: 1,
    characters: ["brat", "mensa"],
  }),
};

export default autoScrollModule;
