// xoshiro128** seeded PRNG. The only randomness the sim may use.

export class Rng {
  readonly s = new Uint32Array(4);

  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(seed: number): void {
    // splitmix32 expands the seed into four non-zero words.
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      z = (z ^ (z >>> 16)) >>> 0;
      this.s[i] = z || 1;
    }
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1]!, 5), 7), 9) >>> 0;
    const t = (s[1]! << 9) >>> 0;
    s[2] = s[2]! ^ s[0]!;
    s[3] = s[3]! ^ s[1]!;
    s[1] = s[1]! ^ s[2]!;
    s[0] = s[0]! ^ s[3]!;
    s[2] = s[2]! ^ t;
    s[3] = rotl(s[3]!, 11);
    return result;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    if (n <= 1) return 0;
    return this.nextU32() % n;
  }

  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** True with probability percent/100. */
  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  /** Index chosen by integer weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return 0;
    let r = this.int(total);
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  getState(): number[] {
    return Array.from(this.s);
  }

  setState(state: readonly number[]): void {
    for (let i = 0; i < 4; i++) this.s[i] = state[i]! >>> 0;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
