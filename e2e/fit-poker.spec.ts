import { expect, test, type Page } from '@playwright/test';
import { createRoom, expectPlayers, hasRealtimeBackend, joinRoom, newDevice } from './support';

/** Every text frame this page receives over WebSockets (i.e. everything Supabase Realtime delivers to it). */
function recordFrames(page: Page): { frames: string[]; mark(): number } {
  const frames: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8'))));
  return { frames, mark: () => frames.length };
}

const handIds = (page: Page) => page.locator('.hand button[data-card-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')!));

test.describe('fit-poker over Supabase Realtime (two browser contexts)', () => {
  test.skip(!hasRealtimeBackend(), 'needs supabaseUrl + supabaseKey in src/environments/environment.local.ts');

  test('each player sees only their own hand — on screen and on the wire — until the showdown reveals both', async ({ browser }) => {
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);
    const boWire = recordFrames(bo);
    const annWire = recordFrames(ann);

    await ann.goto('/room/new');
    await ann.getByRole('button', { name: 'Create room' }).waitFor();
    await ann.getByLabel('Routine').click();
    await ann.getByRole('option', { name: /^Fit Poker/ }).click();
    const code = await createRoom(ann, 'Ann', { keepCurrentPage: true });
    await joinRoom(bo, code, 'Bo');
    await expectPlayers(ann, ['Ann (you)', 'Bo']);
    await bo.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: 'Start game' }).click();

    // The start payload (which lists the whole deck) arrives before the table renders; watch the wire after it.
    await bo.getByText('Waiting for Ann to flip…').waitFor();
    await ann.getByRole('button', { name: 'Deal a hand' }).waitFor();
    const [boFrom, annFrom] = [boWire.mark(), annWire.mark()];
    await ann.getByRole('button', { name: 'Deal a hand' }).click();

    await expect.poll(() => handIds(ann)).toHaveLength(5);
    await expect.poll(() => handIds(bo)).toHaveLength(5);
    const [annHand, boHand] = [await handIds(ann), await handIds(bo)];
    expect(annHand.filter((id) => boHand.includes(id))).toEqual([]);

    // Neither screen shows the other's cards, and no frame either device received names them.
    await expect(bo.locator('.revealed')).toHaveCount(0);
    await expect(ann.locator('.revealed')).toHaveCount(0);
    const named = (frames: string[], ids: string[]) => ids.filter((id) => frames.some((f) => f.includes(`"${id}"`)));
    expect(named(boWire.frames.slice(boFrom), annHand)).toEqual([]);
    expect(named(annWire.frames.slice(annFrom), boHand)).toEqual([]);
    expect(boWire.frames.slice(boFrom).some((f) => f.includes('"private"'))).toBe(true);

    // Ann bets, Bo calls: the showdown reveals both hands to both players.
    await ann.getByRole('button', { name: /^Bet to/ }).click();
    await bo.getByRole('button', { name: /^Call/ }).click();
    await expect.poll(async () => (await bo.locator('.revealed').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))).sort())
      .toEqual([...annHand].sort());
    await expect.poll(async () => (await ann.locator('.revealed').evaluateAll((els) => els.map((e) => e.getAttribute('data-card-id')))).sort())
      .toEqual([...boHand].sort());

    await ann.context().close();
    await bo.context().close();
  });
});
