import { expect, test, type Page } from '@playwright/test';

/** The production build with the service worker (see playwright.config.ts). */
const PWA_URL = 'http://localhost:4311/';

/**
 * Resolves once the service worker controls this page *and* has cached the shell and the content
 * JSON — an uncached request would go to the network, which is exactly what we're about to cut.
 */
async function serviceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }
  });
  await page.waitForFunction(
    async () => {
      const wanted = ['/index.html', '/assets/content/games.json', '/assets/content/exercises.json', '/assets/content/decks.json'];
      const names = await caches.keys();
      const found = new Set<string>();
      for (const name of names) {
        const cache = await caches.open(name);
        for (const url of wanted) if (await cache.match(url)) found.add(url);
      }
      return wanted.every((url) => found.has(url));
    },
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('offline solo play (production build + service worker)', () => {
  test('install, go offline, and run a Quick Start workout', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
    await page.addLocatorHandler(page.getByRole('button', { name: 'I understand' }), async (button) => button.click());

    // First visit: the service worker installs and prefetches the shell and content.
    await page.goto(PWA_URL);
    const quickStart = page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: 'Start' });
    await quickStart.waitFor();
    await serviceWorkerReady(page);
    // Load once more while online: this visit is served by the worker, which is the state a
    // returning user is in (and ngsw answers 504 for a navigation it hasn't taken over yet).
    await page.reload();
    await quickStart.waitFor();
    await serviceWorkerReady(page);

    // Pull the plug: nothing may reach the network from here on.
    await context.setOffline(true);
    await page.reload();
    await expect(quickStart).toBeVisible();

    // A whole solo workout: deal, flip, log a task.
    await quickStart.click();
    await page.waitForURL(/\/play\//);
    await page.locator('button.flip').click(); // "Deal"
    await expect(page.locator('df-card-face').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('button.flip')).toHaveText(/Next/);

    // The library and its figures work offline too (content came from the cache, not the network).
    await page.goto(`${PWA_URL}library`);
    await expect(page.locator('df-exercise-tile').first()).toBeVisible();
    await expect(page.locator('df-exercise-tile svg').first()).toBeVisible();

    // Rooms need the network: the app says so instead of hanging.
    await page.goto(`${PWA_URL}room/new`);
    await expect(page.getByRole('button', { name: 'Create room' })).toBeVisible();

    await context.setOffline(false);
    await context.close();
  });
});
