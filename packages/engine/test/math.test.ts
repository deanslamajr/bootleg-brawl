import { describe, expect, it } from "vitest";
import { FX, fxDiv, fxMul, icos, isin, isqrt, toFx, Hasher, Rng } from "../src";

describe("fixed point", () => {
  it("multiplies exactly", () => {
    expect(fxMul(toFx(1.5), toFx(2))).toBe(toFx(3));
    expect(fxMul(toFx(-2.25), toFx(4))).toBe(toFx(-9));
    expect(fxMul(toFx(1000), toFx(0.5))).toBe(toFx(500));
  });
  it("divides and guards zero", () => {
    expect(fxDiv(toFx(3), toFx(2))).toBe(toFx(1.5));
    expect(fxDiv(toFx(3), 0)).toBe(0);
  });
  it("integer square root floors", () => {
    expect(isqrt(0)).toBe(0);
    expect(isqrt(15)).toBe(3);
    expect(isqrt(16)).toBe(4);
    expect(isqrt(1_000_000)).toBe(1000);
  });
  it("table trig is symmetric", () => {
    expect(isin(0)).toBe(0);
    expect(isin(64)).toBe(FX);
    expect(isin(128)).toBe(0);
    expect(isin(192)).toBe(-FX);
    for (let a = 0; a < 256; a++) expect(isin(a) + isin(a + 128)).toBe(0);
    expect(icos(0)).toBe(FX);
  });
});

describe("prng", () => {
  it("is deterministic per seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });
  it("stays in range", () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });
  it("round-trips its state", () => {
    const r = new Rng(1);
    r.nextU32();
    const s = r.getState();
    const x = r.nextU32();
    r.setState(s);
    expect(r.nextU32()).toBe(x);
  });
});

describe("hasher", () => {
  it("is stable and order-independent for object keys", () => {
    expect(new Hasher().value({ a: 1, b: [2, 3] }).digest()).toBe(
      new Hasher().value({ b: [2, 3], a: 1 }).digest(),
    );
    expect(new Hasher().value({ a: 1 }).digest()).not.toBe(new Hasher().value({ a: 2 }).digest());
  });
});
