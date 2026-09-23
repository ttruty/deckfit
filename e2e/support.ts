import { existsSync, readFileSync } from 'node:fs';
import { expect, type Browser, type Page } from '@playwright/test';

/** True when environment.local.ts has a Supabase URL and key (multiplayer specs need a real backend). */
export function hasRealtimeBackend(): boolean {
  const file = 'src/environments/environment.local.ts';
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  const value = (k: string) => text.match(new RegExp(`${k}\\s*:\\s*['"\`]([^'"\`]+)`))?.[1];
  return !!value('supabaseUrl') && !!value('supabaseKey');
}

/**
 * A fresh device: its own context (IndexedDB, device id). The §12 safety notice appears on every
 * fresh device, so it's accepted automatically (and the §12a guide behind it is skipped) —
 * `settings.spec.ts` covers the notice and the guide themselves.
 * `phone: true` gives a 390×844 touch viewport, for checking layouts that only stack there.
 */
export async function newDevice(browser: Browser, opts: { keepDisclaimer?: boolean; phone?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext(
    opts.phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1100, height: 900 } },
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
  if (!opts.keepDisclaimer) {
    await page.addLocatorHandler(page.getByRole('button', { name: 'I understand' }), async (button) => button.click());
    // §12a: the welcome guide follows the notice on a fresh device. Specs that aren't about it
    // wave it away — scoped to df-tour, since "Skip" is also a button on the task panel.
    await page.addLocatorHandler(page.locator('df-tour').getByRole('button', { name: 'Skip' }), async (button) => button.click());
  }
  return page;
}

export async function playersOn(page: Page): Promise<string[]> {
  return (await page.locator('.players li .name').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

export async function expectPlayers(page: Page, names: string[]): Promise<void> {
  await expect.poll(() => playersOn(page)).toEqual(names);
}

/** Creates a room from /room/new. With keepCurrentPage the caller already navigated (e.g. with ?seed=) and picked a routine. */
export async function createRoom(page: Page, name: string, opts: { keepCurrentPage?: boolean } = {}): Promise<string> {
  if (!opts.keepCurrentPage) await page.goto('/room/new');
  await page.getByRole('button', { name: 'Create room' }).waitFor();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]{6}(\?.*)?$/);
  await page.locator('.code').waitFor();
  return (await page.locator('.code').innerText()).trim();
}

/**
 * Joins and takes a name. `seenBy` waits until that device shows the new name: a rename travels
 * as presence, which can land after the ready broadcast, and the host snapshots names when it
 * starts the game — so a test that starts straight away can otherwise race it.
 */
export async function joinRoom(page: Page, code: string, name: string, opts: { seenBy?: Page } = {}): Promise<void> {
  await page.goto(`/room/${code}`);
  await page.locator('.players li').first().waitFor();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.locator('.players li', { hasText: name })).toBeVisible();
  if (opts.seenBy) await expect(opts.seenBy.locator('.players li', { hasText: name })).toBeVisible();
}
