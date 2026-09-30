import { expect, test } from '@playwright/test';
import { newDevice } from './support';

/** §9g: picking a shorter deck on Home means fewer cards are dealt, and the choice sticks. */
test('a shorter deck deals fewer cards', async ({ browser }) => {
  const page = await newDevice(browser);
  await page.goto('/');
  const quick = page.getByRole('region', { name: 'Quick start' });
  await expect(quick.getByText('The whole deck — every one of its 54 cards.')).toBeVisible();

  await quick.getByRole('radio', { name: '12', exact: true }).check();
  await expect(quick.getByText('12 of 54 cards, a share of every suit.')).toBeVisible();

  // Remembered on the device (meta.deckLength), like the intensity beside it.
  await page.reload();
  await expect(quick.getByRole('radio', { name: '12', exact: true })).toBeChecked();

  await quick.getByRole('button', { name: /^Start / }).click();
  await page.waitForURL(/\/play\//);
  await expect(page.locator('.progress')).toHaveText('0 done · 12 left in the deck');
});
