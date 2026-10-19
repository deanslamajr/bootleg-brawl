// Line pools (D80): the compiler builds them, and the sim names a pool instead of picking text.

import { beforeAll, describe, expect, it } from "vitest";
import { IN, type CompiledContent, type SimEvent } from "@bb/engine";
import { loadCompiled, runBots } from "../../packages/tools/src/lib/headless";
import { trainingSim } from "../../packages/tools/src/lib/training";

let content: CompiledContent;
beforeAll(() => {
  content = loadCompiled();
});

const def = (id: string) => content.defs[content.defIndex[id]!]!;

describe("line pools", () => {
  it("put the lines from the main files first", () => {
    const sarge = def("sarge").player!;
    expect(content.lines[sarge.pools.taunt!]!.lines.slice(0, 3)).toEqual(
      content.raw.characters.sarge!.file.voice.tauntLines,
    );
    const help = content.lines[def("bystanders").enemy!.pools.help!]!;
    expect(help.key).toBe("enemy/bystanders/help");
    expect(help.lines).toContain("HELP! HELP-ISH!");
    const card = content.raw.stages["game-0"]!.file.titleCard;
    const announcer = content.lines[content.stagePools["game-0"]!.announcer!]!;
    expect([announcer.lines[0], announcer.pair![0]]).toEqual([
      card.announcerLine,
      card.announcerLineCorrected ?? "",
    ]);
  });

  it("give an empty pool index -1", () => {
    expect(def("sewer-rats").enemy!.pools.help).toBe(-1);
  });

  it("make a taunt name the taunt pool", () => {
    const sim = trainingSim(content, ["mensa"], 3);
    for (let i = 0; i < 50; i++) sim.step([0, 0, 0, 0]);
    sim.step([IN.TAUNT, 0, 0, 0]);
    const says = sim.events.filter((e): e is Extract<SimEvent, { t: "say" }> => e.t === "say");
    expect(says.map((e) => e.pool)).toEqual([def("mensa").player!.pools.taunt]);
  });

  it("leave the sim no spoken text of its own", () => {
    const bubbles = new Set<string>();
    let says = 0;
    runBots({
      stage: "game-0",
      party: ["sarge", "boomer"],
      seed: 1,
      maxTicks: 60 * 60 * 5,
      onTick(_sim, events) {
        for (const ev of events) {
          if (ev.t === "text" && ev.kind === "bubble") bubbles.add(ev.text);
          if (ev.t === "say") {
            says++;
            expect(content.lines[ev.pool]).toBeDefined();
          }
        }
      },
    });
    expect(says).toBeGreaterThan(20);
    expect([...bubbles]).toEqual(bubbles.size ? ["ZZZ"] : []);
  });
});
