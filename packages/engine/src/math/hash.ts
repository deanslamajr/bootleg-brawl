// FNV-1a over bytes and numbers. Used for state hashes in golden replays and desync checks.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export class Hasher {
  h = FNV_OFFSET;

  byte(b: number): this {
    this.h = Math.imul(this.h ^ (b & 0xff), FNV_PRIME) >>> 0;
    return this;
  }

  u32(v: number): this {
    v = v >>> 0;
    this.byte(v);
    this.byte(v >>> 8);
    this.byte(v >>> 16);
    this.byte(v >>> 24);
    return this;
  }

  int(v: number): this {
    return this.u32(v | 0);
  }

  bytes(view: ArrayBufferView): this {
    const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (let i = 0; i < u8.length; i++) this.h = Math.imul(this.h ^ u8[i]!, FNV_PRIME) >>> 0;
    return this;
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c);
      this.byte(c >>> 8);
    }
    return this;
  }

  /** Hash any JSON-shaped value with a stable key order. */
  value(v: unknown): this {
    if (v === null || v === undefined) return this.byte(0);
    if (typeof v === "number")
      return this.byte(1).int(Number.isInteger(v) ? v : Math.round(v * 65536));
    if (typeof v === "boolean") return this.byte(2).byte(v ? 1 : 0);
    if (typeof v === "string") return this.byte(3).str(v);
    if (Array.isArray(v)) {
      this.byte(4).u32(v.length);
      for (const item of v) this.value(item);
      return this;
    }
    if (ArrayBuffer.isView(v)) return this.byte(5).bytes(v);
    const keys = Object.keys(v as object).sort();
    this.byte(6).u32(keys.length);
    for (const k of keys) {
      this.str(k);
      this.value((v as Record<string, unknown>)[k]);
    }
    return this;
  }

  digest(): number {
    return this.h >>> 0;
  }
}

export function hashString(s: string): number {
  return new Hasher().str(s).digest();
}

export function hex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}
