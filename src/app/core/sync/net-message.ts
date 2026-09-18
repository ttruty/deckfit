import { z } from 'zod';
import { EngineEventSchema } from '../../domain/engine/events';
import { IntentSchema } from '../../domain/engine/intents';
import { GameStateSchema } from '../../domain/engine/state';
import { BundleSchema } from '../../domain/models/bundle.schema';
import { GameDefinitionSchema } from '../../domain/models/game.schema';
import { DeckSnapshotSchema, ExerciseSchema, GameSettingsSchema, PlayerRangeSchema, RoutineSchema, SuitSchema } from '../../domain/models/schemas';

const Id = z.string().min(1);
const Base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

// ── Room payloads ───────────────────────────────────────────────────────────

/**
 * The routine a room will play, as it travels with the room: the routine itself, a bundle of
 * the user-made deck/game/exercises it needs (built-ins are referenced by id), and a
 * ready-to-render preview so joiners need nothing locally to show the lobby.
 */
export const RoomRoutineSchema = z.object({
  routine: RoutineSchema,
  bundle: BundleSchema,
  preview: z.object({
    deckName: z.string(),
    gameName: z.string(),
    gameSummary: z.string(),
    players: PlayerRangeSchema,
    cardCount: z.number().int().nonnegative(),
    suits: z.array(z.object({ suit: SuitSchema, label: z.string() })),
  }),
});
export type RoomRoutine = z.infer<typeof RoomRoutineSchema>;

/** Host-owned lobby state, rebroadcast on every change. */
export const RoomStateSchema = z.object({
  code: z.string().length(6),
  hostId: Id,
  /** Host term: increases on every host migration. Peers accept only the newest term. */
  epoch: z.number().int().nonnegative(),
  /** Seat order for the life of the room: ids are appended on first join and never removed, so a rejoin keeps its seat. */
  seats: z.array(Id),
  phase: z.enum(['lobby', 'playing']),
  routine: RoomRoutineSchema.nullable(),
  /** playerId → ready. Only players currently present appear. */
  ready: z.record(Id, z.boolean()),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

/** Everything a peer needs to build the identical engine: no local content required. */
export const GameStartSchema = z.object({
  seed: z.number().int().nonnegative(),
  players: z.array(z.object({ id: Id, name: z.string().min(1), seat: z.number().int().nonnegative() })).min(1),
  game: GameDefinitionSchema,
  deck: DeckSnapshotSchema,
  settings: GameSettingsSchema,
  /** Every exercise the deck references (built-in or not). */
  exercises: z.array(ExerciseSchema),
});
export type GameStart = z.infer<typeof GameStartSchema>;

// ── Messages ────────────────────────────────────────────────────────────────

/** Everything that crosses a SyncTransport (§7). Validated on receipt; invalid messages are dropped. */
export const NetMessageSchema = z.discriminatedUnion('kind', [
  /** Client → host. `sentAt` is the clock-offset-corrected send time (timing-sensitive games). */
  z.object({ kind: z.literal('intent'), from: Id, intent: IntentSchema, sentAt: z.number().optional() }),
  /**
   * Host → all. `seq` increases by 1 per applied intent. Carries the intent so clients can
   * reduce locally and compare `stateHash` (= hashState(state) after applying).
   */
  z.object({
    kind: z.literal('events'), seq: z.number().int().positive(), intent: IntentSchema,
    events: z.array(EngineEventSchema), stateHash: z.string(),
  }),
  /** Client → host, on a seq gap or hash mismatch. */
  z.object({ kind: z.literal('snapshot-request'), from: Id }),
  /** Host → one client: full state and log as of `seq`. */
  z.object({ kind: z.literal('snapshot'), seq: z.number().int().nonnegative(), state: GameStateSchema, log: z.array(EngineEventSchema) }),

  /** Lobby: a joiner asks the host for the current room state. */
  z.object({ kind: z.literal('room-state-request'), from: Id }),
  /** Lobby: host → all (or one). Peers accept it only from the room's host. */
  z.object({ kind: z.literal('room-state'), from: Id, state: RoomStateSchema }),
  /** Lobby: a player's ready toggle → host. */
  z.object({ kind: z.literal('ready'), from: Id, ready: z.boolean() }),
  /**
   * Lobby → game: host → all. `resumed` marks the copy sent to a device that arrived (or came
   * back) after the game began, so it follows the running game instead of starting a new one.
   */
  z.object({ kind: z.literal('start'), from: Id, start: GameStartSchema, resumed: z.boolean().optional() }),

  /** Clock sync (§7): client → host with its send time. */
  z.object({ kind: z.literal('ping'), from: Id, id: z.number().int(), t0: z.number() }),
  /** Host → that client: echoes t0 with the host's receive time t1. */
  z.object({ kind: z.literal('pong'), from: Id, id: z.number().int(), t0: z.number(), t1: z.number() }),

  /** Private channels (§7): this device's ECDH P-256 public key (base64 raw point). Latest per sender wins. */
  z.object({ kind: z.literal('key'), from: Id, publicKey: Base64 }),
  /** Asks every peer to (re)announce its key, e.g. after joining or reloading. */
  z.object({ kind: z.literal('key-request'), from: Id }),
  /** AES-GCM ciphertext of a PrivateMessage for `to`, with `room|from|to` as associated data. */
  z.object({ kind: z.literal('private'), from: Id, to: Id, iv: Base64, data: Base64 }),
]);
export type NetMessage = z.infer<typeof NetMessageSchema>;
export type NetMessageOf<K extends NetMessage['kind']> = Extract<NetMessage, { kind: K }>;

// ── Private messages (decrypted payloads of `private`) ──────────────────────

/** What travels inside a private channel between the host and one player in a hidden game. */
export const PrivateMessageSchema = z.discriminatedUnion('kind', [
  /** Player → host. Same trust rules as a public intent (`intent.playerId` must be the sender). */
  z.object({ kind: z.literal('intent'), intent: IntentSchema, sentAt: z.number().optional() }),
  /** Host → player: that player's redacted view after step `seq`, with the step's redacted events. */
  z.object({ kind: z.literal('view'), seq: z.number().int().nonnegative(), state: GameStateSchema, events: z.array(EngineEventSchema) }),
  /** Player → host: send my current view (join, reload, new key). */
  z.object({ kind: z.literal('view-request') }),
]);
export type PrivateMessage = z.infer<typeof PrivateMessageSchema>;
export type PrivateMessageOf<K extends PrivateMessage['kind']> = Extract<PrivateMessage, { kind: K }>;
