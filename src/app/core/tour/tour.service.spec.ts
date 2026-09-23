import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { provideTestDb } from '../../../testing/db';
import { MetaRepository } from '../db/repositories';
import { TOUR_STEPS } from './tour-steps';
import { TourService } from './tour.service';

/** Counts openings without rendering the dialog (the CDK overlay isn't the thing under test). */
class FakeDialog {
  opened = 0;
  open() {
    this.opened++;
    return { afterClosed: () => of(undefined) };
  }
}

describe('TourService', () => {
  let dialog: FakeDialog;

  beforeEach(() => {
    dialog = new FakeDialog();
    provideTestDb();
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: dialog }] });
  });

  const tour = () => TestBed.inject(TourService);
  const meta = () => TestBed.inject(MetaRepository);

  it('opens on a first launch, and never again by itself', async () => {
    await tour().maybeOpenOnFirstRun();
    expect(dialog.opened).toBe(1);
    expect(await tour().seenAt()).toBeGreaterThan(0);

    await tour().maybeOpenOnFirstRun();
    expect(dialog.opened).toBe(1);
  });

  it('stays shut when it has been turned off', async () => {
    await tour().setEnabled(false);
    await tour().maybeOpenOnFirstRun();
    expect(dialog.opened).toBe(0);
    expect(await tour().enabled()).toBe(false);
  });

  it('turning it back on offers it again next launch', async () => {
    await tour().maybeOpenOnFirstRun();
    expect(dialog.opened).toBe(1);

    await tour().setEnabled(true);
    await tour().maybeOpenOnFirstRun();
    expect(dialog.opened).toBe(2);
  });

  it('opening it from Settings counts as seen', async () => {
    await meta().set('tourSeenAt', 0);
    await tour().open();
    expect(dialog.opened).toBe(1);
    expect(await tour().seenAt()).toBeGreaterThan(0);
  });

  it('has a handful of short, plain steps', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(6);
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeLessThanOrEqual(40);
      expect(step.body.length).toBeLessThanOrEqual(200);
      expect(step.icon).toBeTruthy();
    }
    // Every step earns its place: no two say the same thing.
    expect(new Set(TOUR_STEPS.map((s) => s.title)).size).toBe(TOUR_STEPS.length);
  });
});
