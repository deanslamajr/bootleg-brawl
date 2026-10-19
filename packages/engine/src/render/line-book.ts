// Picks the line for a pool and remembers which lines the player saw (DECISIONS D80). The sim only
// names a pool, so this code may use Math.random and browser storage: a line never moves the sim.

import { expandLine, type SpeechSettings } from "@bb/schema";
import type { CLinePool } from "../content/types";

/** Where the seen-line memory lives. The game passes localStorage; tools and tests pass none. */
export interface LineStore {
  load(): string | null;
  save(data: string): void;
}

interface Saved {
  v: 1;
  seen: Record<string, number[]>;
  last: Record<string, number>;
}

/** FNV-1a over the line text, so a new or edited line counts as unseen. */
export function lineHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class LineBook {
  private readonly seen = new Map<string, Set<number>>();
  private readonly last = new Map<string, number>();

  constructor(
    private readonly store?: LineStore,
    private readonly random: () => number = Math.random,
  ) {
    try {
      const raw = store?.load();
      if (!raw) return;
      const d = JSON.parse(raw) as Saved;
      if (d.v !== 1) return;
      for (const [k, hs] of Object.entries(d.seen)) this.seen.set(k, new Set(hs));
      for (const [k, h] of Object.entries(d.last)) this.last.set(k, h);
    } catch {
      // Unreadable memory: start fresh.
    }
  }

  /** A random unseen line of the pool, with its braces expanded. */
  pick(pool: CLinePool | undefined): string | undefined {
    const i = pool ? this.pickIndex(pool) : -1;
    return i < 0 ? undefined : this.expand(pool!.lines[i]!);
  }

  /** A line and its partner at the same index ("" when the line has no partner). */
  pickPair(pool: CLinePool | undefined): [string, string] | undefined {
    const i = pool ? this.pickIndex(pool) : -1;
    if (i < 0) return undefined;
    const partner = pool!.pair?.[i] ?? "";
    return [this.expand(pool!.lines[i]!), partner ? this.expand(partner) : ""];
  }

  /** How many lines of the pool the player has not seen yet. */
  unseen(pool: CLinePool): number {
    const seen = this.seen.get(pool.key);
    return pool.lines.filter((l) => !seen?.has(lineHash(l))).length;
  }

  private pickIndex(pool: CLinePool): number {
    const n = pool.lines.length;
    if (!n) return -1;
    let seen = this.seen.get(pool.key);
    if (!seen) this.seen.set(pool.key, (seen = new Set()));
    const hashes = pool.lines.map(lineHash);
    let open = hashes.flatMap((h, i) => (seen.has(h) ? [] : [i]));
    if (!open.length) {
      // The player saw every line: start over, but not with the line shown last.
      seen.clear();
      const last = this.last.get(pool.key);
      open = hashes.flatMap((h, i) => (n > 1 && h === last ? [] : [i]));
    }
    const i = open[Math.min(open.length - 1, Math.floor(this.random() * open.length))]!;
    seen.add(hashes[i]!);
    this.last.set(pool.key, hashes[i]!);
    this.save();
    return i;
  }

  private expand(line: string): string {
    return expandLine(line, (k) => Math.min(k - 1, Math.floor(this.random() * k)));
  }

  private save(): void {
    if (!this.store) return;
    const d: Saved = {
      v: 1,
      seen: Object.fromEntries([...this.seen].map(([k, s]) => [k, [...s]])),
      last: Object.fromEntries(this.last),
    };
    try {
      this.store.save(JSON.stringify(d));
    } catch {
      // Storage full or blocked: the memory still lasts for this session.
    }
  }
}

/**
 * The chance and gap rules for sim `say` events (D80). A KO or spawn line shows at a chance and
 * not within the enemy gap of the last one; a boss hurt line the same with its own gap. Every
 * other line always shows. One gate lives for one stage, because ticks restart at each stage.
 */
export class SpeechGate {
  private nextEnemy = 0;
  private nextBoss = 0;

  constructor(
    private readonly s: SpeechSettings,
    private readonly random: () => number = Math.random,
  ) {}

  allow(role: string, tick: number): boolean {
    if (role === "ko" || role === "spawn") {
      if (tick < this.nextEnemy) return false;
      const chance = role === "ko" ? this.s.koChance : this.s.spawnChance;
      if (this.random() * 100 >= chance) return false;
      this.nextEnemy = tick + this.s.enemyGapTicks;
      return true;
    }
    if (role === "hurt") {
      if (tick < this.nextBoss) return false;
      if (this.random() * 100 >= this.s.bossHurtChance) return false;
      this.nextBoss = tick + this.s.bossGapTicks;
      return true;
    }
    return true;
  }
}

/** The browser's memory for a LineBook: one localStorage key, any failure ignored. */
export function localLineStore(key = "bb.lines.v1"): LineStore {
  return {
    load: () => {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save: (data) => {
      try {
        globalThis.localStorage?.setItem(key, data);
      } catch {
        // Ignored: see LineBook.save.
      }
    },
  };
}
