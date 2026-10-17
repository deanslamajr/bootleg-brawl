// Determinism gate: every golden replay must reproduce its recorded state hashes exactly.
// A failure means sim behavior changed; re-record with `pnpm tools record-golden` and say why.

import { describe, expect, it } from "vitest";
import { loadGoldens, verify } from "../../packages/tools/src/lib/golden";

describe("golden replays", () => {
  const goldens = loadGoldens();
  it("exist for every character, stage and the 4-player chaos session", () => {
    expect(goldens.some((g) => g.kind === "chaos")).toBe(true);
    expect(goldens.filter((g) => g.kind === "character").length).toBeGreaterThanOrEqual(4);
    expect(goldens.filter((g) => g.kind === "stage").length).toBeGreaterThanOrEqual(3);
  });
  for (const g of goldens) {
    it(g.name, () => {
      const r = verify(g);
      expect(r.ok, r.message).toBe(true);
    });
  }
});
