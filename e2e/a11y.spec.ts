import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { newDevice } from './support';

/** WCAG 2 A/AA rules, on the tags axe maps them to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.map((v) => `${v.id} (${v.impact}) — ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(' ')}`);
}

/** Pins the theme the way the toolbar's theme button does. */
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe('accessibility (axe, WCAG 2.1 AA)', () => {
  test.describe.configure({ timeout: 180_000 }); // a dozen axe passes per theme
  for (const theme of ['light', 'dark'] as const) {
    test(`core screens have no violations in ${theme} theme`, async ({ browser }) => {
      const page = await newDevice(browser, { keepDisclaimer: true });
      const problems: Record<string, string[]> = {};

      // Accept the §12 notice first; it's scanned on its own below, once it has settled.
      await page.goto('/');
      await page.getByRole('button', { name: 'I understand' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.waitForTimeout(300); // let the acceptance reach Dexie before navigating

      for (const [name, path] of [
        ['home', '/'], ['library', '/library'], ['decks', '/decks'], ['games', '/games'], ['history', '/history'],
        ['settings', '/settings'], ['game builder', '/games/new'], ['exercise editor', '/library/new'], ['routine editor', '/routines/new'],
      ] as const) {
        await page.goto(path);
        await page.locator('h1').first().waitFor();
        await setTheme(page, theme);
        const found = await scan(page);
        if (found.length) problems[name] = found;
      }

      // The card-heavy screens: a deck editor and a live workout.
      await page.goto('/decks');
      await page.locator('li.deck', { hasText: 'Bodyweight' }).getByRole('button', { name: /Duplicate to edit/ }).click();
      await page.waitForURL(/\/decks\/deck-.*\/edit/);
      await page.locator('button.card-button').first().waitFor();
      await setTheme(page, theme);
      const deckEditor = await scan(page);
      if (deckEditor.length) problems['deck editor'] = deckEditor;

      await page.goto('/');
      await page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: 'Start' }).click();
      await page.waitForURL(/\/play\//);
      await page.locator('button.flip').click();
      await page.locator('df-card-face').first().waitFor();
      await setTheme(page, theme);
      const play = await scan(page);
      if (play.length) problems['play'] = play;

      // The safety notice, in its own right (scanned after the open animation).
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Read the safety notice' }).click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(500);
      await setTheme(page, theme);
      const dialog = await scan(page);
      if (dialog.length) problems['safety notice'] = dialog;

      expect(problems).toEqual({});
      await page.context().close();
    });
  }
});
