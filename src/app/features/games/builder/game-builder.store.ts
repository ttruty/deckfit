import { Injectable, computed, inject, signal } from '@angular/core';
import { newId } from '../../../core/db/deckfit-db';
import { DeckRepository, ExerciseRepository, GameRepository } from '../../../core/db/repositories';
import { dryRun, type DryRunResult } from '../../../domain/engine/dsl/dry-run';
import type { GameDefinition, SettingDef, StepKind } from '../../../domain/models/game.schema';
import type { Deck, Exercise } from '../../../domain/models/schemas';
import { newBlock, type Block, type ChildSlot } from './model/blocks';
import {
  SLOT_IDS, blankDraft, draftFromGame, duplicateBlock, findBlock, getList, insertBlock, isInside, listId, locate, moveBlock,
  removeBlock, serializeDraft, setChildList, setGame, updateBlock, type DraftGame, type GameDraft, type ListRef,
} from './model/draft';
import { addSetting, numberSettingFor, removeSetting, settingUses, suggestSettingKey } from './model/settings';
import { validateDraft } from './model/validation';

export interface DryRunOptions {
  deckId: string;
  seed: number;
  players: number;
}

export const DRY_RUN_TURNS = 20;

/**
 * State of one /games/new or /games/:id/edit page: the draft being edited, its validation, and the
 * dry run. Pure model functions (./model) do the work; this wires them to signals and Dexie.
 */
@Injectable()
export class GameBuilderStore {
  private readonly games = inject(GameRepository);
  private readonly decks = inject(DeckRepository);
  private readonly exercisesRepo = inject(ExerciseRepository);

  readonly draft = signal<GameDraft>(blankDraft('game-new'));
  readonly loaded = signal(false);
  /** Id the draft saves under; built-ins are always copied to a new id. */
  readonly id = signal('');
  readonly isNew = signal(true);
  /** Name of the built-in (or other game) this draft was copied from. */
  readonly copiedFrom = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);
  private readonly savedJson = signal('');

  readonly deckList = signal<Deck[]>([]);
  private exercises: Exercise[] = [];

  readonly validation = computed(() => validateDraft(this.draft()));
  readonly json = computed(() => serializeDraft(this.draft()).json);
  readonly dirty = computed(() => JSON.stringify(this.json()) !== this.savedJson());
  readonly settingKeys = computed(() => Object.keys(this.draft().game.settingsSchema));
  /** Every drop list id, deepest first (CDK checks connected lists in order; nested lists must win over their parents). */
  readonly listIds = computed(() => {
    const draft = this.draft();
    const out: { id: string; depth: number }[] = [];
    const visit = (blocks: readonly Block[], depth: number) => {
      for (const b of blocks) {
        for (const [child, list] of Object.entries(b.children)) {
          out.push({ id: listId({ uid: b.uid, child: child as ChildSlot }), depth: depth + 1 });
          visit(list, depth + 1);
        }
      }
    };
    for (const slot of SLOT_IDS) {
      const list = draft.slots[slot];
      if (!list) continue;
      out.push({ id: listId({ slot }), depth: 0 });
      visit(list, 0);
    }
    return out.sort((a, b) => b.depth - a.depth).map((x) => x.id);
  });
  readonly dragging = signal<string | null>(null);

  readonly dryRunOptions = signal<DryRunOptions>({ deckId: 'deck-bodyweight', seed: 2026, players: 1 });
  readonly dryRunResult = signal<(DryRunResult & { game: GameDefinition; deck: Deck }) | null>(null);

  async load(opts: { gameId?: string; from?: string }): Promise<void> {
    try {
      const [decks, exercises] = await Promise.all([this.decks.list(), this.exercisesRepo.list()]);
      this.deckList.set(decks.sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.name.localeCompare(b.name)));
      this.exercises = exercises;
      const sourceId = opts.gameId ?? opts.from;
      const source = sourceId ? await this.games.get(sourceId) : undefined;
      if (sourceId && !source) {
        this.loadError.set('That game no longer exists.');
        return;
      }
      if (source && !source.builtIn && opts.gameId) {
        this.id.set(source.id);
        this.isNew.set(false);
        this.draft.set(draftFromGame(source));
        this.savedJson.set(JSON.stringify(this.json()));
      } else if (source) {
        // Built-ins are read-only, and "from" always copies: a new game that starts as that one.
        const id = newId('game');
        this.id.set(id);
        this.copiedFrom.set(source.name);
        this.draft.set(draftFromGame({ ...source, id, name: `${source.name} (copy)`, builtIn: false }));
        this.savedJson.set('');
      } else {
        const id = newId('game');
        this.id.set(id);
        this.draft.set(blankDraft(id));
        this.savedJson.set('');
      }
      const players = this.draft().game['players'] as { min?: number } | undefined;
      this.dryRunOptions.update((o) => ({
        ...o, deckId: decks.some((d) => d.id === o.deckId) ? o.deckId : (decks[0]?.id ?? ''), players: players?.min ?? 1,
      }));
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Could not load the game.');
    } finally {
      this.loaded.set(true);
    }
  }

  // ── Game-level fields ─────────────────────────────────────────────────────

  patchGame(patch: (game: DraftGame) => DraftGame): void {
    this.draft.update((d) => setGame(d, patch(structuredClone(d.game))));
  }

  /** Sets (or with `undefined`, removes) a value at a path of the game JSON. */
  setField(path: readonly string[], value: unknown): void {
    this.patchGame((game) => {
      let o: Record<string, unknown> = game;
      for (const k of path.slice(0, -1)) {
        if (!o[k] || typeof o[k] !== 'object') o[k] = {};
        o = o[k] as Record<string, unknown>;
      }
      if (value === undefined) delete o[path.at(-1)!];
      else o[path.at(-1)!] = value;
      return game;
    });
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  block(uid: string): Block | undefined {
    return findBlock(this.draft(), uid);
  }

  add(kind: StepKind, ref: ListRef, index?: number): Block {
    const block = newBlock(kind);
    this.draft.update((d) => {
      const list = getList(d, ref);
      return list ? insertBlock(d, ref, Math.min(index ?? list.length, list.length), block) : d;
    });
    return block;
  }

  move(uid: string, ref: ListRef, index: number): void {
    this.draft.update((d) => moveBlock(d, uid, ref, index));
  }

  canDrop(uid: string | null, ref: ListRef): boolean {
    return !uid || !isInside(this.draft(), ref, uid);
  }

  /** Moves a block one place up or down within its list. */
  nudge(uid: string, delta: -1 | 1): void {
    const at = locate(this.draft(), uid);
    if (at) this.move(uid, at.ref, at.index + delta);
  }

  position(uid: string): { index: number; count: number } | null {
    const at = locate(this.draft(), uid);
    const list = at ? getList(this.draft(), at.ref) : undefined;
    return at && list ? { index: at.index, count: list.length } : null;
  }

  update(uid: string, body: Record<string, unknown>): void {
    this.draft.update((d) => updateBlock(d, uid, body));
  }

  remove(uid: string): void {
    this.draft.update((d) => removeBlock(d, uid));
  }

  duplicate(uid: string): void {
    this.draft.update((d) => duplicateBlock(d, uid));
  }

  setChildList(uid: string, child: ChildSlot, present: boolean): void {
    this.draft.update((d) => setChildList(d, uid, child, present ? [] : undefined));
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  settingDefs(): [string, SettingDef][] {
    return Object.entries(this.draft().game.settingsSchema) as unknown as [string, SettingDef][];
  }

  /** Turns a literal number into a new user-tunable setting; returns its key. */
  exposeNumber(label: string, value: number): string {
    const key = suggestSettingKey(label, this.draft());
    this.draft.update((d) => addSetting(d, key, numberSettingFor(value, label)));
    return key;
  }

  exposeEnum(label: string, options: string[], value: string): string {
    const key = suggestSettingKey(label, this.draft());
    this.draft.update((d) => addSetting(d, key, { type: 'enum', options, default: value, label }));
    return key;
  }

  addSetting(label: string, def: SettingDef): string {
    const key = suggestSettingKey(label, this.draft());
    this.draft.update((d) => addSetting(d, key, def));
    return key;
  }

  updateSetting(key: string, def: Record<string, unknown>): void {
    this.patchGame((game) => ({ ...game, settingsSchema: { ...game.settingsSchema, [key]: def } }));
  }

  uses(key: string): number {
    return settingUses(this.draft(), key);
  }

  /** Returns an error message when the setting can't be removed. */
  removeSetting(key: string): string | null {
    const result = removeSetting(this.draft(), key);
    if ('error' in result) return result.error;
    this.draft.set(result.draft);
    return null;
  }

  // ── Dry run and save ──────────────────────────────────────────────────────

  runDryRun(): DryRunResult | null {
    const game = this.validation().game;
    const opts = this.dryRunOptions();
    const deck = this.deckList().find((d) => d.id === opts.deckId);
    if (!game || !deck) return null;
    const result = dryRun({ def: game, deck, exercises: this.exercises, seed: opts.seed, players: opts.players, turns: DRY_RUN_TURNS });
    this.dryRunResult.set({ ...result, game, deck });
    return result;
  }

  exercisesById(): Map<string, Exercise> {
    return new Map(this.exercises.map((e) => [e.id, e]));
  }

  /** Saves when valid; returns the saved game, or null (see `validation().problems`). */
  async save(): Promise<GameDefinition | null> {
    const game = this.validation().game;
    if (!game) return null;
    const saved = await this.games.save({ ...game, id: this.id(), builtIn: false });
    this.savedJson.set(JSON.stringify(this.json()));
    this.isNew.set(false);
    this.copiedFrom.set(null);
    return saved;
  }
}
