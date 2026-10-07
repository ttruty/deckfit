import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import { GamesFileSchema } from './game.schema';
import { amountBand, buildDeck } from './deck-rules';
import { CardSchema, DecksFileSchema, ExercisesFileSchema, PoseLibrarySchema, RANKS, type Deck, type Exercise } from './schemas';

const CONTENT_DIR = join(process.cwd(), 'src/assets/content');

/** Every content file must be listed here, so new files can't slip in unvalidated. */
const SCHEMA_BY_FILE: Record<string, ZodType> = {
  'poses.json': PoseLibrarySchema,
  'exercises.json': ExercisesFileSchema,
  'decks.json': DecksFileSchema,
  'games.json': GamesFileSchema,
};

const read = (file: string): unknown => JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'));
const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json')).sort();

describe('content files', () => {
  it('has a schema for every file', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !SCHEMA_BY_FILE[f])).toEqual([]);
  });

  it.each(files)('%s parses and round-trips without dropping fields', (file) => {
    const raw = read(file);
    const result = SCHEMA_BY_FILE[file].safeParse(raw);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.data).toEqual(raw); // z.object strips unknown keys; equality proves none existed
  });
});

describe('built-in content invariants (§9b)', () => {
  const poses = PoseLibrarySchema.parse(read('poses.json'));
  const { exercises } = ExercisesFileSchema.parse(read('exercises.json'));
  const { decks } = DecksFileSchema.parse(read('decks.json'));
  const exById = new Map(exercises.map((e) => [e.id, e]));

  const PLAYING_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
  const PLAYING_RANKS = RANKS.filter((r) => r !== 'JOKER');
  const rankValue = (rank: string) => (rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(rank) ? 10 : Number(rank));
  const tier = (rank: string) => (['2', '3', '4', '5'].includes(rank) ? 0 : ['6', '7', '8', '9'].includes(rank) ? 1 : 2);

  it('has 120 exercises across 10 decks, all built-in with unique ids', () => {
    expect(exercises).toHaveLength(120);
    expect(decks).toHaveLength(10);
    expect(new Set(exercises.map((e) => e.id)).size).toBe(120);
    expect(new Set(decks.map((d) => d.id)).size).toBe(10);
    expect([...exercises, ...decks].every((x) => x.builtIn)).toBe(true);
  });

  it('references only existing poses', () => {
    const missing = exercises.flatMap((e) => [e.figure.start, e.figure.end].filter((p) => !poses[p]).map((p) => `${e.id}:${p}`));
    expect(missing).toEqual([]);
  });

  describe.each(decks.map((d): [string, Deck] => [d.id, d]))('%s', (_id, deck) => {
    const poolOf = (suit: string) => deck.suits.find((s) => s.suit === suit)?.exerciseIds ?? [];

    it('maps all five suits, with exercises in the four playing ones and none on the joker', () => {
      expect(deck.suits.map((s) => s.suit).sort()).toEqual(['clubs', 'diamonds', 'hearts', 'joker', 'spades']);
      expect(poolOf('joker')).toEqual([]);
      for (const suit of PLAYING_SUITS) expect(poolOf(suit).length, suit).toBeGreaterThan(0);
    });

    it.each(PLAYING_SUITS)('%s: three exercises of the deck category, rising in difficulty', (suit) => {
      const pool = poolOf(suit).map((id) => exById.get(id));
      expect(pool.every(Boolean), `${deck.id}/${suit} has an unknown exercise`).toBe(true);
      const found = pool as Exercise[];
      expect(found).toHaveLength(3);
      expect(new Set(found.map((e) => e.id)).size).toBe(3);
      const [easy, mid, hard] = found;
      expect(easy.difficulty).toBeLessThanOrEqual(mid.difficulty);
      expect(mid.difficulty).toBeLessThanOrEqual(hard.difficulty);
      expect(found.every((e) => e.category === deck.category)).toBe(true);
    });

    it('deals 54 cards: 13 per suit plus 2 jokers, every amount inside its rank band', () => {
      const cards = buildDeck(deck, exById, 7);
      expect(cards).toHaveLength(54);
      for (const suit of PLAYING_SUITS) {
        const suited = cards.filter((c) => c.suit === suit);
        expect(suited.map((c) => c.rank).sort()).toEqual([...PLAYING_RANKS].sort());
        // Every card comes from that group's pool, and nothing else does.
        expect(suited.every((c) => poolOf(suit).includes(c.exerciseId ?? ''))).toBe(true);
      }
      const jokers = cards.filter((c) => c.suit === 'joker');
      expect(jokers).toHaveLength(2);
      expect(jokers.every((c) => CardSchema.parse(c).exerciseId === null && c.baseAmount === 0)).toBe(true);

      const wrong = cards.filter((c) => c.exerciseId).filter((c) => {
        const unit = exById.get(c.exerciseId!)!.measure === 'seconds' ? 5 : 1;
        const [low, high] = amountBand(c.rank);
        return c.baseAmount < low * unit || c.baseAmount > high * unit;
      });
      expect(wrong.map((c) => `${c.id}=${c.baseAmount}`)).toEqual([]);
    });
  });
});

describe('schema rules', () => {
  const card = { id: 'c', suit: 'hearts', rank: '2', exerciseId: 'x', baseAmount: 2 };

  it('rejects a joker with an exercise and a non-joker without one', () => {
    expect(CardSchema.safeParse({ ...card, suit: 'joker', rank: 'JOKER' }).success).toBe(false);
    expect(CardSchema.safeParse({ ...card, exerciseId: null }).success).toBe(false);
    expect(CardSchema.safeParse({ ...card, rank: 'JOKER' }).success).toBe(false);
    expect(CardSchema.safeParse(card).success).toBe(true);
  });

  it('rejects unknown prop types', () => {
    const ex = ExercisesFileSchema.shape.exercises.element;
    const good = read('exercises.json') as { exercises: unknown[] };
    const first = structuredClone(good.exercises[0]) as { figure: { prop: unknown } };
    first.figure.prop = { type: 'rope' };
    expect(ex.safeParse(first).success).toBe(false);
  });
});
