// The touch stick: dead zone and sector hysteresis, eight clean directions, and DASH past the ring.

import { describe, expect, it } from "vitest";
import { IN } from "../src/sim/types";
import { DEAD_ENTER, DEAD_EXIT, RUN_RING, stickBits } from "../src/input/stick";

const R = 40;
const DIRS = IN.UP | IN.DOWN | IN.LEFT | IN.RIGHT;

/** A point at `deg` degrees clockwise from the right axis (y down), at `frac` of the radius. */
function at(deg: number, frac: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * frac * R, Math.sin(a) * frac * R];
}

describe("stickBits", () => {
  it("is neutral inside the dead zone", () => {
    expect(stickBits(0, 0, R, 0)).toBe(0);
    expect(stickBits(...at(0, 0.1), R, 0)).toBe(0);
    expect(stickBits(...at(200, 0.2), R, 0)).toBe(0);
    expect(stickBits(1, 1, 0, 0)).toBe(0);
  });

  it("gives each of the eight directions and never an opposite pair", () => {
    const seen = new Set<number>();
    for (let deg = 0; deg < 360; deg++) {
      const bits = stickBits(...at(deg, 0.6), R, 0);
      expect(bits & IN.DASH).toBe(0);
      expect(bits & (IN.UP | IN.DOWN)).not.toBe(IN.UP | IN.DOWN);
      expect(bits & (IN.LEFT | IN.RIGHT)).not.toBe(IN.LEFT | IN.RIGHT);
      expect(bits & DIRS).not.toBe(0);
      seen.add(bits);
    }
    expect(seen.size).toBe(8);
    expect(stickBits(...at(0, 0.6), R, 0)).toBe(IN.RIGHT);
    expect(stickBits(...at(90, 0.6), R, 0)).toBe(IN.DOWN);
    expect(stickBits(...at(180, 0.6), R, 0)).toBe(IN.LEFT);
    expect(stickBits(...at(270, 0.6), R, 0)).toBe(IN.UP);
    expect(stickBits(...at(45, 0.6), R, 0)).toBe(IN.RIGHT | IN.DOWN);
    expect(stickBits(...at(315, 0.6), R, 0)).toBe(IN.RIGHT | IN.UP);
  });

  it("enters past 28 percent and leaves under 20 percent", () => {
    expect(DEAD_ENTER).toBe(0.28);
    expect(DEAD_EXIT).toBe(0.2);
    expect(stickBits(...at(0, 0.27), R, 0)).toBe(0);
    expect(stickBits(...at(0, 0.29), R, 0)).toBe(IN.RIGHT);
    expect(stickBits(...at(0, 0.21), R, IN.RIGHT)).toBe(IN.RIGHT);
    expect(stickBits(...at(0, 0.19), R, IN.RIGHT)).toBe(0);
  });

  it("keeps a sector until the thumb passes its edge by six degrees", () => {
    // The RIGHT sector ends at 22.5 degrees. From RIGHT, 25.5 keeps it and 29.5 switches.
    expect(stickBits(...at(25.5, 0.6), R, IN.RIGHT)).toBe(IN.RIGHT);
    expect(stickBits(...at(29.5, 0.6), R, IN.RIGHT)).toBe(IN.RIGHT | IN.DOWN);
    // From the diagonal, 19.5 keeps it and 15.5 switches back to RIGHT.
    expect(stickBits(...at(19.5, 0.6), R, IN.RIGHT | IN.DOWN)).toBe(IN.RIGHT | IN.DOWN);
    expect(stickBits(...at(15.5, 0.6), R, IN.RIGHT | IN.DOWN)).toBe(IN.RIGHT);
    // The same around a vertical axis: DOWN ends at 112.5 degrees.
    expect(stickBits(...at(115.5, 0.6), R, IN.DOWN)).toBe(IN.DOWN);
    expect(stickBits(...at(119.5, 0.6), R, IN.DOWN)).toBe(IN.DOWN | IN.LEFT);
    // Without a previous sector, the plain edge applies.
    expect(stickBits(...at(25.5, 0.6), R, 0)).toBe(IN.RIGHT | IN.DOWN);
    // A previous value with an opposite pair is treated as neutral.
    expect(stickBits(...at(25.5, 0.6), R, IN.UP | IN.DOWN)).toBe(IN.RIGHT | IN.DOWN);
  });

  it("sets DASH past 85 percent of the radius", () => {
    expect(RUN_RING).toBe(0.85);
    expect(stickBits(...at(0, 0.84), R, 0)).toBe(IN.RIGHT);
    expect(stickBits(...at(0, 0.86), R, 0)).toBe(IN.RIGHT | IN.DASH);
    expect(stickBits(...at(225, 1.5), R, 0)).toBe(IN.LEFT | IN.UP | IN.DASH);
  });
});
