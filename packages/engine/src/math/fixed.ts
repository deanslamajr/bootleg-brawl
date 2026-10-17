// 16.16 fixed-point helpers. Sim positions and velocities are integers in these units.
// Only integer add, subtract, multiply, divide and bit operations are used, so results are
// identical on every JS engine.

export const FX_SHIFT = 16;
export const FX = 1 << FX_SHIFT;
export const FX_HALF = FX >> 1;

/** Convert a content-file number (pixels, pixels per tick) to fixed-point. Content compile only. */
export function toFx(v: number): number {
  return Math.round(v * FX) | 0;
}

/** Fixed-point to whole pixels, rounding toward negative infinity. */
export function fxToInt(v: number): number {
  return v >> FX_SHIFT;
}

/** Fixed-point to a float for the renderer. Never feed the result back into the sim. */
export function fxToFloat(v: number): number {
  return v / FX;
}

export function intToFx(v: number): number {
  return (v << FX_SHIFT) | 0;
}

/** Exact fixed-point multiply for operands up to 2^31 in magnitude. */
export function fxMul(a: number, b: number): number {
  const bHi = b >> FX_SHIFT;
  const bLo = b & 0xffff;
  return (a * bHi + Math.floor((a * bLo) / FX)) | 0;
}

/** Fixed-point divide. Division by zero returns zero rather than Infinity. */
export function fxDiv(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.trunc((a * FX) / b) | 0;
}

/** Multiply by an integer percentage (100 = unchanged). */
export function pct(v: number, percent: number): number {
  return Math.trunc((v * percent) / 100) | 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function abs(v: number): number {
  return v < 0 ? -v : v;
}

/** Integer square root (floor) for non-negative integers. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(n);
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

/** Move `v` toward zero by `amount` without crossing it. */
export function approachZero(v: number, amount: number): number {
  if (v > 0) return v > amount ? v - amount : 0;
  if (v < 0) return v < -amount ? v + amount : 0;
  return 0;
}

export function approach(v: number, target: number, amount: number): number {
  if (v < target) return v + amount > target ? target : v + amount;
  if (v > target) return v - amount < target ? target : v - amount;
  return v;
}

// Quarter-wave sine table in 16.16, 65 entries (0..90 degrees inclusive).
const QSIN = [
  0, 1608, 3216, 4821, 6424, 8022, 9616, 11204, 12785, 14359, 15924, 17479, 19024, 20557, 22078,
  23586, 25080, 26558, 28020, 29466, 30893, 32303, 33692, 35062, 36410, 37736, 39040, 40320, 41576,
  42806, 44011, 45190, 46341, 47464, 48559, 49624, 50660, 51665, 52639, 53581, 54491, 55368, 56212,
  57022, 57798, 58538, 59244, 59914, 60547, 61145, 61705, 62228, 62714, 63162, 63572, 63944, 64277,
  64571, 64827, 65043, 65220, 65358, 65457, 65516, 65536,
];

/** Sine of an angle in 1/256 turns, as 16.16. */
export function isin(angle256: number): number {
  const a = angle256 & 255;
  const q = a >> 6;
  const i = a & 63;
  switch (q) {
    case 0:
      return QSIN[i]!;
    case 1:
      return QSIN[64 - i]!;
    case 2:
      return -QSIN[i]! | 0;
    default:
      return -QSIN[64 - i]! | 0;
  }
}

export function icos(angle256: number): number {
  return isin(angle256 + 64);
}
