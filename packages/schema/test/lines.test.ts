import { describe, expect, it } from "vitest";
import {
  expandAll,
  expandLine,
  expansionCount,
  ForbiddenScanner,
  lineProblems,
  stageLinesFile,
} from "../src";

describe("line braces", () => {
  it("expands every combination in order", () => {
    expect(expandAll("A {B|C} D {E|F}")).toEqual(["A B D E", "A B D F", "A C D E", "A C D F"]);
    expect(expandAll("PLAIN")).toEqual(["PLAIN"]);
    expect(expansionCount("{A|B|C}{D|E}")).toBe(6);
    expect(expandLine("{A|B|C}!", () => 2)).toBe("C!");
  });
  it("reports unbalanced, nested and empty braces and too many combinations", () => {
    expect(lineProblems("FINE {A|B}")).toEqual([]);
    expect(lineProblems("BAD {A|B")).toEqual(["braces are unbalanced or nested"]);
    expect(lineProblems("BAD {A|{B|C}}")).toEqual(["braces are unbalanced or nested"]);
    expect(lineProblems("BAD {A|}")).toEqual(["a brace holds an empty choice"]);
    expect(lineProblems("{A|B}{A|B}{A|B}{A|B}{A|B}{A|B}{A|B}")).toEqual([
      "expands to more than 64 lines",
    ]);
  });
  it("finds a forbidden term that only two choices make together", () => {
    const scanner = new ForbiddenScanner(["blue cat"]);
    expect(
      scanner.scanDoc({ ko: ["{RED|BLUE} {DOG|CAT}"] }, "lines.json").map((h) => h.term),
    ).toEqual(["blue cat"]);
  });
  it("keeps the announcer pairs the same length", () => {
    const ok = stageLinesFile.safeParse({
      schemaVersion: 1,
      announcer: ["A"],
      announcerFix: ["B"],
    });
    expect(ok.success).toBe(true);
    const bad = stageLinesFile.safeParse({
      schemaVersion: 1,
      announcer: ["A", "B"],
      announcerFix: ["C"],
    });
    expect(bad.success).toBe(false);
  });
});
