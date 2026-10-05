import { expect, test } from '@playwright/test';
import { newDevice } from './support';

/** §10: the two ways to clear this device, driven the way a worried user would. */
test('clearing the history, then erasing the device back to a fresh install', async ({ browser }) => {
  const page = await newDevice(browser);

  // Something worth losing: a workout in the history and a name on the device.
  await page.goto('/');
  await page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: /^Start / }).click();
  await page.waitForURL(/\/play\//);
  await page.locator('button.flip').click();
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await page.getByRole('link', { name: 'Done' }).click();

  await page.goto('/settings');
  await page.getByRole('textbox', { name: 'Display name' }).fill('Robin');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Name saved')).toBeVisible();
  await page.goto('/history');
  await expect(page.locator('df-heatmap')).toBeVisible();

  // Clearing the history takes the workouts and nothing else.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Clear workout history' }).click();
  const clear = page.getByRole('dialog', { name: /Clear your workout history/ });
  await expect(clear).toContainText('1 saved workout');
  await clear.getByRole('button', { name: 'Clear history' }).click();
  await expect(page.getByText(/Cleared 1 workout/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Robin');

  // Erasing everything takes two taps on purpose.
  await page.getByRole('button', { name: 'Erase everything' }).click();
  const erase = page.getByRole('dialog', { name: /Erase everything on this device/ });
  await expect(erase).toContainText('This can’t be undone.');
  await erase.getByRole('button', { name: 'Erase everything' }).click();
  await erase.getByRole('button', { name: 'Yes, erase everything' }).click();
  await expect(page.getByText(/This device is erased/)).toBeVisible();

  // The name is gone and the built-in content is back, with no reload.
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('');
  await page.goto('/decks');
  await expect(page.locator('li.deck', { hasText: 'Bodyweight' })).toBeVisible();
  await page.goto('/history');
  await expect(page.getByText('Nothing here yet')).toBeVisible();
});
