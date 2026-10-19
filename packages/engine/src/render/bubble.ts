// Speech bubble placement: the box stays on screen and the tail tip stays on the speaker.
// The tip sits just over the speaker's head, and a newer box moves up over an older one.

import { VIEW_W } from "../sim/types";

/** Gap between the box and each screen edge. */
export const BUBBLE_MARGIN = 4;
/** Width of the tail's base. */
export const TAIL_W = 8;
/** Distance from the box's outer edge to the nearest allowed tail tip. */
export const TAIL_INSET = 8;
/** Width of the box's dark border. */
export const BORDER = 2;
/** Shortest tail, from the bottom of the white box to the tip. */
export const TAIL_H = 6;
/** Gap between the top of the speaker's idle sprite and the tail tip. */
export const HEAD_GAP = 2;
/** Tip height above the feet for a speaker without an idle sprite. */
export const DEFAULT_LIFT = 54;
/** Highest world y for a box's outer top: just under the HUD panels' weapon line. */
export const BUBBLE_TOP = 38;
/** Space between two stacked boxes. */
export const STACK_GAP = 2;

export interface BubblePlacement {
  /** World x of the box's outer left edge. */
  boxX: number;
  /** World x of the tail tip. */
  tailX: number;
  /** The tail's base runs left of its tip, for a tip in the right half of the box. */
  flip: boolean;
}

/** A box's outer rectangle in world pixels, border included. */
export interface BubbleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `outerW` is the box width including its border. All values are whole world pixels. */
export function placeBubble(anchorX: number, camX: number, outerW: number): BubblePlacement {
  const ax = Math.round(anchorX);
  const left = Math.round(camX) + BUBBLE_MARGIN;
  const right = Math.round(camX) + VIEW_W - BUBBLE_MARGIN - outerW;
  const boxX = Math.max(left, Math.min(right, ax - TAIL_INSET));
  const tailX = Math.max(boxX + TAIL_INSET, Math.min(boxX + outerW - TAIL_INSET, ax));
  return { boxX, tailX, flip: tailX - boxX > outerW / 2 };
}

/** Tip height above the feet for a speaker whose idle sprite is `spriteTop` px tall. */
export function bubbleLift(spriteTop: number): number {
  return spriteTop > 0 ? Math.round(spriteTop) + HEAD_GAP : DEFAULT_LIFT;
}

/** World y of the box's outer top with a shortest tail, `lift` px over the feet at `footY`. */
export function bubbleTop(footY: number, lift: number, outerH: number): number {
  return Math.max(BUBBLE_TOP, Math.round(footY) - lift - TAIL_H + BORDER - outerH);
}

/**
 * World y of `box` after it moves up over each box in `placed` that it touches. If the stack
 * rises over BUBBLE_TOP, the box keeps its own y and overlaps.
 */
export function stackBubble(box: BubbleRect, placed: readonly BubbleRect[]): number {
  let y = box.y;
  // y only goes down, and a box that moved over another one stays clear of it.
  for (let moved = true; moved; ) {
    moved = false;
    for (const p of placed) {
      const xHit = box.x < p.x + p.w + STACK_GAP && p.x < box.x + box.w + STACK_GAP;
      const yHit = y < p.y + p.h + STACK_GAP && p.y < y + box.h + STACK_GAP;
      if (xHit && yHit) {
        y = p.y - STACK_GAP - box.h;
        moved = true;
      }
    }
  }
  return y < BUBBLE_TOP ? box.y : y;
}

/**
 * World y of the tail tip and the tail length for a box at `boxY`. The tip stays `lift` px over
 * the feet. A box pushed down under BUBBLE_TOP keeps the shortest tail, and the tip moves down.
 */
export function bubbleTail(
  footY: number,
  lift: number,
  boxY: number,
  outerH: number,
): { tipY: number; len: number } {
  const base = boxY + outerH - BORDER;
  const tipY = Math.max(Math.round(footY) - lift, base + TAIL_H);
  return { tipY, len: tipY - base };
}
