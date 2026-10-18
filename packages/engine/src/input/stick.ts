// Touch stick math: an offset from the stick origin in CSS px becomes direction bits and DASH.
// Hysteresis on the dead zone and on the sector edges keeps a resting thumb from flickering,
// because every flicker is a new press and two presses within 14 ticks start a run.
// This file is outside the deterministic lint set, so float math is fine. The result is integer
// bits, so the sim stays deterministic.

import { IN } from "../sim/types";

/** The stick leaves neutral past this fraction of the radius. */
export const DEAD_ENTER = 0.28;
/** The stick returns to neutral under this fraction of the radius. */
export const DEAD_EXIT = 0.2;
/** Past this fraction of the radius the stick also sets DASH. */
export const RUN_RING = 0.85;
/** Degrees past a sector edge before the direction changes. */
export const SECTOR_HYSTERESIS = 6;

const DIRS = IN.UP | IN.DOWN | IN.LEFT | IN.RIGHT;

// Sector edges sit 22.5 degrees from each cardinal axis. The thumb must pass an edge by
// SECTOR_HYSTERESIS degrees before the sector changes. The slopes below are tan(16.5),
// tan(22.5) and tan(28.5) degrees, so no trigonometry runs at input time.
const SLOPE_NARROW = 0.29621349;
const SLOPE_EDGE = 0.41421356;
const SLOPE_WIDE = 0.54295567;

/** The direction bits for a point by the plain 45-degree sectors, with no hysteresis. */
function nominal(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const horizontal = dx < 0 ? IN.LEFT : IN.RIGHT;
  const vertical = dy < 0 ? IN.UP : IN.DOWN;
  if (ay <= ax * SLOPE_EDGE) return horizontal;
  if (ax <= ay * SLOPE_EDGE) return vertical;
  return horizontal | vertical;
}

/** Whether the point lies inside the previous sector widened by the hysteresis angle. */
function stillInside(dx: number, dy: number, prev: number): boolean {
  const h = prev & (IN.LEFT | IN.RIGHT);
  const v = prev & (IN.UP | IN.DOWN);
  if (!h && !v) return false;
  if (h === (IN.LEFT | IN.RIGHT) || v === (IN.UP | IN.DOWN)) return false;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const hOk = h === 0 || (h === IN.LEFT ? dx < 0 : dx > 0);
  const vOk = v === 0 || (v === IN.UP ? dy < 0 : dy > 0);
  // A cardinal sector widened by 6 degrees spans 28.5 degrees to each side of its axis.
  if (h && !v) return hOk && ay <= ax * SLOPE_WIDE;
  if (v && !h) return vOk && ax <= ay * SLOPE_WIDE;
  // A diagonal sector widened by 6 degrees runs from 16.5 to 73.5 degrees off the axis.
  return hOk && vOk && ay >= ax * SLOPE_NARROW && ax >= ay * SLOPE_NARROW;
}

/**
 * dx and dy are CSS px from the stick origin, with y down. radius is the full travel. prev is
 * the last result, for hysteresis. Returns the direction bits and DASH.
 */
export function stickBits(dx: number, dy: number, radius: number, prev: number): number {
  if (!(radius > 0)) return 0;
  const r2 = dx * dx + dy * dy;
  const active = (prev & DIRS) !== 0;
  const edge = (active ? DEAD_EXIT : DEAD_ENTER) * radius;
  if (r2 < edge * edge) return 0;
  const dirs = active && stillInside(dx, dy, prev) ? prev & DIRS : nominal(dx, dy);
  const ring = RUN_RING * radius;
  return r2 >= ring * ring ? dirs | IN.DASH : dirs;
}
