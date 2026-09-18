import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RoutineRepository } from '../../core/db/repositories';
import { seedContent } from '../../core/db/seed-content';
import { IdentityService } from '../../core/identity/identity.service';
import { LoopbackTransport } from '../../core/sync/loopback-transport';
import { RoomSession } from '../../core/sync/room-session';
import { LOOPBACK_HUB } from '../../core/sync/sync.providers';
import { loadContent, provideTestDb } from '../../../testing/db';
import { flush, intervalRoomRoutine } from '../../../testing/sync';
import { LobbyComponent } from './lobby.component';
import { ROOM_DEFAULT_ROUTINE_ID, RoomRoutineService } from './room-routine.service';
import { RoomService } from './room.service';

async function render(code: string) {
  const fixture = TestBed.createComponent(LobbyComponent);
  fixture.componentRef.setInput('code', code);
  await flush();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('Lobby (3 loopback peers)', () => {
  beforeEach(async () => {
    const db = provideTestDb();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    await seedContent(db, loadContent());
    await TestBed.inject(IdentityService).rename('Ann');
  });

  it('host lobby shows code, QR, routine preview, and live presence with ready states', async () => {
    const rooms = TestBed.inject(RoomService);
    const routine = await TestBed.inject(RoomRoutineService).build(await TestBed.inject(RoomRoutineService).defaultRoutine());
    const code = await rooms.create(routine);
    const hub = TestBed.inject(LOOPBACK_HUB);
    const bo = await RoomSession.join(new LoopbackTransport(hub), code, { id: 'bo', name: 'Bo' });
    await RoomSession.join(new LoopbackTransport(hub), code, { id: 'cy', name: 'Cy' });

    const { fixture, el } = await render(code);
    expect(text(el.querySelector('.code'))).toBe(code);
    expect(el.querySelector('df-qr-code svg path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect([...el.querySelectorAll('.players li .name')].map(text)).toEqual(['Ann (you)', 'Bo', 'Cy']);
    expect(text(el.querySelector('.players li .host'))).toBe('Host');
    expect(text(el.querySelector('.routine .game'))).toBe('Interval Deck · Bodyweight deck');
    expect(text(el.querySelector('.blocker'))).toBe('Waiting for 3 players to be ready.');

    bo.setReady(true);
    await flush();
    await fixture.whenStable();
    expect([...el.querySelectorAll('.players li .status')].map(text)).toEqual(['hourglass_empty Not ready', 'check_circle Ready', 'hourglass_empty Not ready']);

    (el.querySelector('.ready-toggle') as HTMLButtonElement).click();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('.ready-toggle')?.getAttribute('aria-pressed')).toBe('true');
    expect(bo.snapshot?.players.find((p) => p.id === TestBed.inject(RoomService).view()?.hostId)?.ready).toBe(true);
    expect(text(el.querySelector('.blocker'))).toBe('Waiting for 1 player to be ready.');

    fixture.destroy();
    await flush();
    expect(rooms.code).toBeNull();
    expect(bo.snapshot?.players.map((p) => p.name)).toEqual(['Bo', 'Cy']);
  });

  it('a joiner sees the host’s routine and can save it (with its bundle) to this device', async () => {
    const hub = TestBed.inject(LOOPBACK_HUB);
    const routine = intervalRoomRoutine();
    const host = await RoomSession.host(new LoopbackTransport(hub), { id: 'host', name: 'Hana' }, routine);

    const { fixture, el } = await render(host.code);
    expect([...el.querySelectorAll('.players li .name')].map(text)).toEqual(['Hana', 'Ann (you)']);
    expect(text(el.querySelector('.routine-name'))).toBe('Tabata at the park');
    const save = [...el.querySelectorAll('.routine button')].find((b) => text(b).includes('Save routine')) as HTMLButtonElement;
    save.click();
    await flush();
    await fixture.whenStable();
    expect(text(el.querySelector('.routine button'))).toContain('Saved to this device');
    expect((await TestBed.inject(RoutineRepository).get('routine-room'))?.name).toBe('Tabata at the park');
    expect(ROOM_DEFAULT_ROUTINE_ID).not.toBe('routine-room');
  });

  it('shows a not-found message for an unknown room', async () => {
    const { el } = await render('ZZZZZZ');
    expect(text(el.querySelector('[role=alert] h1'))).toBe('Room ZZZZZZ not found');
  });
});
