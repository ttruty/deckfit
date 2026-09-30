import { expect, test } from '@playwright/test';
import { newDevice } from './support';

/** §9e: the activity grid, and the day you open from it. */
test('a workout lands on the grid, and the day opens to show what was in it', async ({ browser }) => {
  const page = await newDevice(browser);

  // Nothing yet: no grid, just the empty state.
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible();
  await expect(page.locator('df-heatmap')).toHaveCount(0);

  // One real workout.
  await page.goto('/');
  await page.getByRole('region', { name: 'Quick start' }).getByRole('button', { name: /^Start / }).click();
  await page.waitForURL(/\/play\//);
  await page.locator('button.flip').click();
  const task = page.getByRole('region').filter({ has: page.getByRole('button', { name: 'Done', exact: true }) });
  const exercise = (await task.getByRole('heading').first().innerText()).trim();
  await page.getByRole('button', { name: 'Done', exact: true }).first().click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Workout (complete|ended)/ })).toBeVisible();
  await page.getByRole('link', { name: 'Done' }).click();

  // The grid has today, and says so in words.
  await page.goto('/history');
  await expect(page.locator('df-heatmap')).toBeVisible();
  await expect(page.locator('df-heatmap .df-bignum')).toHaveAttribute('aria-label', '1 day in a row');
  const today = page.locator('df-heatmap button.df-cell:not([data-l="0"])').last();
  await expect(today).toHaveAttribute('aria-label', /reps/);
  await expect(today).toHaveClass(/df-cell--today/);

  // The totals read for the window the control is set to.
  await expect(page.locator('.df-tiles')).toContainText('Workouts');
  await page.getByRole('radio', { name: 'Week', exact: true }).check();
  await expect(page.locator('.df-tiles')).toContainText('1');
  await expect(page.locator('.df-bars .df-bar')).toHaveCount(4); // every group, zeros included

  // Opening the day shows what was in it; the same square closes it again.
  await today.click();
  const detail = page.locator('df-day-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('1 workout');
  await expect(detail).toContainText('Solo Deal');
  await expect(detail).toContainText('Bodyweight deck');
  await expect(detail).toContainText(exercise); // the exercise actually logged
  await expect(today).toHaveAttribute('aria-pressed', 'true');

  await today.click();
  await expect(detail).toHaveCount(0);

  // A workout row opens its day too.
  await page.locator('.df-log').first().click();
  await expect(page.locator('df-day-detail')).toContainText('Solo Deal');
  await page.getByRole('button', { name: 'Close' }).click();

  // A day with nothing in it says so.
  const empty = page.locator('df-heatmap button.df-cell[data-l="0"]').first();
  await empty.click();
  await expect(page.locator('df-day-detail')).toContainText('Nothing logged that day');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('df-day-detail')).toHaveCount(0);

  await page.context().close();
});
