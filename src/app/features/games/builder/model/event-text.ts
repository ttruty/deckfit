import type { EngineEvent } from '../../../../domain/engine/events';
import type { Deck, Exercise } from '../../../../domain/models/schemas';
import { SUIT_SYMBOL } from '../../../../shared/labels';

/** One-line, human-readable text for a dry-run event. */
export function describeEvent(e: EngineEvent, deck: Pick<Deck, 'cards'>, exercises: ReadonlyMap<string, Pick<Exercise, 'name'>>): string {
  const cards = new Map(deck.cards.map((c) => [c.id, c]));
  const card = (id: string) => {
    const c = cards.get(id);
    if (!c) return id;
    if (c.suit === 'joker') return 'Joker';
    const ex = c.exerciseId ? exercises.get(c.exerciseId)?.name : undefined;
    return `${c.rank}${SUIT_SYMBOL[c.suit]}${ex ? ` ${ex}` : ''}`;
  };
  const list = (ids: readonly string[]) => (ids.length > 4 ? `${ids.slice(0, 3).map(card).join(', ')} +${ids.length - 3} more` : ids.map(card).join(', '));
  const zone = (z: string) => z.replace(':', ' of ');
  switch (e.type) {
    case 'GameStarted': return `Game started with ${e.players.join(', ')}`;
    case 'CardsShuffled': return `Shuffled ${e.count} cards in ${zone(e.zone)}`;
    case 'CardsDealt': return `Dealt ${list(e.cardIds)} to ${zone(e.zone)}${e.faceUp ? ' face up' : ''}`;
    case 'CardFlipped': return `Flipped ${card(e.cardId)}`;
    case 'CardPlayed': return `${e.playerId} played ${card(e.cardId)}`;
    case 'CardsMoved': return `Moved ${list(e.cardIds)} from ${zone(e.from)} to ${zone(e.to)}`;
    case 'TaskAssigned': {
      const t = e.task;
      const what = t.exerciseId ? (exercises.get(t.exerciseId)?.name ?? t.exerciseId) : t.kind === 'rest' ? 'Rest' : t.kind === 'wild' ? 'Wild exercise' : 'Bonus cardio';
      return `${t.playerId}: ${what} × ${t.amount}${t.measure === 'seconds' ? ' s' : ' reps'}`;
    }
    case 'TaskCompleted': return `${e.playerId} done (${e.amount})`;
    case 'TaskSkipped': return `${e.playerId} skipped a task`;
    case 'TimerStarted': return `Timer “${e.timer.label ?? e.timer.id}” ${e.timer.durationSec} s${e.timer.phase ? ` (${e.timer.phase})` : ''}`;
    case 'TimerElapsed': return `Timer ${e.timerId} finished${e.phase ? ` (${e.phase})` : ''}`;
    case 'TurnStarted': return `${e.playerId}'s turn (round ${e.round + 1})`;
    case 'RoundWon': return `${e.playerId} won the round`;
    case 'BetPlaced': return `${e.playerId} stakes ${e.amount} (pot ${e.pot})`;
    case 'PlayerChecked': return `${e.playerId} checks`;
    case 'PlayerFolded': return `${e.playerId} folds`;
    case 'ClaimMade': return `${e.playerId} claims ${e.count} × ${e.rank}`;
    case 'ClaimChallenged': return `${e.playerId} calls ${e.claimant}: ${e.lied ? 'bluff' : 'truth'}; ${e.loser} takes the pile`;
    case 'CardsRevealed': return `Revealed ${list(e.cardIds)}`;
    case 'PlayerLeft': return `${e.playerId} left the game`;
    case 'GameOver': return `Game over (${e.reason})`;
    case 'IntentRejected': return `${e.playerId}'s ${e.intent} rejected: ${e.reason}`;
  }
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return m ? `${m} min ${s.toString().padStart(2, '0')} s` : `${s} s`;
}
