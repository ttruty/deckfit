import { TestBed } from '@angular/core/testing';
import { seedContent } from '../../core/db/seed-content';
import { providePoses } from '../../../testing/content';
import { loadContent, provideTestDb } from '../../../testing/db';
import { ExerciseDetailComponent } from './exercise-detail.component';
import { LibraryComponent } from './library.component';
import { LibraryStore } from './library.store';

/** Waits for Dexie-backed resources to resolve and the view to settle. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 10));
    await fixture.whenStable();
  }
}

describe('Library (reads from Dexie)', () => {
  beforeEach(async () => {
    const db = provideTestDb();
    providePoses();
    await seedContent(db, loadContent());
  });

  it('lists every seeded exercise as a tile with a figure, and filters', async () => {
    const fixture = TestBed.createComponent(LibraryComponent);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('df-exercise-tile')).toHaveLength(120);
    expect(el.querySelectorAll('df-exercise-tile svg.ex-figure')).toHaveLength(120);
    expect(el.querySelector('.count')?.textContent).toContain('120 of 120');

    TestBed.inject(LibraryStore).patch({ category: 'kettlebell', measure: 'seconds' });
    await settle(fixture);
    const expected = loadContent().exercises.exercises.filter((e) => e.category === 'kettlebell' && e.measure === 'seconds');
    expect(expected.length).toBeGreaterThan(0);
    const names = [...el.querySelectorAll('df-exercise-tile .name')].map((n) => n.textContent?.trim());
    expect(names.sort()).toEqual(expected.map((e) => e.name).sort());
    expect(el.querySelector('.count')?.textContent).toContain(`${expected.length} of 120`);
    TestBed.inject(LibraryStore).reset();
  });

  it('shows the detail page with cues and the decks that use the exercise', async () => {
    const fixture = TestBed.createComponent(ExerciseDetailComponent);
    fixture.componentRef.setInput('exerciseId', 'bw-air-squat');
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Air Squat');
    expect(el.querySelector('svg.ex-figure')).not.toBeNull();
    expect([...el.querySelectorAll('.cues li')].map((li) => li.textContent?.trim())).toEqual(['Heels stay down', 'Knees track over toes']);
    expect(el.querySelector('.decks a')?.textContent).toBe('Bodyweight deck');
    expect(el.querySelector('.decks .where')?.textContent).toContain('Legs — 2 3 4 5');
  });

  it('says so when the exercise does not exist', async () => {
    const fixture = TestBed.createComponent(ExerciseDetailComponent);
    fixture.componentRef.setInput('exerciseId', 'nope');
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent).toContain("doesn't exist");
  });
});
