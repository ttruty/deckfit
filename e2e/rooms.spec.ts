import { expect, test } from '@playwright/test';
import { createRoom, expectPlayers, hasRealtimeBackend, joinRoom, newDevice } from './support';

test.describe('rooms over Supabase Realtime (two browser contexts)', () => {
  test.skip(!hasRealtimeBackend(), 'needs supabaseUrl + supabaseKey in src/environments/environment.local.ts');

  test('one device creates a room, another joins, and they see each other live', async ({ browser }) => {
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);

    const code = await createRoom(ann, 'Ann');
    await expect(ann.locator('df-qr-code svg')).toBeVisible();
    await expectPlayers(ann, ['Ann (you)']);

    await joinRoom(bo, code, 'Bo');
    await expectPlayers(bo, ['Ann', 'Bo (you)']);
    await expectPlayers(ann, ['Ann (you)', 'Bo']);
    // The routine travels with the room: the joiner sees exactly what the host picked.
    await expect(bo.locator('.routine .game')).toHaveText((await ann.locator('.routine .game').innerText()).trim());
    await expect(bo.locator('.routine .game')).toContainText('· Bodyweight deck');
    await expect(bo.locator('.players li').first().locator('.host')).toHaveText('Host');

    // Ready toggles travel both ways through the host.
    await bo.getByRole('button', { name: "I'm ready" }).click();
    await expect(ann.locator('.players li').nth(1).locator('.status')).toContainText('Ready');
    await ann.getByRole('button', { name: "I'm ready" }).click();
    await expect(bo.locator('.blocker')).toContainText("Everyone's ready");

    await ann.context().close();
    await bo.context().close();
  });

  test('a device that reloads rejoins with the same identity and seat', async ({ browser }) => {
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);
    const cy = await newDevice(browser);
    const code = await createRoom(ann, 'Ann');
    await joinRoom(bo, code, 'Bo');
    await expectPlayers(ann, ['Ann (you)', 'Bo']);
    await joinRoom(cy, code, 'Cy');
    await expectPlayers(ann, ['Ann (you)', 'Bo', 'Cy']);

    await bo.reload();
    await expectPlayers(bo, ['Ann', 'Bo (you)', 'Cy']);
    await expectPlayers(ann, ['Ann (you)', 'Bo', 'Cy']); // no duplicate, same seat

    for (const p of [ann, bo, cy]) await p.context().close();
  });

  test('when the host leaves for more than 10 seconds, the next player becomes host', async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);
    const code = await createRoom(ann, 'Ann');
    await joinRoom(bo, code, 'Bo');
    await expectPlayers(bo, ['Ann', 'Bo (you)']);

    await ann.context().close();
    await expect(bo.locator('.host-away')).toBeVisible();
    await expect(bo.locator('.players li').first().locator('.host')).toHaveText('Host', { timeout: 30_000 });
    await expectPlayers(bo, ['Bo (you)']);
    await expect(bo.locator('.host-away')).toBeHidden();

    await bo.context().close();
  });
});

test.describe('finding your way into a room', () => {
  test('Home and the game catalog both lead to a new room, preselecting the game you picked', async ({ browser }) => {
    const page = await newDevice(browser);

    // Home → Start a room.
    await page.goto('/');
    await page.getByRole('link', { name: 'Start a room' }).click();
    await expect(page).toHaveURL(/\/room\/new$/);
    await expect(page.getByRole('combobox', { name: 'Routine' })).toContainText('Interval Deck');

    // Game catalog → Start a room for that game.
    await page.goto('/games');
    await page.locator('li.game', { hasText: 'Neighbor Rush' }).getByRole('link', { name: 'Start a room' }).click();
    await expect(page).toHaveURL(/\/room\/new\?game=neighbor-rush$/);
    await expect(page.getByRole('combobox', { name: 'Routine' })).toContainText('Neighbor Rush');

    // Solo-only games don't offer it.
    await page.goto('/games');
    await expect(page.locator('li.game', { hasText: 'Solo Deal' }).getByRole('link', { name: 'Start a room' })).toHaveCount(0);

    await page.context().close();
  });
});

test.describe('joining after the game has started', () => {
  test.skip(!hasRealtimeBackend(), 'needs supabaseUrl + supabaseKey in src/environments/environment.local.ts');

  test('a latecomer watches, and a player who reloads picks up where they left off', async ({ browser }) => {
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);

    await ann.goto('/room/new');
    await ann.getByRole('button', { name: 'Create room' }).waitFor();
    await ann.getByLabel('Routine').click();
    await ann.getByRole('option', { name: /^High Card Duel/ }).click();
    const code = await createRoom(ann, 'Ann', { keepCurrentPage: true });
    await joinRoom(bo, code, 'Bo');
    await expectPlayers(ann, ['Ann (you)', 'Bo']);
    await bo.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: 'Start game' }).click();
    await expect(ann.locator('df-room-table')).toBeVisible();

    // Bo reloads mid-game: the table comes back, not the lobby.
    await bo.reload();
    await expect(bo.locator('df-room-table')).toBeVisible();
    await expect(bo.getByText(/You joined after this game started/)).toHaveCount(0);
    await bo.getByRole('button', { name: 'Flip' }).click(); // still a player

    // Cy arrives late: they watch this game.
    const cy = await newDevice(browser);
    await cy.goto(`/room/${code}`); // straight into the running game, so there's no lobby form
    await expect(cy.locator('df-room-table')).toBeVisible();
    await expect(cy.getByText(/You joined after this game started/)).toBeVisible();
    await expect(cy.getByRole('button', { name: 'Flip' })).toHaveCount(0);
    // They see the real game: the same players as the host does.
    // `.info .name` is the player's name; cards inside the strip have a `.name` of their own.
    await expect.poll(async () => await cy.locator('.players > li .info .name').count()).toBe(2);

    for (const page of [ann, bo, cy]) await page.context().close();
  });
});
