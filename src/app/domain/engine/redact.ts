import { SECRET_PREFIX, teamCaptain } from './dsl/interpreter';
import type { EngineEvent } from './events';
import type { GameState, PlayerId, Task } from './state';

/** Stands in for a card the viewer may not know. Zones keep their length, so counts stay right. */
export const HIDDEN_CARD = '?';
/** TaskCompleted.exerciseKey for someone else's work on hidden cards. */
export const HIDDEN_EXERCISE = 'hidden';

/**
 * Cards `viewer` may know in `state` (§7 hidden games): anything face up, their own hand and pile,
 * their team's shared hand, and the cards of their own tasks. Everything else — the draw pile,
 * other hands, face-down piles and claims — is hidden.
 */
export function visibleCardIds(state: GameState, viewer: PlayerId): Set<string> {
  const visible = new Set(state.faceUp);
  const captain = state.players.some((p) => p.id === viewer) ? teamCaptain(state, viewer) : viewer;
  for (const id of [
    ...(state.zones.hands[viewer] ?? []),
    ...(state.zones.hands[captain] ?? []),
    ...(state.zones.piles[viewer] ?? []),
    ...state.tasks.filter((t) => t.playerId === viewer).flatMap((t) => t.cardIds),
  ]) visible.add(id);
  return visible;
}

/**
 * The state as `viewer` may see it: hidden cards become HIDDEN_CARD; other players' tasks on
 * hidden cards lose their card ids and exercise (amount and status stay public: everyone sees
 * how much work you're doing); other players' per-exercise totals are dropped; secret vars are
 * removed; the RNG state is zeroed so future shuffles can't be predicted.
 */
export function redactState(state: GameState, viewer: PlayerId): GameState {
  const visible = visibleCardIds(state, viewer);
  const hide = (ids: readonly string[]) => ids.map((id) => (visible.has(id) ? id : HIDDEN_CARD));
  const hideRecord = (r: Record<string, string[]>) => Object.fromEntries(Object.entries(r).map(([p, ids]) => [p, hide(ids)]));
  return {
    ...state,
    rngState: 0,
    zones: {
      draw: hide(state.zones.draw),
      discard: hide(state.zones.discard),
      table: hide(state.zones.table),
      hands: hideRecord(state.zones.hands),
      piles: hideRecord(state.zones.piles),
    },
    faceUp: [...state.faceUp],
    tasks: state.tasks.map((t) => redactTask(t, viewer, visible)),
    totals: Object.fromEntries(Object.entries(state.totals).map(([p, t]) => [p, p === viewer ? t : {}])),
    vars: Object.fromEntries(Object.entries(state.vars).filter(([k]) => !k.startsWith(SECRET_PREFIX))),
  };
}

/**
 * One step's events as `viewer` may see them. A card id survives if the viewer could see it
 * before or after the step (so your own card played face down still reads as yours), or if the
 * step revealed it (CardsRevealed). Other ids become HIDDEN_CARD.
 */
export function redactEvents(before: GameState, events: readonly EngineEvent[], after: GameState, viewer: PlayerId): EngineEvent[] {
  const visible = visibleCardIds(before, viewer);
  for (const id of visibleCardIds(after, viewer)) visible.add(id);
  for (const e of events) if (e.type === 'CardsRevealed') for (const id of e.cardIds) visible.add(id);
  const hide = (ids: readonly string[]) => ids.map((id) => (visible.has(id) ? id : HIDDEN_CARD));
  const hiddenTasks = new Set(
    after.tasks.filter((t) => redactTask(t, viewer, visible).exerciseId !== t.exerciseId).map((t) => t.id),
  );
  return events.map((e): EngineEvent => {
    switch (e.type) {
      case 'CardsDealt':
      case 'CardsMoved':
        return { ...e, cardIds: hide(e.cardIds) };
      case 'CardFlipped':
      case 'CardPlayed':
        return { ...e, cardId: hide([e.cardId])[0] };
      case 'TaskAssigned':
        return { ...e, task: redactTask(e.task, viewer, visible) };
      case 'TaskCompleted':
        return hiddenTasks.has(e.taskId) ? { ...e, exerciseKey: HIDDEN_EXERCISE } : e;
      default:
        return e;
    }
  });
}

function redactTask(task: Task, viewer: PlayerId, visible: ReadonlySet<string>): Task {
  if (task.playerId === viewer || task.cardIds.every((id) => visible.has(id))) return task;
  return { ...task, cardIds: task.cardIds.map((id) => (visible.has(id) ? id : HIDDEN_CARD)), exerciseId: null };
}
