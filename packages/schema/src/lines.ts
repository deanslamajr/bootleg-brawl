// Dialogue pools (DECISIONS D80). A `lines.json` next to a character, enemy, boss or stage holds
// pools of lines. The sim names a pool and the game screen picks the line, so a line never moves
// the sim. A line can hold alternatives in braces: "MY {SPLEEN|LANYARD}!" shows one of the two.

import { z } from "zod";
import { schemaVersion } from "./common";

/** The most combinations one line may expand to. */
export const MAX_EXPANSIONS = 64;

const BRACES = /\{([^{}]*)\}/g;

/** Problems with a line's braces: unbalanced or nested braces, an empty choice, too many combos. */
export function lineProblems(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const ch of line) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0 || depth > 1) {
      out.push("braces are unbalanced or nested");
      return out;
    }
  }
  if (depth !== 0) out.push("braces are unbalanced or nested");
  else {
    for (const m of line.matchAll(BRACES))
      if (m[1]!.split("|").some((c) => !c.trim())) out.push("a brace holds an empty choice");
    if (expansionCount(line) > MAX_EXPANSIONS)
      out.push(`expands to more than ${MAX_EXPANSIONS} lines`);
  }
  return out;
}

/** How many lines a template expands to. */
export function expansionCount(line: string): number {
  let n = 1;
  for (const m of line.matchAll(BRACES)) n *= m[1]!.split("|").length;
  return n;
}

/** One expansion: `choose(k)` returns an index below k for each brace, left to right. */
export function expandLine(line: string, choose: (k: number) => number): string {
  return line.replace(BRACES, (_m, body: string) => {
    const choices = body.split("|");
    return choices[Math.min(choices.length - 1, Math.max(0, choose(choices.length)))]!;
  });
}

/** Every expansion, for the forbidden-terms scan. Stops at MAX_EXPANSIONS. */
export function expandAll(line: string): string[] {
  const groups = [...line.matchAll(BRACES)].map((m) => m[1]!.split("|"));
  if (!groups.length) return [line];
  const out: string[] = [];
  const idx = groups.map(() => 0);
  for (;;) {
    let i = 0;
    out.push(line.replace(BRACES, () => groups[i]![idx[i++]!]!));
    if (out.length >= MAX_EXPANSIONS) return out;
    let g = groups.length - 1;
    while (g >= 0 && ++idx[g]! >= groups[g]!.length) idx[g--] = 0;
    if (g < 0) return out;
  }
}

const pool = z.array(z.string().min(1)).default([]);

/** content/characters/<id>/lines.json. The fields in character.json come first in each pool. */
export const characterLinesFile = z.strictObject({
  schemaVersion,
  taunt: pool,
  continue: pool,
  ending: pool,
  select: pool,
});

/** content/enemies/<id>/lines.json. `help` and `rescue` are for civilians. */
export const enemyLinesFile = z.strictObject({
  schemaVersion,
  ko: pool,
  spawn: pool,
  help: pool,
  rescue: pool,
});

/** content/bosses/<id>/lines.json. `pattern` is spoken by every pattern step that has a `line`. */
export const bossLinesFile = z.strictObject({
  schemaVersion,
  pattern: pool,
  hurt: pool,
  defeat: pool,
  card: pool,
  phase: pool,
  defeatBanner: pool,
});

/**
 * content/stages/<id>/lines.json. `announcer` and `announcerFix` are pairs: the title card shows
 * the announcer's line and then Mensa's correction at the same index.
 */
export const stageLinesFile = z
  .strictObject({
    schemaVersion,
    costume: pool,
    bulletin: pool,
    outro: pool,
    outroBanner: pool,
    announcer: pool,
    announcerFix: pool,
  })
  .refine((f) => f.announcer.length === f.announcerFix.length, {
    message: "announcer and announcerFix must have the same length",
    path: ["announcerFix"],
  });

export type CharacterLinesFile = z.infer<typeof characterLinesFile>;
export type EnemyLinesFile = z.infer<typeof enemyLinesFile>;
export type BossLinesFile = z.infer<typeof bossLinesFile>;
export type StageLinesFile = z.infer<typeof stageLinesFile>;
/** A lines.json as the loader keeps it: pool name to lines. */
export type LinePools = Record<string, string[]>;
