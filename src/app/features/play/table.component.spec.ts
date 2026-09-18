import { TestBed } from '@angular/core/testing';
import { seedContent } from '../../core/db/seed-content';
import { SessionRepository } from '../../core/db/repositories';
import { providePoses } from '../../../testing/content';
import { provideFakeClock } from '../../../testing/fake-clock';
import { loadContent, provideTestDb } from '../../../testing/db';
import { QUICK_START, SessionLauncher } from './session-launcher.service';
import { TableComponent } from './table.component';

const settle = async (fixture: { whenStable(): Promise<unknown> }) => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
  }
};

describe('TableComponent', () => {
  beforeEach(async () => {
    const db = provideTestDb();
    provideFakeClock();
    providePoses();
    await seedContent(db, loadContent());
  });

  it('renders the deal button, then a card and a task panel with big Done/Skip controls', async () => {
    const id = await TestBed.inject(SessionLauncher).start(QUICK_START);
    const sessions = TestBed.inject(SessionRepository);
    await sessions.save({ ...(await sessions.get(id))!, seed: 7 });

    const fixture = TestBed.createComponent(TableComponent);
    fixture.componentRef.setInput('sessionId', id);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const deal = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Deal'))!;
    expect(deal).toBeDefined();
    expect(el.querySelector('df-draw-pile .count')?.textContent?.trim()).toBe('54');

    deal.click();
    await settle(fixture);
    expect(el.querySelectorAll('df-card-face')).toHaveLength(1);
    expect(el.querySelector('#task-title')?.textContent?.trim()).toBeTruthy();
    const labels = [...el.querySelectorAll('.panel.task button')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining([expect.stringContaining('Skip'), expect.stringContaining('Done')]));
    expect(el.querySelector('.sr-only[aria-live]')?.textContent).toMatch(/Your task/);
  });
});
