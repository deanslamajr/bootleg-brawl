import { describe, expect, it } from "vitest";
import { Hasher, World } from "../src";

describe("world", () => {
  it("allocates the lowest free id and clears components", () => {
    const w = new World(8);
    const hp = w.define<Int32Array>({ name: "hp", type: "i32" });
    const a = w.alloc();
    const b = w.alloc();
    hp[b] = 99;
    expect([a, b]).toEqual([0, 1]);
    w.free(a);
    expect(w.alloc()).toBe(0);
    w.free(b);
    expect(w.alloc()).toBe(1);
    expect(hp[1]).toBe(0);
  });
  it("snapshots and restores bit for bit", () => {
    const w = new World(16);
    const x = w.define<Int32Array>({ name: "x", type: "i32" });
    for (let i = 0; i < 5; i++) x[w.alloc()] = i * 7;
    const snap = w.snapshot();
    const before = new Hasher();
    w.hashInto(before);
    x[2] = -1;
    w.free(3);
    w.restore(snap);
    const after = new Hasher();
    w.hashInto(after);
    expect(after.digest()).toBe(before.digest());
    expect(w.high).toBe(5);
  });
  it("refuses a component redefined with a different layout", () => {
    const w = new World(4);
    w.define({ name: "a", type: "u8" });
    expect(() => w.define({ name: "a", type: "i32" })).toThrow();
  });
});
