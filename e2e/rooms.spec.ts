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

test.describe('what the table shows between rounds', () => {
  test.skip(!hasRealtimeBackend(), 'needs supabaseUrl + supabaseKey in src/environments/environment.local.ts');

  test('a player who hasn’t flipped shows a card back, not last round’s card', async ({ browser }) => {
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);

    await ann.goto('/room/new');
    await ann.getByRole('button', { name: 'Create room' }).waitFor();
    await ann.getByLabel('Routine').click();
    await ann.getByRole('option', { name: /^High Card Duel/ }).click();
    const code = await createRoom(ann, 'Ann', { keepCurrentPage: true });
    await joinRoom(bo, code, 'Bo', { seenBy: ann });
    await bo.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: 'Start game' }).click();
    await expect(ann.locator('df-room-table')).toBeVisible();

    const faces = ann.locator('.players df-card-face');
    const backs = ann.locator('.players df-card-back');
    const flip = (page: typeof ann) => page.getByRole('button', { name: 'Flip', exact: true }).click();

    // Ann flips: her card shows, Bo is face down until he plays.
    await flip(ann);
    await expect(faces).toHaveCount(1);
    await expect(backs).toHaveCount(1);
    await expect(ann.locator('.players li', { hasText: 'Bo' })).toContainText('yet to flip');

    // Both in: the round resolves and both cards are on show to compare.
    await flip(bo);
    await expect(faces).toHaveCount(2);
    await expect(backs).toHaveCount(0);

    // Next round: the losers work first, then Ann flips again and Bo goes face down once more —
    // last round's card must not linger.
    for (let i = 0; i < 6 && !(await ann.getByRole('button', { name: 'Flip', exact: true }).count()); i++) {
      for (const page of [ann, bo]) {
        const done = page.getByRole('button', { name: 'Done', exact: true });
        if (await done.count()) await done.first().click({ timeout: 1500 }).catch(() => undefined);
      }
      await ann.waitForTimeout(250);
    }
    await flip(ann);
    await expect(faces).toHaveCount(1);
    await expect(backs).toHaveCount(1);

    for (const page of [ann, bo]) await page.context().close();
  });
});

test.describe('understanding the game', () => {
  test.skip(!hasRealtimeBackend(), 'needs supabaseUrl + supabaseKey in src/environments/environment.local.ts');

  test('the table says what the game is, who won each round, and who won overall', async ({ browser }) => {
    test.setTimeout(120_000); // it plays a whole six-round game on two devices
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);

    await ann.goto('/room/new');
    await ann.getByRole('button', { name: 'Create room' }).waitFor();
    await ann.getByLabel('Routine').click();
    await ann.getByRole('option', { name: /^High Card Duel/ }).click();
    const code = await createRoom(ann, 'Ann', { keepCurrentPage: true });
    await joinRoom(bo, code, 'Bo', { seenBy: ann });
    // The rules travel with the room, so a joiner can read them before it starts.
    await expect(bo.getByText('How to play')).toBeVisible();
    await bo.getByText('How to play').click();
    await expect(bo.getByText(/highest card wins the round/i)).toBeVisible();

    await bo.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: 'Start game' }).click();

    // What this game is, right under the title, plus rules on demand.
    await expect(ann.locator('.objective')).toContainText(/highest card/i);
    await ann.getByRole('button', { name: 'Rules' }).click();
    await expect(ann.getByRole('dialog')).toContainText('Everyone turns a card over at the same time.');
    await ann.getByRole('button', { name: 'Got it' }).click();

    // Play rounds until somebody takes the game; every round says who won.
    // Watch for a round announcement for as long as the game runs (toasts auto-hide).
    const sawRoundToast = ann
      .getByRole('alert')
      .filter({ hasText: /win(s)? round/ })
      .waitFor({ timeout: 40_000 })
      .then(() => true)
      .catch(() => false);

    for (let i = 0; i < 40 && !(await ann.locator('df-game-result').count()); i++) {
      for (const page of [ann, bo]) {
        for (const label of ['Flip', 'Done']) {
          const button = page.getByRole('button', { name: label, exact: true });
          // Short timeout: a toast can cover a button, and the default 30s wait would eat the budget.
          if (await button.count()) await button.first().click({ timeout: 1500 }).catch(() => undefined);
        }
      }
      await ann.waitForTimeout(150);
    }

    expect(await sawRoundToast).toBe(true); // every round says who took it
    await expect(ann.locator('df-game-result')).toBeVisible();

    // Fireworks for a player who won (a tie means both did); losing just slumps the row.
    for (const page of [ann, bo]) {
      await expect(page.locator('df-game-result')).toBeVisible();
      const won = await page.locator('df-game-result li.me.won').count();
      const fireworks = page.locator('df-game-result df-fireworks');
      await expect(fireworks).toHaveCount(won ? 1 : 0);
      if (!won) await expect(page.locator('df-game-result li.me.lost')).toHaveCount(1);
    }

    const winner = (await ann.locator('df-game-result li.me.won').count()) ? ann : bo;
    await expect(winner.locator('df-game-result df-fireworks .spark').first()).toBeVisible();

    // …and nothing moves for a player who asked for less motion.
    await winner.emulateMedia({ reducedMotion: 'reduce' });
    await expect(winner.locator('df-game-result df-fireworks')).toBeHidden();
    await expect(winner.locator('df-game-result')).toBeVisible(); // the result itself still reads fine
    await winner.emulateMedia({ reducedMotion: null });

    // The end names a winner in words, not just numbers.
    const result = ann.locator('df-game-result');
    await expect(result).toBeVisible();
    await expect(result.getByRole('heading')).toHaveText(/win|tie|Nobody scored/i);
    await expect(result).toContainText('rounds won');
    await expect(result.locator('li').first()).toContainText(/🏆|1/);

    for (const page of [ann, bo]) await page.context().close();
  });

});

test.describe('what happens after a game', () => {
  test.skip(!hasRealtimeBackend(), 'needs supabaseUrl + supabaseKey in src/environments/environment.local.ts');

  test('the lobby stacks on a phone: code, players and routine each get their own space', async ({ browser }) => {
    const ann = await newDevice(browser, { phone: true });
    await createRoom(ann, 'Ann');

    // The three panels sit one below the other. (They share a grid; with no single-column areas
    // they all landed in the first cell and overlapped.)
    const boxes = await Promise.all(
      ['.invite', '.players', '.routine'].map(async (sel) => (await ann.locator(sel).boundingBox())!),
    );
    for (const box of boxes) expect(box).not.toBeNull();
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
    }
    // Nothing spills sideways either.
    const overflow = await ann.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(ann.locator('.code')).toBeVisible();
    await expect(ann.getByRole('button', { name: "I'm ready" })).toBeVisible();

    await ann.context().close();
  });

  test('the host can swap the game in the lobby, and everyone says they are ready again', async ({ browser }) => {
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);

    const code = await createRoom(ann, 'Ann');
    await joinRoom(bo, code, 'Bo', { seenBy: ann });
    await bo.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: "I'm ready" }).click();
    await expect(bo.locator('.blocker')).toContainText("Everyone's ready");

    // Only the host gets the picker.
    await expect(bo.locator('.routine .swap')).toHaveCount(0);
    await ann.getByLabel('Game').click();
    await ann.getByRole('option', { name: /High Card Duel/ }).click();

    // The new game travels to the joiner, and nobody is ready for something they didn't pick.
    await expect(bo.locator('.routine .game')).toContainText('High Card Duel');
    await expect(bo.getByRole('button', { name: "I'm ready" })).toBeVisible();
    await expect(bo.locator('.blocker')).toContainText('ready');

    // Intensity is the host's call too, and the joiner sees what they'll be working at (§6.1).
    await expect(bo.locator('.routine .facts')).toContainText('Moderate intensity');
    await ann.locator('df-intensity-picker').getByRole('button', { name: 'High' }).click();
    await expect(bo.locator('.routine .facts')).toContainText('High intensity');
    await expect(bo.locator('df-intensity-picker')).toHaveCount(0); // players don't get the control

    for (const page of [ann, bo]) await page.context().close();
  });

  test('when the game ends, players can ask for another and the host deals a fresh one', async ({ browser }) => {
    test.setTimeout(180_000); // plays a whole six-round game, then starts a second
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);

    await ann.goto('/room/new');
    await ann.getByRole('button', { name: 'Create room' }).waitFor();
    await ann.getByLabel('Routine').click();
    await ann.getByRole('option', { name: /^High Card Duel/ }).click();
    const code = await createRoom(ann, 'Ann', { keepCurrentPage: true });
    await joinRoom(bo, code, 'Bo', { seenBy: ann });
    await bo.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: "I'm ready" }).click();
    await ann.getByRole('button', { name: 'Start game' }).click();

    // Clicks are best-effort with a short timeout: a toast can briefly cover a button, and the
    // default 30s actionability wait would eat the whole test budget.
    const playOut = async () => {
      for (let i = 0; i < 60 && !(await ann.locator('df-game-result').count()); i++) {
        for (const page of [ann, bo]) {
          for (const label of ['Flip', 'Done']) {
            const button = page.getByRole('button', { name: label, exact: true });
            if (await button.count()) await button.first().click({ timeout: 1500 }).catch(() => undefined);
          }
        }
        await ann.waitForTimeout(150);
      }
    };
    await playOut();
    await expect(ann.locator('df-game-result')).toBeVisible();

    // A player says they're in; the host sees it.
    await bo.getByRole('button', { name: 'Play again' }).click();
    await expect(bo.getByRole('button', { name: 'You’re in' })).toBeDisabled();
    await expect(ann.locator('.next .hint')).toContainText('Bo is up for another');

    // The host deals again: same game, clean slate, on both devices.
    await ann.getByRole('button', { name: 'Play again' }).click();
    for (const page of [ann, bo]) {
      await expect(page.locator('df-game-result')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Flip', exact: true })).toBeVisible();
      await expect(page.locator('.players li').first()).toContainText('0 won');
    }

    // Finish the rematch and take everyone back to the lobby to pick something else.
    await playOut();
    await expect(ann.locator('df-game-result')).toBeVisible();
    await ann.getByRole('button', { name: 'Change game' }).click();
    for (const page of [ann, bo]) {
      await expect(page.locator('df-room-table')).toHaveCount(0);
      await expect(page.locator('.code')).toHaveText(code);
    }
    await expect(bo.getByRole('button', { name: "I'm ready" })).toBeVisible();

    for (const page of [ann, bo]) await page.context().close();
  });
});
