import { describe, expect, it } from "vitest";
// The render index loads Pixi, so import the placement module directly.
import { BUBBLE_MARGIN, TAIL_INSET, placeBubble } from "../src/render/bubble";
import { VIEW_W } from "../src/sim/types";

const CAM = 1200;

describe("speech bubble placement", () => {
  it("starts the box 8 px left of a speaker mid-screen", () => {
    const p = placeBubble(CAM + 240, CAM, 126);
    expect(p).toEqual({ boxX: CAM + 232, tailX: CAM + 240, flip: false });
  });

  it("keeps the tail on a speaker near the right edge", () => {
    // The reported case: before the fix the tail stopped at screen x 478 - boxW.
    const p = placeBubble(CAM + 400, CAM, 126);
    expect(p.tailX).toBe(CAM + 400);
    expect(p.boxX + 126).toBe(CAM + VIEW_W - BUBBLE_MARGIN);
  });

  it("keeps the tail on every on-screen speaker and the box on screen", () => {
    for (let outerW = 20; outerW <= 164; outerW += 4)
      for (let x = 12; x <= VIEW_W - 12; x++) {
        const p = placeBubble(CAM + x, CAM, outerW);
        expect(p.tailX, `x ${x} w ${outerW}`).toBe(CAM + x);
        expect(p.boxX).toBeGreaterThanOrEqual(CAM + BUBBLE_MARGIN);
        expect(p.boxX + outerW).toBeLessThanOrEqual(CAM + VIEW_W - BUBBLE_MARGIN);
      }
  });

  it("points the tail toward a speaker off screen", () => {
    const left = placeBubble(CAM - 40, CAM, 90);
    expect(left.boxX).toBe(CAM + BUBBLE_MARGIN);
    expect(left.tailX).toBe(left.boxX + TAIL_INSET);
    expect(left.flip).toBe(false);
    const right = placeBubble(CAM + 520, CAM, 90);
    expect(right.boxX + 90).toBe(CAM + VIEW_W - BUBBLE_MARGIN);
    expect(right.tailX).toBe(right.boxX + 90 - TAIL_INSET);
    expect(right.flip).toBe(true);
  });

  it("flips the tail only in the right half of the box", () => {
    const p = placeBubble(CAM + 460, CAM, 120);
    const box = p.boxX;
    expect(placeBubble(box + 40, CAM, 120).flip).toBe(false);
    expect(placeBubble(box + 80, CAM, 120).flip).toBe(true);
  });

  it("returns whole pixels for a fractional camera", () => {
    for (const x of [-30.4, 6.5, 240.49, 470.51, 530.2]) {
      const p = placeBubble(1234.6 + x, 1234.6, 101);
      expect(Number.isInteger(p.boxX), `boxX at ${x}`).toBe(true);
      expect(Number.isInteger(p.tailX), `tailX at ${x}`).toBe(true);
    }
  });
});
