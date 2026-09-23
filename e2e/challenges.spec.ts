import { expect, test, type Page } from '@playwright/test';
import { hasRealtimeBackend, newDevice } from './support';

/**
 * §7b async challenges.
 *
 * The first test runs against the production build on :4311, which is built with the committed
 * (keyless) environment — so challenges use the in-memory gateway and one device can be driven
 * end to end anywhere. The rest need a real project *and* the one migration in
 * `supabase/migrations/0001_challenges.sql`; until it's run the app says so and they skip.
 */
const LOCAL_ONLY = 'http://localhost:4311/';
async function openChallenges(page: Page): Promise<string | null> {
  await page.goto('/challenges');
  await page.getByRole('heading', { name: 'Start a challenge' }).waitFor();
  // Either the list loads or a notice explains why it can't; give the load a moment to say so.
  const notice = page.locator('.notice');
  await Promise.race([
    notice.first().waitFor({ timeout: 5_000 }).catch(() => undefined),
    page.locator('.list, .error').first().waitFor({ timeout: 5_000 }).catch(() => undefined),
  ]);
  return (await notice.count()) ? (await notice.first().innerText()).replace(/\s+/g, ' ') : null;
}

/** Fills in the form and starts it; returns the code from the URL. */
async function createChallenge(page: Page, name: string, days = 5, ante = 20): Promise<string> {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Days').fill(String(days));
  await page.getByLabel('Reps on the line, per day').fill(String(ante));
  await page.getByRole('button', { name: /Start it/ }).click();
  await page.waitForURL(/\/challenges\/[A-Z0-9]{6}/);
  return page.url().split('/').pop()!;
}

/**
 * One real Quick Start workout from wherever we are: Home, deal, log the task, end it. Uses the
 * in-app links only, so it works on the static PWA server too (no deep-link fallback there).
 */
async function doAWorkout(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Home', exact: true }).first().click();
  await page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: 'Start' }).click();
  await page.waitForURL(/\/play\//);
  await page.locator('button.flip').click(); // Deal
  await expect(page.locator('df-card-face').first()).toBeVisible();

  // The first card gives a task; logging it brings the flip button back as "Next".
  const done = page.getByRole('button', { name: 'Done', exact: true });
  await done.first().click();
  await expect(page.locator('button.flip')).toHaveText(/Next/);
  // "End" asks first (§9); accept, which saves the session and reports it (§7b).
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Workout (complete|ended)/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Done' }).click(); // back Home, in-app
}

test.describe('challenges', () => {
  test('put reps on the line, do a workout, and see the day land', async ({ browser }) => {
    test.setTimeout(120_000); // production build, a whole workout, and back again
    const page = await newDevice(browser);
    await page.goto(LOCAL_ONLY);
    await page.getByRole('link', { name: 'Challenges' }).click();
    await page.getByRole('heading', { name: 'Start a challenge' }).waitFor();
    // No keys in this build: the challenge lives in the browser, and says so.
    await expect(page.locator('.notice')).toContainText('No backend is configured');

    await createChallenge(page, 'Five day streak');
    await expect(page.getByRole('heading', { name: 'Five day streak' })).toBeVisible();
    // The terms are stated plainly, and the pot starts empty.
    await expect(page.locator('.terms')).toContainText('A workout every day');
    await expect(page.locator('.terms')).toContainText('20 reps a day on the line');
    await expect(page.locator('.pot')).toContainText('0');
    // One player — you — with a square per day, none of them missed yet.
    await expect(page.locator('.player')).toHaveCount(1);
    await expect(page.locator('.player .days li')).toHaveCount(5);
    await expect(page.locator('.player .days li[data-state="missed"]')).toHaveCount(0);

    // Home picks it up straight away, saying what today needs.
    await page.getByRole('link', { name: 'Home', exact: true }).first().click();
    await expect(page.locator('.challenges li')).toContainText('Five day streak');
    await expect(page.locator('.challenges li')).toContainText('Today still open');
    await expect(page.locator('.challenges li.done')).toHaveCount(0);

    await doAWorkout(page);

    // …and marks it off once it's done.
    await expect(page.locator('.challenges li')).toHaveCount(1);
    await expect(page.locator('.challenges li')).toContainText('Five day streak');
    await expect(page.locator('.challenges li.done')).toHaveCount(1);
    await expect(page.locator('.challenges li')).toContainText("Today's done");

    // Back to it the way a person would — all in-app, since with no backend the challenge is
    // only in this tab (a reload would lose it, which is what the notice says).
    await page.getByRole('link', { name: 'All challenges' }).click();
    await page.getByRole('link', { name: /Five day streak/ }).click();
    await expect(page.locator('.player .days li[data-state="made"]').first()).toBeVisible();
    await expect(page.locator('.player .who')).toContainText('1 made');
    await expect(page.locator('.player .who')).toContainText('clean');

    await page.context().close();
  });

  test('an unknown code says so', async ({ browser }) => {
    const page = await newDevice(browser);
    const notice = await openChallenges(page);
    test.skip(!!notice, `challenges aren't set up here: ${notice}`);

    await page.goto('/challenges/ZZZZZZ');
    await expect(page.getByRole('heading', { name: /No challenge ZZZZZZ/ })).toBeVisible();
    await page.context().close();
  });

  test('a friend joins with the code and both sides see the same board', async ({ browser }) => {
    test.skip(!hasRealtimeBackend(), 'needs supabaseUrl + supabaseKey in src/environments/environment.local.ts');
    const ann = await newDevice(browser);
    const bo = await newDevice(browser);

    const notice = await openChallenges(ann);
    test.skip(!!notice, `challenges aren't set up here: ${notice}`);
    const code = await createChallenge(ann, 'Two of us');
    await doAWorkout(ann);

    // Bo reads the terms before committing, then joins.
    await bo.goto(`/challenges/${code}`);
    await expect(bo.getByRole('heading', { name: 'Two of us' })).toBeVisible();
    await expect(bo.getByText(/looking at this one from the outside/)).toBeVisible();
    await bo.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(bo.locator('.player')).toHaveCount(2);

    // Ann's workout is on Bo's board, and Bo's empty day is on Ann's.
    await expect(bo.locator('.player', { hasText: '1 made' })).toHaveCount(1);
    await ann.goto(`/challenges/${code}`);
    await expect(ann.locator('.player')).toHaveCount(2);

    for (const page of [ann, bo]) await page.context().close();
  });
});
