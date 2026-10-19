// Speech bubble placement: the box stays on screen and the tail tip stays on the speaker.

import { VIEW_W } from "../sim/types";

/** Gap between the box and each screen edge. */
export const BUBBLE_MARGIN = 4;
/** Width of the tail's base. */
export const TAIL_W = 8;
/** Distance from the box's outer edge to the nearest allowed tail tip. */
export const TAIL_INSET = 8;

export interface BubblePlacement {
  /** World x of the box's outer left edge. */
  boxX: number;
  /** World x of the tail tip. */
  tailX: number;
  /** The tail's base runs left of its tip, for a tip in the right half of the box. */
  flip: boolean;
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
