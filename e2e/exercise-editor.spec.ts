import { expect, test } from '@playwright/test';
import { newDevice } from './support';

test('create an exercise with poses and a prop, then put it on a deck card', async ({ browser }) => {
  const page = await newDevice(browser);
  await page.goto('/library');
  await page.getByRole('link', { name: 'New exercise' }).click();
  await page.getByRole('heading', { name: 'New exercise' }).waitFor();

  await page.getByLabel('Name', { exact: true }).fill('Doorway band row');
  await page.getByLabel('Description').fill('Row a band anchored in front of you.');
  await page.getByRole('button', { name: 'Add cue' }).click();
  await page.getByRole('textbox', { name: 'Cue 1' }).fill('Squeeze the shoulder blades');
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Resistance band' }).click();
  await page.getByRole('option', { name: 'Back', exact: true }).click(); // muscle chip
  await page.getByRole('option', { name: 'Arms', exact: true }).click();

  // Poses come from a visual grid of poses.json.
  await page.getByRole('button', { name: 'Choose start pose' }).click();
  await page.getByRole('dialog').getByRole('heading', { name: 'Start pose' }).waitFor();
  await page.getByLabel('Search poses').fill('lean');
  await page.locator('[data-pose="lean-fwd"]').click();
  await page.getByRole('button', { name: 'Use this pose' }).click();
  await expect(page.locator('[data-pose-slot="start"]')).toHaveText('Lean fwd');

  await page.getByRole('button', { name: 'Choose end pose' }).click();
  await page.locator('[data-pose="lean-row"]').click();
  await page.getByRole('button', { name: 'Use this pose' }).click();
  await expect(page.locator('[data-pose-slot="end"]')).toHaveText('Lean row');

  // A prop the figure draws; it also joins the equipment list.
  await page.getByRole('combobox', { name: 'Equipment in the picture' }).click();
  await page.getByRole('option', { name: 'Resistance band' }).click();
  await page.getByRole('combobox', { name: 'Band anchored' }).click();
  await page.getByRole('option', { name: 'In front' }).click();
  await expect(page.getByRole('option', { name: 'Band', exact: true })).toHaveAttribute('aria-selected', 'true');
  // The band is drawn in the preview (a dashed path; a straight one can have a zero-height box,
  // so check the geometry rather than visibility).
  await expect.poll(async () => (await page.locator('aside.preview df-exercise-figure svg .prop.dashed').first().getAttribute('d'))?.length ?? 0)
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Save exercise' }).click();
  await page.waitForURL(/\/library\/exercise-/);
  await expect(page.getByRole('heading', { name: 'Doorway band row' })).toBeVisible();
  await expect(page.getByText('Squeeze the shoulder blades')).toBeVisible();

  // It shows up in the library, tagged as yours.
  await page.goto('/library');
  await page.getByLabel('Search exercises').fill('Doorway');
  const tile = page.locator('df-exercise-tile').filter({ hasText: 'Doorway band row' });
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText('Yours');

  // And it can be put on a card in the deck editor.
  await page.goto('/decks');
  await page.locator('li.deck', { hasText: 'Bodyweight' }).getByRole('button', { name: /Duplicate to edit/ }).click();
  await page.waitForURL(/\/decks\/deck-.*\/edit/);
  await page.locator('button.card-button').first().click();
  await page.getByRole('dialog').getByLabel('Search').fill('Doorway');
  // The picker starts filtered to the deck's category and the suit's muscle groups; it offers the rest.
  await page.getByRole('button', { name: /show all/ }).click();
  const option = page.getByRole('option', { name: /Doorway band row/ });
  await expect(option).toContainText('Yours');
  await option.click();
  await page.getByRole('button', { name: 'Use this exercise' }).click();
  await expect(page.locator('button.card-button').first()).toContainText('Doorway band row');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText('Deck saved')).toBeVisible();
  // The card keeps the exercise after a reload: it's in Dexie, not just on screen.
  await page.reload();
  await expect(page.locator('button.card-button').first()).toContainText('Doorway band row');
  await page.context().close();
});
