import { TestBed } from '@angular/core/testing';
import { AudioCueService } from '../../core/audio/audio-cue.service';
import { SessionRepository } from '../../core/db/repositories';
import { seedContent } from '../../core/db/seed-content';
import { simulate } from '../../domain/engine/dsl/simulate';
import { hashState } from '../../domain/engine/hash';
import { provideFakeClock, type FakeClock } from '../../../testing/fake-clock';
import { loadContent, provideTestDb } from '../../../testing/db';
import { PlayStore } from './play.store';
import { QUICK_START, SessionLauncher } from './session-launcher.service';

/** Lets loopback microtasks and Dexie writes settle. */
const settle = async (store?: PlayStore) => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  await store?.flushed();
};

describe('PlayStore', () => {
  let clock: FakeClock;

  beforeEach(async () => {
    const db = provideTestDb();
    clock = provideFakeClock();
    TestBed.configureTestingModule({ providers: [PlayStore] });
    await seedContent(db, loadContent());
  });

  const newStore = () => TestBed.runInInjectionContext(() => new PlayStore());

  /** Launches and pins the seed (the launcher picks a random one) so tests are deterministic. */
  async function startQuick(opts = QUICK_START, seed = 2026) {
    const id = await TestBed.inject(SessionLauncher).start(opts);
    const sessions = TestBed.inject(SessionRepository);
    await sessions.save({ ...(await sessions.get(id))!, seed });
    const store = newStore();
    await store.load(id);
    await settle(store);
    return { id, store };
  }

  /** Plays like simulate(): complete each pending task at its amount, else flip. */
  async function playToEnd(store: PlayStore) {
    for (let guard = 0; guard < 400 && !store.finished(); guard++) {
      if (store.currentTask()) store.complete();
      else store.flip();
      await settle();
    }
    await settle(store);
  }

  it('deals automatically on load and shows the first card after a flip', async () => {
    const { store } = await startQuick();
    expect(store.status()).toBe('ready');
    expect(store.phase()).toBe('playing');
    expect(store.canFlip()).toBe(true);
    store.flip();
    await settle();
    expect(store.tableCards()).toHaveLength(1);
    expect(store.currentTask()?.task.status).toBe('pending');
    expect(store.announcement()).toMatch(/^Your task: /);
    expect(store.canFlip()).toBe(false);
  });

  it('a full solo-deal game produces exactly the engine’s event log and saves the session', async () => {
    const { id, store } = await startQuick();
    await playToEnd(store);
    expect(store.finished()).toBe(true);

    const saved = (await TestBed.inject(SessionRepository).get(id))!;
    expect(saved.outcome).toBe('finished');
    expect(saved.endedAt).toBeGreaterThanOrEqual(saved.startedAt); // fake clock does not advance here
    expect(saved.log.at(-1)).toMatchObject({ type: 'GameOver' });

    const content = loadContent();
    const def = content.games.games.find((g) => g.id === 'solo-deal')!;
    const expected = simulate({
      def, deck: saved.deck, exercises: content.exercises.exercises, settings: saved.settings, seed: saved.seed, players: [saved.players[0].id],
    });
    expect(saved.log).toEqual(expected.events);
    expect(saved.totals).toEqual(expected.state.totals);
    expect(store.summary()).toMatchObject({ outcome: 'finished', tasks: 54 });
  });

  it('resumes an interrupted session by replaying its intents', async () => {
    const { id, store } = await startQuick();
    store.flip();
    await settle();
    store.complete(3);
    await settle();
    store.flip();
    await settle(store);
    const before = hashState(store.state());
    store.ngOnDestroy();

    const resumed = newStore();
    await resumed.load(id);
    await settle(resumed);
    expect(hashState(resumed.state())).toBe(before);
    expect(resumed.currentTask()).not.toBeNull();
    resumed.complete();
    await settle(resumed);
    expect((await TestBed.inject(SessionRepository).get(id))!.intents).toHaveLength(5);
  });

  it('timed tasks: countdown beeps 3-2-1 and auto-completes; Done mid-countdown logs elapsed seconds', async () => {
    const { store } = await startQuick();
    const beeps = vi.spyOn(TestBed.inject(AudioCueService), 'play');
    // Advance until a timed task comes up.
    for (let i = 0; i < 200 && store.currentTask()?.task.measure !== 'seconds'; i++) {
      if (store.currentTask()) store.complete();
      else store.flip();
      await settle();
    }
    const first = store.currentTask()!;
    expect(first.task.measure).toBe('seconds');

    store.startTaskTimer();
    clock.advance(first.task.amount * 1000 + 300);
    await settle(store);
    expect(beeps.mock.calls.filter(([c]) => c === 'tick')).toHaveLength(3);
    const done = store.state()!.tasks.find((t) => t.id === first.task.id)!;
    expect(done.status).toBe('done');
    expect(Object.values(store.state()!.totals[store.me()]).length).toBeGreaterThan(0);

    for (let i = 0; i < 200 && store.currentTask()?.task.measure !== 'seconds'; i++) {
      if (store.currentTask()) store.complete();
      else store.flip();
      await settle();
    }
    const second = store.currentTask()!;
    const totalsBefore = store.state()!.totals[store.me()][second.task.exerciseId!] ?? 0;
    store.startTaskTimer();
    clock.advance(7_200);
    store.complete();
    await settle(store);
    expect(store.state()!.totals[store.me()][second.task.exerciseId!]).toBe(totalsBefore + 7);
  });

  it('a time cap ends the game after the current task', async () => {
    const { store } = await startQuick({ ...QUICK_START, settings: { timeLimitSec: 60 } });
    expect(store.engineTimers().map((t) => t.remaining)).toEqual([60]);
    store.flip();
    await settle();
    clock.advance(61_000);
    await settle();
    expect(store.finished()).toBe(false); // task in progress
    store.complete();
    await settle(store);
    expect(store.finished()).toBe(true);
    expect(store.summary()?.outcome).toBe('finished');
  });

  it('abandoning saves progress with outcome "abandoned" and blocks further intents', async () => {
    const { id, store } = await startQuick();
    store.flip();
    await settle();
    store.complete();
    await settle();
    await store.abandon();
    const saved = (await TestBed.inject(SessionRepository).get(id))!;
    expect(saved.outcome).toBe('abandoned');
    expect(Object.keys(saved.totals[saved.players[0].id])).toHaveLength(1);
    store.flip();
    await settle();
    expect(store.tableCards()).toHaveLength(1);
  });

  it('reports a missing session', async () => {
    const store = newStore();
    await store.load('nope');
    expect(store.status()).toBe('error');
  });
});

describe('PlayStore wild jokers', () => {
  let clock: FakeClock;

  beforeEach(async () => {
    const db = provideTestDb();
    clock = provideFakeClock();
    void clock;
    TestBed.configureTestingModule({ providers: [PlayStore] });
    await seedContent(db, loadContent());
  });

  it('logs a wild joker under the exercise the player names', async () => {
    const id = await TestBed.inject(SessionLauncher).start({ ...QUICK_START, settings: { jokerRule: 'wild' } });
    const sessions = TestBed.inject(SessionRepository);
    const session = (await sessions.get(id))!;
    await sessions.save({ ...session, seed: 2026 });
    const store = TestBed.runInInjectionContext(() => new PlayStore());
    await store.load(id);
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    // Play until a joker comes up (wild tasks have no exercise of their own).
    for (let guard = 0; guard < 200 && store.currentTask()?.task.kind !== 'wild'; guard++) {
      if (store.currentTask()) store.complete();
      else store.flip();
      for (let i = 0; i < 2; i++) await new Promise((r) => setTimeout(r, 0));
    }
    const wild = store.currentTask();
    expect(wild?.task.kind).toBe('wild');
    expect(wild?.name).toBe('Wild card — any exercise');
    expect(store.wildOptions().length).toBeGreaterThan(0);

    const choice = store.wildOptions()[0];
    const before = store.state()!.totals[store.me()]?.[choice.id] ?? 0; // it may already have been done
    store.wildChoice.set(choice.id);
    expect(store.currentTask()?.name).toBe(choice.name); // the panel shows what you picked
    const amount = store.currentTask()!.task.amount;
    store.complete(amount);
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    await store.flushed();

    expect(store.wildChoice()).toBeNull();
    const me = store.me();
    expect((await sessions.get(id))!.totals[me][choice.id]).toBe(before + amount);
  });
});
