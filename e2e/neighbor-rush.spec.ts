import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createGame } from '../src/app/core/sync/game-start';
import { resolveSettings } from '../src/app/domain/engine/dsl/settings';
import { reduce } from '../src/app/domain/engine/reducer';
import { GamesFileSchema } from '../src/app/domain/models/game.schema';
import { DecksFileSchema, ExercisesFileSchema, type Card } from '../src/app/domain/models/schemas';
import { createRoom, expectPlayers, hasRealtimeBackend, joinRoom, newDevice } from './support';

const read = (f: string): unknown => JSON.parse(readFileSync(`src/assets/content/${f}`, 'utf8'));
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Same rule as the game's `play.require`: same suit, or neighboring rank (A wraps; jokers never). */
function fits(a: Card, b: Card): boolean {
  if (a.suit === b.suit) return true;
  const [ia, ib] = [RANKS.indexOf(a.rank), RANKS.indexOf(b.rank)];
  if (ia < 0 || ib < 0) return false;
  const d = Math.abs(ia - ib);
  return d === 1 || d === RANKS.length - 1;
}

/**
 * Deals neighbor-rush exactly as the host will (default settings, bodyweight deck, 2 seats) and finds
 * a seed where each player holds a card that fits the center but not the other player's card —
 * so when both play at once, exactly one can land.
 */
function contestedSeed(): { seed: number; hostCard: string; guestCard: string } {
  const game = GamesFileSchema.parse(read('games.json')).games.find((g) => g.id === 'neighbor-rush')!;
  const deck = DecksFileSchema.parse(read('decks.json')).decks.find((d) => d.id === 'deck-bodyweight')!;
  const { exercises } = ExercisesFileSchema.parse(read('exercises.json'));
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  for (let seed = 1; seed < 5000; seed++) {
    const { ctx, initial } = createGame({
      seed, game, settings: resolveSettings(game), exercises,
      players: [{ id: 'host', name: 'Host', seat: 0 }, { id: 'guest', name: 'Guest', seat: 1 }],
      deck: { id: deck.id, name: deck.name, suits: deck.suits, cards: deck.cards },
    });
    const { state } = reduce(initial, { type: 'deal', playerId: 'host' }, ctx);
    const center = byId.get(state.zones.table.at(-1)!)!;
    for (const h of state.zones.hands['host']) {
      for (const g of state.zones.hands['guest']) {
        const [hc, gc] = [byId.get(h)!, byId.get(g)!];
        if (fits(hc, center) && fits(gc, center) && !fits(hc, gc) && !fits(gc, hc)) return { seed, hostCard: h, guestCard: g };
      }
    }
  }
  throw new Error('no contested seed found');
}

test.describe('neighbor-rush over Supabase Realtime (two browser contexts)', () => {
  test.skip(!hasRealtimeBackend(), 'needs supabaseUrl + supabaseKey in src/environments/environment.local.ts');

  test('both players play onto the same center card at once: exactly one lands, the other gets it back with a toast', async ({ browser }) => {
    const { seed, hostCard, guestCard } = contestedSeed();
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);

    // Ann hosts Neighbor Rush with a reproducible deal (dev builds honor ?seed=).
    await ann.goto(`/room/new?seed=${seed}`);
    await ann.getByRole('button', { name: 'Create room' }).waitFor();
    await ann.getByLabel('Routine').click();
    await ann.getByRole('option', { name: /^Neighbor Rush/ }).click();
    const code = await createRoom(ann, 'Ann', { keepCurrentPage: true });
    await joinRoom(bo, code, 'Bo');
    await expectPlayers(ann, ['Ann (you)', 'Bo']);

    await bo.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: 'Start game' }).click();

    const hostButton = ann.locator(`.hand button[data-card-id="${hostCard}"]`);
    const guestButton = bo.locator(`.hand button[data-card-id="${guestCard}"]`);
    await expect(hostButton).toBeEnabled();
    await expect(guestButton).toBeEnabled();

    // Watch both screens for the "too late" toast before playing (it auto-hides after a few seconds).
    const toastOn = (page: typeof ann, who: 'ann' | 'bo') =>
      page.getByRole('alert').filter({ hasText: 'Too late' }).waitFor({ timeout: 15_000 }).then(() => who);
    const toasted = Promise.any([toastOn(ann, 'ann'), toastOn(bo, 'bo')]);

    // Same moment, same center card.
    await Promise.all([hostButton.click(), guestButton.click()]);
    const toastedOn = await toasted;

    const centerTop = (page: typeof ann) => page.locator('.center-cards li').last().getAttribute('data-card-id');
    await expect.poll(() => centerTop(ann)).not.toBe(null);
    await expect.poll(async () => [hostCard, guestCard].includes((await centerTop(ann)) ?? '')).toBe(true);
    const landed = (await centerTop(ann))!;
    await expect.poll(() => centerTop(bo)).toBe(landed);

    const [winner, loser, loserCard] = landed === hostCard ? [ann, bo, guestCard] : [bo, ann, hostCard];
    expect(toastedOn).toBe(loser === ann ? 'ann' : 'bo'); // the toast went to the player whose card didn't land
    await expect(loser.locator(`.hand button[data-card-id="${loserCard}"]`)).toBeVisible(); // back in (never left) the hand
    await expect(winner.locator(`.hand button[data-card-id="${landed}"]`)).toHaveCount(0);

    await ann.context().close();
    await bo.context().close();
  });
});
