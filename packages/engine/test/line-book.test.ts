import { describe, expect, it } from "vitest";
import { speechSettings } from "@bb/schema";
import { LineBook, SpeechGate, type LineStore } from "../src/render/line-book";
import type { CLinePool } from "../src/content/types";

/** A seeded stand-in for Math.random, so the tests are repeatable. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const pool = (lines: string[], key = "enemy/interns/ko"): CLinePool => ({ key, role: "ko", lines });

describe("line book", () => {
  it("shows every line once before any line comes back, and never the last one first", () => {
    const book = new LineBook(undefined, seeded(1));
    const p = pool(["A", "B", "C", "D", "E"]);
    for (let round = 0; round < 20; round++) {
      const shown = Array.from({ length: 5 }, () => book.pick(p)!);
      expect(new Set(shown).size).toBe(5);
      const next = book.pick(p);
      expect(next).not.toBe(shown[4]);
      // Put the extra pick back into the next round's count.
      expect(book.unseen(p)).toBe(4);
      for (let i = 0; i < 4; i++) book.pick(p);
    }
  });

  it("remembers the seen lines across books through its store", () => {
    let saved: string | null = null;
    const store: LineStore = { load: () => saved, save: (d) => (saved = d) };
    const p = pool(["A", "B", "C"]);
    const first = new LineBook(store, seeded(2));
    const a = first.pick(p);
    const b = first.pick(p);
    const second = new LineBook(store, seeded(3));
    expect(second.unseen(p)).toBe(1);
    expect([a, b]).not.toContain(second.pick(p));
  });

  it("counts a new line as unseen after the pool grows", () => {
    const book = new LineBook(undefined, seeded(4));
    book.pick(pool(["A", "B"]));
    book.pick(pool(["A", "B"]));
    expect(book.pick(pool(["A", "B", "NEW"]))).toBe("NEW");
  });

  it("expands braces and keeps pairs together", () => {
    const book = new LineBook(undefined, seeded(5));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(book.pick(pool(["MY {SPLEEN|LANYARD}!"]))!);
    expect([...seen].sort()).toEqual(["MY LANYARD!", "MY SPLEEN!"]);
    const pair: CLinePool = {
      key: "stage/x/announcer",
      role: "announcer",
      lines: ["GOOD LUCKY", "HELO"],
      pair: ["GOOD LUCK", ""],
    };
    const picks = [book.pickPair(pair)!, book.pickPair(pair)!].sort();
    expect(picks).toEqual([
      ["GOOD LUCKY", "GOOD LUCK"],
      ["HELO", ""],
    ]);
  });

  it("survives a store that throws", () => {
    const store: LineStore = {
      load: () => {
        throw new Error("blocked");
      },
      save: () => {
        throw new Error("full");
      },
    };
    const book = new LineBook(store, seeded(6));
    expect(book.pick(pool(["A"]))).toBe("A");
  });
});

describe("speech gate", () => {
  const s = speechSettings.parse({});
  it("shows KO lines at the chance and keeps the enemy gap", () => {
    const gate = new SpeechGate(s, seeded(7));
    let shown = 0;
    let last = -Infinity;
    for (let tick = 0; tick < 60 * 600; tick += 10)
      if (gate.allow("ko", tick)) {
        expect(tick - last).toBeGreaterThanOrEqual(s.enemyGapTicks);
        last = tick;
        shown++;
      }
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual((60 * 600) / s.enemyGapTicks);
  });
  it("never blocks player, stage or civilian lines", () => {
    const gate = new SpeechGate({ ...s, koChance: 0 }, seeded(8));
    for (const role of ["taunt", "costume", "help", "rescue", "pattern", "outro", "bulletin"])
      expect(gate.allow(role, 0)).toBe(true);
    expect(gate.allow("ko", 0)).toBe(false);
  });
});
