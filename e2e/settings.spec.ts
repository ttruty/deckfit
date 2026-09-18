import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { newDevice } from './support';

test('first-run safety notice, saved preferences, and an export/import round trip', async ({ browser }) => {
  const page = await newDevice(browser, { keepDisclaimer: true });

  // §12: the notice appears on first run and can't be dismissed without accepting.
  await page.goto('/');
  const notice = page.getByRole('dialog', { name: 'Before you start' });
  await expect(notice).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'I understand' }).click();
  await expect(notice).toHaveCount(0);

  // It doesn't come back.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Quick start' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Before you start' })).toHaveCount(0);

  // Preferences are stored on the device (Dexie), so they survive a reload.
  await page.goto('/settings');
  await page.getByRole('textbox', { name: 'Display name' }).fill('Robin');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('radio', { name: /^Dark/ }).check();
  await page.getByRole('switch', { name: /Beeps/ }).click(); // off
  await expect(page.getByRole('switch', { name: /Beeps/ })).not.toBeChecked();
  await page.waitForTimeout(300);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset['theme'])).toBe('dark');

  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset['theme'])).toBe('dark');
  await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue('Robin');
  await expect(page.getByRole('switch', { name: /Beeps/ })).not.toBeChecked();
  await expect(page.getByText(/You accepted the safety notice on/)).toBeVisible();

  // Make something worth exporting, then export it.
  await page.goto('/decks');
  await page.locator('li.deck', { hasText: 'Bodyweight' }).getByRole('button', { name: /Duplicate to edit/ }).click();
  await page.waitForURL(/\/decks\/deck-.*\/edit/);
  await page.getByRole('textbox', { name: 'Deck name' }).fill('My mixtape');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText('Deck saved')).toBeVisible();

  await page.goto('/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  const file = (await download.path())!;
  const bundle = JSON.parse(readFileSync(file, 'utf8'));
  expect(bundle.format).toBe('deckfit-bundle');
  expect(bundle.decks.map((d: { name: string }) => d.name)).toContain('My mixtape');

  // A fresh device can import it.
  const other = await newDevice(browser, { keepDisclaimer: true });
  await other.goto('/');
  await other.getByRole('button', { name: 'I understand' }).click();
  await other.goto('/settings');
  await other.locator('input[type="file"]').setInputFiles(file);
  await expect(other.getByText(/Imported \d+ new/)).toBeVisible();
  await other.goto('/decks');
  await expect(other.locator('li.deck', { hasText: 'My mixtape' })).toHaveCount(1);

  // A file that isn't a bundle is reported, not swallowed.
  await other.goto('/settings');
  await other.locator('input[type="file"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":true}') });
  await expect(other.getByRole('alert')).toContainText(/couldn't be imported/i);

  await page.context().close();
  await other.context().close();
});

test('the install banner appears when the browser offers a prompt, and can be waved away', async ({ browser }) => {
  const page = await newDevice(browser);
  await page.goto('/');
  await expect(page.locator('[data-install-banner]')).toHaveCount(0); // nothing offered yet

  // Chrome fires this once the app meets the install criteria; simulate it.
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    Object.assign(event, {
      prompt: async () => void ((window as unknown as { prompted?: boolean }).prompted = true),
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
  });

  const banner = page.locator('[data-install-banner]');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBeUndefined();

  // It stays away on the next visit, and Settings can bring it back.
  await page.reload();
  await expect(page.locator('[data-install-banner]')).toHaveCount(0);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Show the install prompt again' }).click();
  await page.goto('/');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt: async () => undefined, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    window.dispatchEvent(event);
  });
  await expect(page.locator('[data-install-banner]')).toBeVisible();
  await page.context().close();
});
