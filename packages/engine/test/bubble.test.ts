import { describe, expect, it } from "vitest";
// The render index loads Pixi, so import the placement module directly.
import {
  BORDER,
  BUBBLE_MARGIN,
  BUBBLE_TOP,
  DEFAULT_LIFT,
  HEAD_GAP,
  STACK_GAP,
  TAIL_H,
  TAIL_INSET,
  bubbleLift,
  bubbleTail,
  bubbleTop,
  placeBubble,
  stackBubble,
} from "../src/render/bubble";
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

describe("speech bubble height", () => {
  it("keeps the old height for a speaker without an idle sprite", () => {
    // Before D87 the box's outer top was h + 62 px over the feet, for an inner height h.
    const h = 20;
    expect(bubbleLift(0)).toBe(DEFAULT_LIFT);
    const y = bubbleTop(200, DEFAULT_LIFT, h + 4);
    expect(y).toBe(200 - (h + 62));
    expect(bubbleTail(200, DEFAULT_LIFT, y, h + 4)).toEqual({ tipY: 146, len: TAIL_H });
  });

  it("puts the tail tip just over the head of a tall speaker", () => {
    // The tallest idle frame of the tallest boss is 96 px.
    const lift = bubbleLift(96);
    const y = bubbleTop(220, lift, 30);
    const t = bubbleTail(220, lift, y, 30);
    expect(t.tipY).toBe(220 - 96 - HEAD_GAP);
    expect(t.len).toBe(TAIL_H);
    expect(y + 30 - BORDER + TAIL_H).toBe(t.tipY);
  });

  it("keeps the box under the HUD with the shortest tail", () => {
    const lift = bubbleLift(96);
    const y = bubbleTop(120, lift, 30);
    expect(y).toBe(BUBBLE_TOP);
    expect(bubbleTail(120, lift, y, 30)).toEqual({
      tipY: BUBBLE_TOP + 30 - BORDER + TAIL_H,
      len: TAIL_H,
    });
  });
});

describe("speech bubble stacking", () => {
  const box = (x: number, y: number, w = 100, h = 22) => ({ x, y, w, h });

  it("leaves a box that touches no other box", () => {
    expect(stackBubble(box(10, 120), [box(200, 120)])).toBe(120);
    expect(stackBubble(box(10, 120), [box(10, 60)])).toBe(120);
  });

  it("moves a newer box over an older one that it touches", () => {
    expect(stackBubble(box(40, 120), [box(10, 124)])).toBe(124 - STACK_GAP - 22);
  });

  it("climbs over a stack of boxes", () => {
    const placed = [box(10, 130), box(60, 130 - STACK_GAP - 22)];
    expect(stackBubble(box(30, 128), placed)).toBe(130 - 2 * (STACK_GAP + 22));
  });

  it("keeps its y and overlaps when the stack would rise into the HUD", () => {
    expect(stackBubble(box(40, 50), [box(10, 50)])).toBe(50);
  });

  it("stretches the tail of a stacked box down to its speaker", () => {
    const lift = bubbleLift(62);
    const y0 = bubbleTop(200, lift, 22);
    const y = stackBubble(box(40, y0), [box(10, y0)]);
    const t = bubbleTail(200, lift, y, 22);
    expect(t.tipY).toBe(200 - lift);
    expect(t.len).toBe(TAIL_H + 22 + STACK_GAP);
  });
});
