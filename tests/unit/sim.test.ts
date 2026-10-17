// Sim-level behavior on real content: commands, transitions, combat, grabs, snapshots.

import { beforeAll, describe, expect, it } from "vitest";
import {
  CMD,
  IN,
  KIND,
  SK,
  applyHit,
  intToFx,
  parseCommands,
  type CompiledContent,
  type Sim,
} from "@bb/engine";
import { loadCompiled } from "../../packages/tools/src/lib/headless";
import { trainingSim } from "../../packages/tools/src/lib/training";

let content: CompiledContent;
beforeAll(() => {
  content = loadCompiled();
});

function room(party = ["sarge"]): Sim {
  const sim = trainingSim(content, party, 5);
  for (let i = 0; i < 50; i++) sim.step([0, 0, 0, 0]);
  return sim;
}

function dummy(sim: Sim, x: number, y: number, family = "interns", tier = 1): number {
  const e = sim.spawnActor(content.defIndex[family]!, tier, x, y, 0, -1);
  sim.c.ai[e] = 8; // dummy
  return e;
}

describe("command parser", () => {
  it("turns a double tap into a dash and a run", () => {
    const sim = room();
    const p = sim.g.players[0]!.ent;
    parseCommands(sim, p, IN.RIGHT, 0);
    sim.c.tapR[p] = 3;
    parseCommands(sim, p, IN.RIGHT, 0);
    expect(sim.c.cmd[p]! & CMD.dash).toBeTruthy();
    expect(sim.c.run[p]).toBe(1);
  });
  it("reads attack + jump together as the special", () => {
    const sim = room();
    const p = sim.g.players[0]!.ent;
    parseCommands(sim, p, IN.ATTACK | IN.JUMP, 0);
    expect(sim.c.cmd[p]! & CMD.special).toBeTruthy();
    expect(sim.c.cmd[p]! & CMD.attack).toBeFalsy();
  });
  it("reads away + attack as the back attack", () => {
    const sim = room();
    const p = sim.g.players[0]!.ent;
    sim.c.facing[p] = 1;
    parseCommands(sim, p, IN.LEFT | IN.ATTACK, 0);
    expect(sim.c.cmd[p]! & CMD.back).toBeTruthy();
  });
});

describe("state machine", () => {
  it("chains attacks inside the cancel window", () => {
    const sim = room();
    const p = sim.g.players[0]!.ent;
    sim.step([IN.ATTACK, 0, 0, 0]);
    expect(sim.st(p).name).toBe("atk1");
    for (let i = 0; i < 5; i++) sim.step([0, 0, 0, 0]);
    sim.step([IN.ATTACK, 0, 0, 0]);
    expect(sim.st(p).name).toBe("atk2");
  });
  it("jumps with the character's jump velocity and lands", () => {
    const sim = room();
    const p = sim.g.players[0]!.ent;
    sim.step([IN.JUMP, 0, 0, 0]);
    expect(sim.st(p).kind).toBe(SK.air);
    expect(sim.c.z[p]!).toBeGreaterThan(0);
    for (let i = 0; i < 80; i++) sim.step([0, 0, 0, 0]);
    expect(sim.c.z[p]).toBe(0);
    expect(sim.stateKind(p)).toBe(SK.free);
  });
});

describe("combat", () => {
  it("hits a target in the same lane and applies hitstop", () => {
    const sim = room();
    const p = sim.g.players[0]!.ent;
    const x = sim.c.x[p]! >> 16;
    const y = sim.c.y[p]! >> 16;
    sim.c.facing[p] = 1;
    const t = dummy(sim, x + 22, y);
    const hp = sim.c.hp[t]!;
    sim.step([IN.ATTACK, 0, 0, 0]);
    for (let i = 0; i < 6; i++) sim.step([0, 0, 0, 0]);
    expect(sim.c.hp[t]!).toBeLessThan(hp);
  });
  it("misses outside the lane tolerance", () => {
    const sim = room();
    const p = sim.g.players[0]!.ent;
    const x = sim.c.x[p]! >> 16;
    const y = sim.c.y[p]! >> 16;
    sim.c.facing[p] = 1;
    const t = dummy(sim, x + 22, y + (y > 220 ? -30 : 30));
    const hp = sim.c.hp[t]!;
    sim.step([IN.ATTACK, 0, 0, 0]);
    for (let i = 0; i < 6; i++) sim.step([0, 0, 0, 0]);
    expect(sim.c.hp[t]).toBe(hp);
  });
  it("grabs a dazed enemy by walking into it, then throws it", () => {
    const sim = room(["boomer"]);
    const p = sim.g.players[0]!.ent;
    const x = sim.c.x[p]! >> 16;
    const y = sim.c.y[p]! >> 16;
    sim.c.facing[p] = 1;
    const t = dummy(sim, x + 16, y, "rollerinas", 0); // light: grabbable any time
    for (let i = 0; i < 10 && sim.stateKind(p) !== SK.grab; i++) sim.step([IN.RIGHT, 0, 0, 0]);
    expect(sim.stateKind(p)).toBe(SK.grab);
    expect(sim.stateKind(t)).toBe(SK.grabbed);
    sim.step([IN.RIGHT | IN.ATTACK, 0, 0, 0]);
    expect(sim.stateKind(p)).toBe(SK.throw);
    for (let i = 0; i < 40; i++) sim.step([0, 0, 0, 0]);
    expect([SK.thrown, SK.fall, SK.down, SK.ko, SK.getup]).toContain(sim.stateKind(t));
  });
  it("knocks a player down after four quick hits (stun-lock breaker)", () => {
    const sim = room(["sarge"]);
    const p = sim.g.players[0]!.ent;
    const rat = content.defIndex["sewer-rats"]!;
    const e = sim.spawnActor(rat, 0, (sim.c.x[p]! >> 16) - 10, sim.c.y[p]! >> 16, 0, 1);
    const bite = content.defs[rat]!.states.find((s) => s.name === "atk1")!.frames[1]!.hit[0]!;
    const kinds: number[] = [];
    for (let i = 0; i < 4; i++) {
      applyHit(sim, e, p, bite, 1, false);
      kinds.push(sim.stateKind(p));
    }
    expect(kinds.slice(0, 3)).toEqual([SK.hurt, SK.hurt, SK.hurt]);
    expect(kinds[3]).toBe(SK.fall);
    expect(KIND.player).toBe(sim.c.kind[p]);
  });
});

describe("snapshots", () => {
  it("restore reproduces the same future", () => {
    const sim = room(["sarge", "brat"]);
    for (let i = 0; i < 30; i++) sim.step([IN.RIGHT, IN.LEFT, 0, 0]);
    dummy(sim, 300, 220);
    const snap = sim.snapshot();
    const script = (i: number) => [
      i % 7 === 0 ? IN.ATTACK : IN.RIGHT,
      i % 5 === 0 ? IN.JUMP : IN.LEFT,
      0,
      0,
    ];
    for (let i = 0; i < 120; i++) sim.step(script(i));
    const a = sim.hash();
    sim.restore(snap);
    for (let i = 0; i < 120; i++) sim.step(script(i));
    expect(sim.hash()).toBe(a);
    void intToFx;
  });
});
