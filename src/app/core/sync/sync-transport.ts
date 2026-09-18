import type { Observable } from 'rxjs';
import type { NetMessage } from './net-message';

export type PlayerId = string;

export interface PlayerInfo {
  id: PlayerId;
  name: string;
}

export interface PlayerPresence extends PlayerInfo {
  /** Join order; the host is seat 0. Stable while connected. */
  seat: number;
  isHost: boolean;
  online: boolean;
}

export interface RoomInfo {
  /** 6-character room code (see room-code.ts). */
  code: string;
  hostId: PlayerId;
}

/**
 * §7 transport. All vendor code (Supabase, …) lives behind this interface in core/sync.
 * `send` without `to` broadcasts to every member, including the sender. Implementations
 * validate every received message with NetMessageSchema and drop invalid ones.
 */
export interface SyncTransport {
  createRoom(host: PlayerInfo): Promise<RoomInfo>;
  /** Rejects if the room does not exist. */
  joinRoom(code: string, player: PlayerInfo): Promise<RoomInfo>;
  send(msg: NetMessage, to?: PlayerId): void;
  /** Updates this member's presence (e.g. a renamed player). */
  updatePlayer(player: PlayerInfo): void;
  readonly messages$: Observable<NetMessage>;
  readonly presence$: Observable<PlayerPresence[]>;
  leave(): Promise<void>;
}
