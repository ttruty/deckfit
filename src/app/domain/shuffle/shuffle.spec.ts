import { createRng } from './rng';
import { shuffle } from './shuffle';

const take = (seed: number, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('createRng (mulberry32)', () => {
  // Reference values from the canonical public-domain mulberry32 implementation.
  it.each([
    [0, [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111, 0.46732782293111086]],
    [1, [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849]],
    [42, [0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693, 0.17481389874592423]],
    [4294967295, [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677, 0.8452364315744489]],
  ])('seed %i matches the reference sequence', (seed, expected) => {
    expect(take(seed, 5)).toEqual(expected);
  });

  it('is deterministic per seed and differs across seeds', () => {
    expect(take(123, 50)).toEqual(take(123, 50));
    expect(take(123, 50)).not.toEqual(take(124, 50));
  });

  it('resumes the identical sequence from a saved state', () => {
    const a = createRng(7);
    for (let i = 0; i < 10; i++) a.next();
    const resumed = createRng(a.state);
    expect(Array.from({ length: 20 }, () => resumed.next())).toEqual(Array.from({ length: 20 }, () => a.next()));
  });

  it('keeps next() in [0, 1) and int(n) in [0, n)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 5000; i++) {
      const x = rng.next();
      expect(x >= 0 && x < 1).toBe(true);
      const k = rng.int(7);
      expect(Number.isInteger(k) && k >= 0 && k < 7).toBe(true);
    }
  });

  it('rejects a non-positive or fractional bound', () => {
    const rng = createRng(1);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(2.5)).toThrow(RangeError);
  });
});

describe('shuffle (Fisher–Yates)', () => {
  const deck = Array.from({ length: 54 }, (_, i) => `c${i}`);

  it('is a deterministic permutation for a seed and does not mutate input', () => {
    const copy = deck.slice();
    const a = shuffle(deck, createRng(2026));
    expect(deck).toEqual(copy);
    expect(a).toEqual(shuffle(deck, createRng(2026)));
    expect(a).not.toEqual(deck);
    expect([...a].sort()).toEqual([...deck].sort());
  });

  it('pins the order for a fixed seed (guards against algorithm drift)', () => {
    expect(shuffle(['a', 'b', 'c', 'd', 'e', 'f'], createRng(42))).toMatchInlineSnapshot(`
      [
        "b",
        "a",
        "e",
        "f",
        "c",
        "d",
      ]
    `);
  });

  it('handles empty and single-item input', () => {
    expect(shuffle([], createRng(1))).toEqual([]);
    expect(shuffle(['x'], createRng(1))).toEqual(['x']);
  });

  it('is roughly uniform: each of 3! orders appears ~1/6 of the time', () => {
    const rng = createRng(31337);
    const counts = new Map<string, number>();
    const N = 60000;
    for (let i = 0; i < N; i++) {
      const key = shuffle(['a', 'b', 'c'], rng).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) expect(Math.abs(c / N - 1 / 6)).toBeLessThan(0.01);
  });
});
