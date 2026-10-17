import { runBots } from "./lib/headless";
const r = runBots({
  stage: process.argv[2]!,
  party: process.argv[3]!.split(","),
  maxTicks: Number(process.argv[4]),
});
const sim = r.sim,
  c = sim.c;
for (let e = 0; e < sim.world.high; e++) {
  if (!sim.world.alive[e] || c.kind[e] === 5 || c.kind[e] === 6) continue;
  console.log(
    e,
    sim.def(e).id,
    "st",
    sim.st(e).name,
    "x",
    c.x[e]! >> 16,
    "y",
    c.y[e]! >> 16,
    "z",
    c.z[e]! >> 16,
    "hp",
    c.hp[e],
    "grab",
    c.grab[e],
    "tier",
    c.tier[e],
    "flags",
    c.flags[e],
    "mx",
    c.mx[e],
    "fac",
    c.facing[e],
  );
}
console.log(
  "cam",
  sim.g.camX >> 16,
  "lock",
  sim.g.lockActive,
  sim.g.lockIdx,
  "pending",
  sim.g.pending.length,
  "phase",
  sim.g.phase,
  "seg",
  sim.g.seg,
);
