import { TestBed } from '@angular/core/testing';
import { seedContent } from '../../core/db/seed-content';
import { loadContent, provideTestDb } from '../../../testing/db';
import { RoomRoutineService } from './room-routine.service';

describe('RoomRoutineService.build', () => {
  let service: RoomRoutineService;

  beforeEach(async () => {
    const db = provideTestDb();
    TestBed.configureTestingModule({});
    await seedContent(db, loadContent());
    service = TestBed.inject(RoomRoutineService);
  });

  it('the host’s intensity and deck length travel with the room routine (§9g)', async () => {
    const source = await service.defaultRoutine();
    const room = await service.build(source, { intensity: 'high', cardCount: 20 });
    expect(room.routine.settings.intensity).toBe('high');
    expect(room.routine.deckFilters).toEqual({ cardCount: 20 });
    // The preview counts the cards everyone will actually play with.
    expect(room.preview.cardCount).toBe(20);
  });

  it('a new length replaces the routine’s, and the whole deck clears it', async () => {
    const carries = async (cardCount: number | null) =>
      (await service.build({ ...(await service.defaultRoutine()), deckFilters: { cardCount: 12, maxDifficulty: 3 } }, { cardCount }))
        .routine.deckFilters;
    expect(await carries(32)).toEqual({ maxDifficulty: 3, cardCount: 32 });
    expect(await carries(null)).toEqual({ maxDifficulty: 3 });
  });

  it('leaves the routine alone when no length is given', async () => {
    const source = { ...(await service.defaultRoutine()), deckFilters: { cardCount: 12 } };
    const room = await service.build(source);
    expect(room.routine.deckFilters).toEqual({ cardCount: 12 });
    expect(room.preview.cardCount).toBe(12);
  });
});
