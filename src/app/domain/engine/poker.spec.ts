import type { Card, Rank, Suit } from '../models/schemas';
import { comparePoker, evaluatePoker } from './poker';

const S: Record<string, Suit> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades', j: 'joker' };
/** "Kh" → King of hearts; "Xj" → joker. */
const hand = (spec: string): Card[] =>
  spec.split(' ').map((t, i) => {
    const suit = S[t.slice(-1)];
    const rank = (suit === 'joker' ? 'JOKER' : t.slice(0, -1)) as Rank;
    return { id: `${t}-${i}`, suit, rank, exerciseId: suit === 'joker' ? null : 'x', baseAmount: 1 };
  });
const cat = (spec: string) => evaluatePoker(hand(spec)).category;
const beats = (a: string, b: string) => comparePoker(evaluatePoker(hand(a)), evaluatePoker(hand(b)));

describe('evaluatePoker', () => {
  it.each([
    ['9h 10h Jh Qh Kh', 'straight-flush'],
    ['Ah 2h 3h 4h 5h', 'straight-flush'],
    ['7h 7d 7c 7s 2h', 'four-of-a-kind'],
    ['Kh Kd Kc 4s 4h', 'full-house'],
    ['2d 9d Jd Qd 5d', 'flush'],
    ['10h Jd Qc Ks Ah', 'straight'],
    ['Ah 2d 3c 4s 5h', 'straight'],
    ['Qh Qd Qc 4s 2h', 'three-of-a-kind'],
    ['Jh Jd 4c 4s 9h', 'two-pair'],
    ['8h 8d 4c 3s 2h', 'pair'],
    ['Kh 9d 4c 3s 2h', 'high-card'],
  ])('%s is %s', (spec, category) => {
    expect(cat(spec)).toBe(category);
  });

  it('does not wrap straights around the ace (Q-K-A-2-3 is high card)', () => {
    expect(cat('Qh Kd Ac 2s 3h')).toBe('high-card');
  });

  it('jokers are dead cards', () => {
    expect(cat('Xj Xj 7c 7s 2h')).toBe('pair');
    expect(cat('Xj 9h 10h Jh Qh')).toBe('high-card'); // no flush or straight with 4 live cards
  });

  it('compares categories, then the right tie-breakers', () => {
    expect(beats('2h 2d 3c 4s 5h', 'Ah Kd Qc Js 9h')).toBeGreaterThan(0); // pair beats high card
    expect(beats('Kh Kd 2c 3s 4h', 'Qh Qd Ac Ks Jh')).toBeGreaterThan(0); // higher pair
    expect(beats('Kh Kd 9c 3s 4h', 'Ks Kc 8c 7s 6h')).toBeGreaterThan(0); // same pair, higher kicker
    expect(beats('Jh Jd 4c 4s 2h', 'Js Jc 3c 3s Ah')).toBeGreaterThan(0); // two pair: second pair decides
    expect(beats('Ah 2d 3c 4s 5h', '2h 3d 4c 5s 6h')).toBeLessThan(0); // wheel is the lowest straight
    expect(beats('3h 3d 3c 2s 2h', '2d 2c 2h As Ah')).toBeGreaterThan(0); // full house: trips decide
    expect(beats('Kh 9d 4c 3s 2h', 'Kd 9c 4s 3d 2c')).toBe(0); // exact tie
  });
});
