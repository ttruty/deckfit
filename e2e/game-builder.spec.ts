import { expect, test, type Locator, type Page } from '@playwright/test';
import { newDevice } from './support';

/** CDK drag-drop needs real pointer moves: press, nudge past the threshold, glide, release. */
async function drag(page: Page, source: Locator, target: Locator, where: 'top' | 'bottom' = 'bottom') {
  await source.scrollIntoViewIfNeeded();
  const s = (await source.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 10, s.y + s.height / 2 + 10, { steps: 5 });
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  const t = (await target.boundingBox())!;
  const y = where === 'top' ? t.y + 12 : t.y + t.height - 12;
  await page.mouse.move(t.x + t.width / 2, y, { steps: 25 });
  await page.waitForTimeout(100);
  await page.mouse.up();
}

test('build a game with nested blocks, see errors pinned, expose a setting, dry run, save, and play it', async ({ browser }) => {
  const page = await newDevice(browser);
  await page.goto('/games');
  await page.getByRole('link', { name: 'New game' }).click();
  await page.getByRole('heading', { name: 'New game' }).waitFor();
  await page.getByLabel('Name', { exact: true }).fill('Plank Party');

  const turn = page.locator('[data-list="slot:turn.steps"]');
  await expect(turn.locator('> article')).toHaveCount(2); // Flip, Assign

  // Palette → turn steps: an if/then/else block.
  await drag(page, page.locator('[data-palette="if"]'), turn);
  await expect(turn.locator('> article').last()).toHaveAttribute('data-kind', 'if');
  const ifBlock = turn.locator('> article[data-kind="if"]');

  // Existing block → nested branch: move "Assign exercise" into the if's Then list by its handle.
  const then = ifBlock.locator('[data-list$=":then"]');
  await drag(page, turn.locator('> article[data-kind="assign"]').getByRole('button', { name: 'Drag to move' }), then);
  await expect(turn.locator('> article')).toHaveCount(2);
  await expect(then.locator('> article[data-kind="assign"]')).toHaveCount(1);

  // Condition: only when the table has at least one card.
  await ifBlock.getByRole('combobox', { name: /^If/ }).first().selectOption('count');

  // A bad value in a nested block is pinned to that block, and blocks saving.
  await then.getByRole('button', { name: /^Add step/ }).click();
  await page.getByRole('menuitem', { name: 'Cards' }).click();
  await page.getByRole('menuitem', { name: 'Deal' }).click();
  const deal = then.locator('> article[data-kind="deal"]');
  await deal.getByRole('spinbutton', { name: /^Cards/ }).fill('-3');
  await expect(deal.locator('.problems')).toContainText('count: Too small');
  await expect(ifBlock.locator('> .problems')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '1 problem' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Run 20 turns/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Save game' }).click();
  await expect(page).toHaveURL(/\/games\/new$/);

  await deal.getByRole('spinbutton', { name: /^Cards/ }).fill('1');
  await expect(deal.locator('.problems')).toHaveCount(0);
  await expect(page.getByText('Ready to play')).toBeVisible();

  // Expose the deal count as a routine setting.
  await deal.getByRole('button', { name: 'Make Cards adjustable in routines' }).click();
  const setting = page.locator('[data-setting="cards"]');
  await expect(setting).toContainText('used in 1 place');
  await setting.getByRole('textbox', { name: /^Label/ }).fill('Extra cards per turn');
  await expect(deal.getByRole('combobox', { name: /^Cards/ })).toHaveValue('cards');

  // Dry run: 20 seeded turns through the engine, with the estimate and the log.
  await page.getByRole('button', { name: 'Run 20 turns' }).click();
  await expect(page.locator('[data-stat="time"]')).not.toHaveText('0 s');
  const log = page.locator('ol.log li');
  await expect(log.filter({ hasText: 'Flipped' })).toHaveCount(20);
  const first = await page.locator('ol.log').innerText();
  await page.getByRole('button', { name: 'Run 20 turns' }).click();
  expect(await page.locator('ol.log').innerText()).toBe(first); // same seed, same game

  await page.getByRole('button', { name: 'Save game' }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole('region', { name: 'Your games' }).getByRole('heading', { name: 'Plank Party' })).toBeVisible();

  // The saved game is a normal game: make a routine with it and play a card.
  await page.goto('/routines/new');
  await page.getByRole('radio', { name: /Plank Party/ }).check();
  await expect(page.getByLabel('Extra cards per turn')).toHaveValue('1');
  await page.getByRole('button', { name: /Save & start/ }).click();
  await page.waitForURL(/\/play\//);
  await page.locator('button.flip').click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

  // Editing it later reopens the same blocks.
  await page.goto('/games');
  await page.locator('li.game', { hasText: 'Plank Party' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit game' })).toBeVisible();
  await expect(page.locator('[data-list="slot:turn.steps"] > article[data-kind="if"] [data-list$=":then"] > article')).toHaveCount(2);
  await page.context().close();
});
