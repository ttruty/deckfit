import { Subject, type Observable, type Subscription } from 'rxjs';
import { PrivateMessageSchema, type NetMessageOf, type PrivateMessage } from './net-message';
import type { PlayerId, SyncTransport } from './sync-transport';

/** Messages kept per peer while we wait for their key (oldest dropped first). */
const MAX_PENDING = 32;

export interface PrivateEnvelope {
  from: PlayerId;
  msg: PrivateMessage;
}

interface Peer {
  publicKey: string;
  key: Promise<CryptoKey | null>;
}

/**
 * Per-player private channels over a public SyncTransport (§7 hidden games).
 *
 * Public transports (Supabase broadcast) deliver every message to every member, so `to` alone
 * hides nothing. Each device makes an ephemeral ECDH P-256 key pair and announces the public
 * key (`key`); two devices derive a shared AES-GCM-256 key, and private messages travel as
 * `private` ciphertext bound to `room|from|to` (associated data), so a message can't be read by,
 * or replayed to, anyone else.
 *
 * - `key-request` asks everyone to re-announce (sent on start; answered by every peer).
 * - A new key for a known id replaces the old one (a reload makes a new pair).
 * - Sends to a peer without a key are queued; ciphertext from a sender without a key is held
 *   until the key arrives. Undecryptable or invalid messages are dropped (`dropped`).
 *
 * Limitation: keys are not authenticated (no accounts), so a malicious member could announce a
 * key under someone else's id before or after them. This keeps hands from other players' apps
 * and from anyone reading the channel; it is not a defense against an active impersonator.
 */
export class PrivateLink {
  private readonly peers = new Map<PlayerId, Peer>();
  private readonly outbox = new Map<PlayerId, PrivateMessage[]>();
  private readonly held = new Map<PlayerId, NetMessageOf<'private'>[]>();
  private readonly incoming = new Subject<PrivateEnvelope>();
  private readonly peerKeys = new Subject<PlayerId>();
  private readonly pair: Promise<{ keys: CryptoKeyPair; publicKey: string }>;
  private sub: Subscription | null = null;
  /** Serializes crypto so messages leave and arrive in the order they were sent. */
  private chain: Promise<unknown> = Promise.resolve();
  private stopped = false;
  dropped = 0;

  readonly messages$: Observable<PrivateEnvelope> = this.incoming.asObservable();
  /** A peer's key became known or changed. */
  readonly peerKeys$: Observable<PlayerId> = this.peerKeys.asObservable();

  static supported(): boolean {
    return typeof globalThis.crypto?.subtle?.deriveKey === 'function';
  }

  constructor(
    private readonly transport: SyncTransport,
    readonly me: PlayerId,
    private readonly room: string,
  ) {
    this.pair = (async () => {
      const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
      const raw = await crypto.subtle.exportKey('raw', keys.publicKey);
      return { keys, publicKey: toBase64(new Uint8Array(raw)) };
    })();
    this.pair.catch(() => undefined); // surfaced by start()
  }

  /** Subscribes, announces this device's key, and asks peers for theirs. */
  async start(): Promise<void> {
    this.sub ??= this.transport.messages$.subscribe((msg) => {
      if (this.stopped || !('from' in msg) || msg.from === this.me) return;
      if (msg.kind === 'key-request') void this.announce(msg.from);
      if (msg.kind === 'key') this.learnKey(msg.from, msg.publicKey);
      if (msg.kind === 'private' && msg.to === this.me) this.receive(msg);
    });
    await this.announce();
    this.transport.send({ kind: 'key-request', from: this.me });
  }

  stop(): void {
    this.stopped = true;
    this.sub?.unsubscribe();
    this.sub = null;
    this.outbox.clear();
    this.held.clear();
  }

  hasKey(peer: PlayerId): boolean {
    return this.peers.has(peer);
  }

  /** Encrypts `msg` for `to` (queued until their key is known). */
  send(to: PlayerId, msg: PrivateMessage): void {
    if (this.stopped) return;
    if (!this.peers.has(to)) {
      const queue = this.outbox.get(to) ?? [];
      queue.push(msg);
      if (queue.length > MAX_PENDING) queue.shift();
      this.outbox.set(to, queue);
      return;
    }
    const peer = this.peers.get(to)!;
    this.enqueue(async () => {
      const key = await peer.key;
      if (!key || this.stopped) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: this.aad(this.me, to) }, key, new TextEncoder().encode(JSON.stringify(msg)),
      );
      this.transport.send({ kind: 'private', from: this.me, to, iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }, to);
    });
  }

  private async announce(to?: PlayerId): Promise<void> {
    const { publicKey } = await this.pair;
    if (!this.stopped) this.transport.send({ kind: 'key', from: this.me, publicKey }, to);
  }

  private learnKey(from: PlayerId, publicKey: string): void {
    if (this.peers.get(from)?.publicKey === publicKey) return;
    const key = (async () => {
      try {
        const { keys } = await this.pair;
        const theirs = await crypto.subtle.importKey('raw', fromBase64(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        return await crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, keys.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      } catch {
        this.dropped++;
        return null;
      }
    })();
    this.peers.set(from, { publicKey, key });
    const queued = this.outbox.get(from) ?? [];
    this.outbox.delete(from);
    for (const m of queued) this.send(from, m);
    const held = this.held.get(from) ?? [];
    this.held.delete(from);
    for (const m of held) this.receive(m);
    this.enqueue(async () => {
      if (!this.stopped && (await key)) this.peerKeys.next(from);
    });
  }

  private receive(msg: NetMessageOf<'private'>): void {
    const peer = this.peers.get(msg.from);
    if (!peer) {
      const held = this.held.get(msg.from) ?? [];
      held.push(msg);
      if (held.length > MAX_PENDING) held.shift();
      this.held.set(msg.from, held);
      return;
    }
    this.enqueue(async () => {
      const key = await peer.key;
      if (!key || this.stopped) return;
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(msg.iv), additionalData: this.aad(msg.from, this.me) }, key, fromBase64(msg.data),
        );
        const parsed = PrivateMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(plain)));
        if (!parsed.success) throw parsed.error;
        if (!this.stopped) this.incoming.next({ from: msg.from, msg: parsed.data });
      } catch {
        this.dropped++; // wrong key (e.g. an old key pair), tampered, or invalid
      }
    });
  }

  private aad(from: PlayerId, to: PlayerId): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(`${this.room}|${from}|${to}`);
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch(() => undefined);
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
