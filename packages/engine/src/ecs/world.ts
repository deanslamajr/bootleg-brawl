// Minimal entity-component store. Components are typed arrays indexed by dense entity id, so a
// snapshot is a set of array copies and a restore is TypedArray.set.

import { Hasher } from "../math/hash";

export type ComponentType = "i32" | "i16" | "u16" | "u8" | "i8" | "u32";

export type Store = Int32Array | Int16Array | Uint16Array | Uint8Array | Int8Array | Uint32Array;

export interface ComponentDef {
  name: string;
  type: ComponentType;
  /** Values per entity. Default 1. */
  stride?: number;
}

const CTORS = {
  i32: Int32Array,
  i16: Int16Array,
  u16: Uint16Array,
  u8: Uint8Array,
  i8: Int8Array,
  u32: Uint32Array,
} as const;

export interface WorldSnapshot {
  stores: Record<string, Store>;
}

export class World {
  readonly capacity: number;
  readonly alive: Uint8Array;
  private readonly stores = new Map<string, { def: ComponentDef; data: Store }>();
  private readonly order: string[] = [];
  /** Highest live entity id + 1. Iterating to this bound visits every live entity. */
  high = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
  }

  define<T extends Store = Store>(def: ComponentDef): T {
    const existing = this.stores.get(def.name);
    if (existing) {
      if (existing.def.type !== def.type || (existing.def.stride ?? 1) !== (def.stride ?? 1))
        throw new Error(`component ${def.name} redefined with a different layout`);
      return existing.data as T;
    }
    const data = new CTORS[def.type](this.capacity * (def.stride ?? 1));
    this.stores.set(def.name, { def, data });
    this.order.push(def.name);
    return data as T;
  }

  get<T extends Store = Store>(name: string): T {
    const s = this.stores.get(name);
    if (!s) throw new Error(`unknown component ${name}`);
    return s.data as T;
  }

  has(name: string): boolean {
    return this.stores.has(name);
  }

  /** Lowest free id first, so allocation order is deterministic. Returns -1 when full. */
  alloc(): number {
    for (let e = 0; e < this.capacity; e++) {
      if (this.alive[e] === 0) {
        this.clear(e);
        this.alive[e] = 1;
        if (e + 1 > this.high) this.high = e + 1;
        return e;
      }
    }
    return -1;
  }

  free(e: number): void {
    if (this.alive[e] === 0) return;
    this.alive[e] = 0;
    this.clear(e);
    while (this.high > 0 && this.alive[this.high - 1] === 0) this.high--;
  }

  private clear(e: number): void {
    for (const name of this.order) {
      const { def, data } = this.stores.get(name)!;
      const stride = def.stride ?? 1;
      data.fill(0, e * stride, e * stride + stride);
    }
  }

  count(): number {
    let n = 0;
    for (let e = 0; e < this.high; e++) n += this.alive[e]!;
    return n;
  }

  snapshot(): WorldSnapshot {
    const stores: Record<string, Store> = { __alive: this.alive.slice() };
    for (const name of this.order) stores[name] = this.stores.get(name)!.data.slice();
    return { stores };
  }

  restore(snap: WorldSnapshot): void {
    this.alive.set(snap.stores.__alive as Uint8Array);
    for (const name of this.order) {
      const src = snap.stores[name];
      if (src) (this.stores.get(name)!.data as Store).set(src as never);
    }
    this.high = 0;
    for (let e = 0; e < this.capacity; e++) if (this.alive[e]) this.high = e + 1;
  }

  hashInto(h: Hasher): void {
    h.bytes(this.alive);
    for (const name of this.order) {
      h.str(name);
      h.bytes(this.stores.get(name)!.data);
    }
  }
}
