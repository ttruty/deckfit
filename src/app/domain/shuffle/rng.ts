/**
 * Seeded PRNG (mulberry32). The whole generator state is one uint32, so it can
 * live inside serializable engine state and resume exactly after a snapshot.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Current state; pass to createRng to continue the same sequence. */
  readonly state: number;
}

export function createRng(seedOrState: number): Rng {
  let a = seedOrState >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive: number) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError(`int(${maxExclusive}): need a positive integer`);
      return Math.floor(this.next() * maxExclusive);
    },
    get state() {
      return a;
    },
  };
}
