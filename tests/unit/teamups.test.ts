// Team-ups (two family pairs plus the generic shoulder toss) and the throw toward the camera.

import { beforeAll, describe, expect, it } from "vitest";
import { F, IN, SK, intToFx, type CompiledContent, type Sim } from "@bb/engine";
import { loadCompiled } from "../../packages/tools/src/lib/headless";
import { trainingSim } from "../../packages/tools/src/lib/training";

let content: CompiledContent;
beforeAll(() => {
  content = loadCompiled();
});

function pair(a: string, b: string): Sim {
  const sim = trainingSim(content, [a, b], 9);
  for (let i = 0; i < 50; i++) sim.step([0, 0, 0, 0]);
  const p0 = sim.g.players[0]!.ent;
  const p1 = sim.g.players[1]!.ent;
  sim.c.x[p1] = sim.c.x[p0]! + intToFx(10);
  sim.c.y[p1] = sim.c.y[p0]!;
  return sim;
}

describe("team-ups", () => {
  it("Boomer and Sarge: Suburban Suplex launches Sarge as a spinning attack", () => {
    const sim = pair("boomer", "sarge");
    const boomer = sim.g.players[0]!.ent;
    const sarge = sim.g.players[1]!.ent;
    sim.step([IN.TAUNT, 0, 0, 0]);
    expect(sim.st(boomer).name).toBe("teamSuplex");
    expect(sim.st(sarge).name).toBe("teamPartnerToss");
    let flew = false;
    for (let i = 0; i < 60; i++) {
      sim.step([0, 0, 0, 0]);
      if (sim.c.flags[sarge]! & F.teamFly) flew = true;
    }
    expect(flew).toBe(true);
  });
  it("either partner can start it (both directions)", () => {
    const sim = pair("sarge", "boomer");
    sim.step([IN.TAUNT, 0, 0, 0]);
    expect(sim.st(sim.g.players[1]!.ent).name).toBe("teamSuplex");
  });
  it("Brat and Mensa: Sibling Rivalry hides both inside a dust cloud", () => {
    const sim = pair("brat", "mensa");
    sim.step([IN.TAUNT, 0, 0, 0]);
    const cloud = content.defIndex["proj:dust-cloud"]!;
    let found = false;
    for (let e = 0; e < sim.world.high; e++)
      if (sim.world.alive[e] && sim.c.def[e] === cloud) found = true;
    expect(found).toBe(true);
    for (const p of [sim.g.players[0]!.ent, sim.g.players[1]!.ent])
      expect(sim.c.flags[p]! & F.hidden).toBeTruthy();
    for (let i = 0; i < 120; i++) sim.step([0, 0, 0, 0]);
    for (const p of [sim.g.players[0]!.ent, sim.g.players[1]!.ent])
      expect(sim.c.flags[p]! & F.hidden).toBe(0);
  });
  it("any other pair gets the generic shoulder toss", () => {
    const sim = pair("sarge", "brat");
    sim.step([IN.TAUNT, 0, 0, 0]);
    expect(sim.st(sim.g.players[0]!.ent).name).toBe("teamToss");
  });
});

describe("throw toward the camera", () => {
  it("down + attack while holding sends the enemy at the screen for big damage", () => {
    const sim = trainingSim(content, ["boomer"], 3);
    for (let i = 0; i < 50; i++) sim.step([0, 0, 0, 0]);
    sim.g.flags.throwCam = 1;
    const p = sim.g.players[0]!.ent;
    sim.c.facing[p] = 1;
    const t = sim.spawnActor(
      content.defIndex["rollerinas"]!,
      2,
      (sim.c.x[p]! >> 16) + 16,
      sim.c.y[p]! >> 16,
      0,
      -1,
    );
    sim.c.ai[t] = 8;
    for (let i = 0; i < 10 && sim.stateKind(p) !== SK.grab; i++) sim.step([IN.RIGHT, 0, 0, 0]);
    expect(sim.stateKind(p)).toBe(SK.grab);
    const hp = sim.c.hp[t]!;
    sim.step([IN.DOWN | IN.ATTACK, 0, 0, 0]);
    expect(sim.st(p).name).toBe("throwCam");
    let cracked = false;
    for (let i = 0; i < 90; i++) {
      sim.step([0, 0, 0, 0]);
      if (sim.events.some((e) => e.t === "crack")) cracked = true;
    }
    expect(cracked).toBe(true);
    expect(sim.c.hp[t]!).toBeLessThan(hp - 20);
  });
});
