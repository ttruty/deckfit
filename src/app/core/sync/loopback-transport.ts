import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { NetMessageSchema, type NetMessage } from './net-message';
import type { PlayerId, PlayerInfo, PlayerPresence, RoomInfo, SyncTransport } from './sync-transport';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

interface Member {
  info: PlayerInfo;
  transport: LoopbackTransport;
}

/**
 * In-process "server": rooms shared by every LoopbackTransport created with the same hub.
 * One hub = one simulated network (a test, or the app's in-memory rooms).
 */
export class LoopbackHub {
  readonly rooms = new Map<string, { hostId: PlayerId; members: Map<PlayerId, Member> }>();

  constructor(private readonly random: () => number = Math.random) {}

  newCode(): string {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }
}

/**
 * In-memory SyncTransport (§7) for solo play and tests, with any number of peers per hub.
 * Delivery is asynchronous (microtask) so handlers never re-enter the sender; messages are
 * JSON round-tripped (no shared references) and Zod-validated on receipt, invalid ones dropped
 * (counted in `dropped`). Seats follow join order; rejoining with the same id keeps the seat.
 */
export class LoopbackTransport implements SyncTransport {
  private readonly incoming = new Subject<NetMessage>();
  private readonly presence = new BehaviorSubject<PlayerPresence[]>([]);
  private room: string | null = null;
  private me: PlayerInfo | null = null;
  dropped = 0;

  readonly messages$: Observable<NetMessage> = this.incoming.asObservable();
  readonly presence$: Observable<PlayerPresence[]> = this.presence.asObservable();

  constructor(private readonly hub: LoopbackHub = new LoopbackHub()) {}

  async createRoom(host: PlayerInfo): Promise<RoomInfo> {
    const code = this.hub.newCode();
    this.hub.rooms.set(code, { hostId: host.id, members: new Map() });
    return this.joinRoom(code, host);
  }

  async joinRoom(code: string, player: PlayerInfo): Promise<RoomInfo> {
    const room = this.hub.rooms.get(code);
    if (!room) throw new Error(`Room ${code} not found`);
    if (this.room) await this.leave();
    const existing = room.members.get(player.id);
    if (existing && existing.transport !== this) existing.transport.detach();
    room.members.set(player.id, { info: player, transport: this }); // Map keeps the original insertion slot → same seat
    this.room = code;
    this.me = player;
    this.broadcastPresence(code);
    return { code, hostId: room.hostId };
  }

  send(msg: NetMessage, to?: PlayerId): void {
    const room = this.currentRoom();
    const targets = to ? [room.members.get(to)].filter((m) => m !== undefined) : [...room.members.values()];
    const wire = JSON.parse(JSON.stringify(msg)) as unknown; // what a network would do
    for (const t of targets) queueMicrotask(() => t.transport.receive(wire));
  }

  updatePlayer(player: PlayerInfo): void {
    const room = this.currentRoom();
    const member = room.members.get(player.id);
    if (!member || member.transport !== this) throw new Error('Cannot update another player');
    member.info = player;
    this.me = player;
    this.broadcastPresence(this.room!);
  }

  async leave(): Promise<void> {
    const code = this.room;
    if (!code || !this.me) return;
    const room = this.hub.rooms.get(code);
    if (room?.members.get(this.me.id)?.transport === this) room.members.delete(this.me.id);
    this.detach();
    if (room && room.members.size === 0) this.hub.rooms.delete(code);
    else this.broadcastPresence(code);
  }

  /** Test hook: deliver a raw (possibly invalid) payload as if it came from the network. */
  receive(raw: unknown): void {
    if (!this.room) return;
    const parsed = NetMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.dropped++;
      return;
    }
    this.incoming.next(parsed.data);
  }

  private detach(): void {
    this.room = null;
    this.presence.next([]);
  }

  private currentRoom() {
    const room = this.room ? this.hub.rooms.get(this.room) : undefined;
    if (!room) throw new Error('Not in a room');
    return room;
  }

  private broadcastPresence(code: string): void {
    const room = this.hub.rooms.get(code);
    if (!room) return;
    const list = [...room.members.values()].map(({ info }, seat) => ({ ...info, seat, isHost: info.id === room.hostId, online: true }));
    for (const { transport } of room.members.values()) transport.presence.next(list);
  }
}
