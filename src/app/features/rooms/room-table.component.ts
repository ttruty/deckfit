import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { ShellService } from '../../core/shell/shell.service';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { cardAmount, scaleAmount } from '../../domain/engine/amounts';
import type { EngineEvent } from '../../domain/engine/events';
import {
  bettingOf,
  counter,
  currentPlayer,
  hasActed,
  isEnding,
  judgeOf,
  openClaim,
  requiredRank,
  teamCaptain,
  teamOf,
  winsOf,
} from '../../domain/engine/dsl/interpreter';
import { HIDDEN_CARD } from '../../domain/engine/redact';
import { INTENSITY_LABEL, SUIT_NAME } from '../../shared/labels';
import { CardBackComponent } from '../../shared/ui/card-back/card-back.component';
import { CardFaceComponent } from '../../shared/ui/card-face/card-face.component';
import { toCardFaceModel } from '../../shared/ui/card-face/card-face-model';
import { StepperComponent } from '../../shared/ui/stepper/stepper.component';
import { GameResultComponent, type FinalScore } from './game-result.component';
import { JudgePanelComponent } from './judge-panel.component';
import {
  HowToPlayDialog,
  type HowToPlayData,
} from '../../shared/ui/how-to-play/how-to-play.dialog';
import { RoomService } from './room.service';
import { playerLabel } from '../../core/identity/player-name';

const REJECTION_TEXT: Record<string, string> = {
  'no-match': 'Too late — that card no longer fits the center card.',
  'not-in-hand': 'That card isn’t in your hand anymore.',
  'already-acted': 'You already flipped this round.',
  'tasks-pending': 'Finish your exercise first.',
  'not-your-turn': 'It isn’t your turn.',
  'game-ending': 'The game is wrapping up.',
  'game-over': 'This game is over.',
  'bad-bet': 'That bet isn’t allowed — raise the stake, up to the maximum.',
  'nothing-to-call': 'There’s nothing to call.',
  'betting-open': 'Finish the betting first.',
  'bad-claim': 'Pick between one card and the claim limit.',
  'no-claim': 'There’s no claim to challenge.',
  'own-claim': 'You can’t challenge your own claim.',
};

const PROBLEM_TEXT: Record<string, string> = {
  'insecure-context':
    'This game keeps hands private with encryption, which needs a secure (https) connection.',
  'host-left':
    'The host left. Hands in this game are known only to the host, so it can’t continue.',
};

/**
 * Who won, said plainly. Rounds-won games rank by wins; total-work games by points. Ties share a
 * place, and a game where nobody scored has no winner.
 */
function describeResult(
  state: { players: readonly { id: string }[]; scores: Record<string, number> },
  scoring: 'total-work' | 'rounds-won',
  me: string,
  name: (id: string) => string,
): { headline: string; scores: FinalScore[] } {
  const ranked = state.players
    .map((p) => ({ id: p.id, name: name(p.id), score: state.scores[p.id] ?? 0, isMe: p.id === me }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;
  const winners = top > 0 ? ranked.filter((p) => p.score === top) : [];
  const scores = ranked.map((p, i) => ({
    ...p,
    place: ranked.findIndex((q) => q.score === p.score) + 1 || i + 1,
    won: winners.some((w) => w.id === p.id),
  }));

  const iWon = winners.some((w) => w.isMe);
  const names = winners.map((w) => w.name);
  const headline = !winners.length
    ? 'Nobody scored'
    : winners.length === ranked.length
      ? 'It’s a tie'
      : iWon && winners.length === 1
        ? 'You win!'
        : winners.length === 1
          ? `${names[0]} wins!`
          : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} tie`;
  void scoring;
  return { headline, scores };
}

const JOKER_TASK: Record<string, string> = {
  rest: 'Rest',
  wild: 'Wild card — any exercise',
  'bonus-cardio': 'Bonus cardio',
};

/** Multiplayer table (§9): players strip, center, your hand/task, and the moves this game allows. */
@Component({
  selector: 'df-room-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    CardBackComponent,
    CardFaceComponent,
    GameResultComponent,
    JudgePanelComponent,
    StepperComponent,
  ],
  templateUrl: './room-table.component.html',
  styleUrl: './room-table.component.scss',
})
export class RoomTableComponent {
  protected readonly rooms = inject(RoomService);
  private readonly dialog = inject(MatDialog);
  protected readonly toast = signal<string | null>(null);
  /** Live region text (§9): dealt cards, your task, and results. */
  protected readonly announcement = signal('');
  /** Bluff games: the cards picked for the next claim. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** Why another game couldn't start (too many players for it, say). */
  protected readonly nextError = signal<string | null>(null);
  protected readonly starting = signal(false);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly vm = computed(() => {
    const start = this.rooms.start();
    const state = this.rooms.state();
    const me = this.rooms.me();
    if (!start || !state || !me) return null;

    const def = start.game;
    const cards = new Map(start.deck.cards.map((c) => [c.id, c]));
    const exercises = new Map(start.exercises.map((e) => [e.id, e]));
    const face = (id: string) => {
      if (id === HIDDEN_CARD) return null;
      const card = cards.get(id)!;
      const ex = card.exerciseId ? exercises.get(card.exerciseId) : undefined;
      const amount = ex
        ? scaleAmount(cardAmount(card, ex.measure, start.settings), ex.measure, start.settings)
        : 0;
      return toCardFaceModel(card, start.deck, exercises, amount);
    };
    const label = (id: string) => {
      const card = cards.get(id)!;
      const ex = card.exerciseId ? exercises.get(card.exerciseId) : undefined;
      return card.suit === 'joker'
        ? 'joker'
        : `${card.rank} of ${SUIT_NAME[card.suit]}${ex ? `, ${ex.name}` : ''}`;
    };
    const name = (id: string) => playerLabel(start.players, id);
    const pending = (id: string) =>
      state.tasks.some((t) => t.status === 'pending' && t.playerId === id);

    const watching = this.rooms.spectating();
    const playing = state.phase === 'playing' && !isEnding(state) && !watching;
    const simultaneous = !!def.turn && 'mode' in def.turn;
    const anyPending = state.tasks.some((t) => t.status === 'pending');
    const myTurn = currentPlayer(state) === me;
    const bet = def.betting ? bettingOf(state) : null;
    const betOpen = !!bet?.active;
    const canFlip =
      playing &&
      !!def.turn &&
      !anyPending &&
      !betOpen &&
      (simultaneous ? !hasActed(state, me) : myTurn);
    const myTaskRaw = state.tasks.find((t) => t.status === 'pending' && t.playerId === me);
    const claim = def.bluff ? openClaim(state) : null;

    let waitingFor: string | null = null;
    if (watching) waitingFor = null;
    else if (playing && !canFlip && !myTaskRaw) {
      const verb = betOpen ? 'bet' : def.bluff ? 'claim' : 'flip';
      if (anyPending) waitingFor = 'Waiting for others to finish their exercises…';
      else if (simultaneous) waitingFor = 'Waiting for everyone to flip…';
      else if ((def.turn || def.bluff) && !myTurn)
        waitingFor = `Waiting for ${name(currentPlayer(state))} to ${verb}…`;
    }

    // Simultaneous games: once anyone has flipped, everyone who hasn't shows a card back rather
    // than last round's card — otherwise the strip looks like they've already played.
    const anyActed = simultaneous && state.players.some((p) => hasActed(state, p.id));

    const judgeId = judgeOf(state, def, start.settings);
    const taskName = (t: { exerciseId: string | null; kind: string }) =>
      t.exerciseId
        ? (exercises.get(t.exerciseId)?.name ?? 'Exercise')
        : (JOKER_TASK[t.kind] ?? 'Exercise');

    const maxBet = def.betting
      ? typeof def.betting.maxBet === 'number'
        ? def.betting.maxBet
        : Number(start.settings[(def.betting.maxBet as { setting: string }).setting] ?? 0)
      : 0;
    const myStake = bet?.stakes[me] ?? 0;
    const handOwner = def.teams ? teamCaptain(state, me) : me;
    const showHands = Object.values(state.zones.hands).some((h) => h.length > 0);

    return {
      gameName: def.name,
      objective: def.summary,
      deckName: start.deck.name,
      round: counter(state, 'round'),
      drawCount: state.zones.draw.length,
      roundsWon: def.scoring === 'rounds-won',
      showHands,
      players: state.players.map((p) => {
        const pile = state.zones.piles[p.id] ?? [];
        const captain = def.teams ? teamCaptain(state, p.id) : p.id;
        const handCount = (state.zones.hands[p.id] ?? []).length;
        const status = pending(p.id)
          ? 'working out'
          : hasActed(state, p.id)
            ? 'flipped'
            : simultaneous && playing
              ? 'yet to flip'
              : null;
        const details = [
          judgeId === p.id ? 'judging' : null,
          def.teams
            ? `Team ${teamOf(state, p.id) + 1}${captain === p.id ? ' (holds the hand)' : ''}`
            : null,
          betOpen ? (bet!.folded.includes(p.id) ? 'folded' : `${bet!.stakes[p.id] ?? 0} in`) : null,
          showHands && !def.teams ? `${handCount} ${handCount === 1 ? 'card' : 'cards'}` : null,
          def.scoring === 'rounds-won' ? `${winsOf(state, p.id)} won` : null,
          status,
        ]
          .filter((d) => d !== null)
          .join(' · ');
        return {
          id: p.id,
          name: name(p.id),
          isMe: p.id === me,
          wins: winsOf(state, p.id),
          acted: hasActed(state, p.id),
          working: pending(p.id),
          handCount,
          details,
          turn:
            playing &&
            !simultaneous &&
            (!!def.turn || !!def.bluff) &&
            currentPlayer(state) === p.id,
          pileTop:
            pile.length && !(anyActed && !hasActed(state, p.id))
              ? face(pile[pile.length - 1])
              : null,
          // Face down until they flip: "this round's card is still a secret", not "no card".
          pileHidden: playing && anyActed && !hasActed(state, p.id),
          // Hidden games: another player's cards you can see (a showdown or revealed claim).
          revealed:
            def.hidden && p.id !== handOwner
              ? (state.zones.hands[p.id] ?? [])
                  .filter((id) => id !== HIDDEN_CARD)
                  .map((id) => ({ id, face: face(id)! }))
              : [],
        };
      }),
      center: state.zones.table
        .slice(-3)
        .map((id, i) => ({ key: `${i}:${id}`, id, face: face(id) })),
      tableCount: state.zones.table.length,
      myHand: (state.zones.hands[handOwner] ?? [])
        .filter((id) => id !== HIDDEN_CARD)
        .map((id) => ({ id, face: face(id)!, label: label(id) })),
      teamHand: handOwner !== me,
      betting:
        bet && playing
          ? {
              open: betOpen,
              pot: bet.pot,
              current: bet.current,
              myStake,
              maxBet,
              toCall: Math.max(0, bet.current - myStake),
              canAct: betOpen && myTurn && !anyPending,
              minRaise: bet.current + 1,
            }
          : null,
      bluff:
        def.bluff && playing
          ? {
              rank: requiredRank(state),
              maxCards: def.bluff.maxCards,
              claim: claim ? { name: name(claim.by), count: claim.count, rank: claim.rank } : null,
              canClaim: myTurn && !anyPending,
              canChallenge: !!claim && claim.by !== me && !anyPending,
            }
          : null,
      problem: this.rooms.problem() ? PROBLEM_TEXT[this.rooms.problem()!] : null,
      myTask:
        judgeId === me
          ? null
          : myTaskRaw
            ? {
                task: myTaskRaw,
                name: myTaskRaw.exerciseId
                  ? (exercises.get(myTaskRaw.exerciseId)?.name ?? 'Exercise')
                  : (JOKER_TASK[myTaskRaw.kind] ?? 'Exercise'),
              }
            : null,
      simultaneous,
      judge: judgeId ? { id: judgeId, name: name(judgeId), isMe: judgeId === me } : null,
      // What the judge confirms: everyone else's pending tasks this round.
      judging:
        judgeId === me
          ? state.tasks
              .filter((t) => t.status === 'pending' && t.playerId !== me)
              .map((t) => ({
                id: t.id,
                who: name(t.playerId),
                name: taskName(t),
                amount: t.amount,
                measure: t.measure,
              }))
          : [],
      watching,
      canFlip,
      canPlay: playing && !!def.actions?.play && !pending(me),
      canPass: playing && !!def.actions?.pass && !pending(me),
      waitingFor,
      finished: state.phase === 'finished',
      result: state.phase === 'finished' ? describeResult(state, def.scoring, me, name) : null,
      scoreLabel: def.scoring === 'rounds-won' ? 'rounds won' : 'points',
      scoreHelp:
        def.scoring === 'rounds-won'
          ? 'One point per round won.'
          : 'Total work: 1 point per rep, 1 per 5 seconds held.',
    };
  });

  /**
   * What happens after a finished game (§7): the host deals the same routine again or takes
   * everyone back to the lobby to pick another; everyone else says whether they're in.
   */
  protected readonly next = computed(() => {
    const view = this.rooms.view();
    if (!view || this.rooms.state()?.phase !== 'finished') return null;
    const me = view.players.find((p) => p.isMe) ?? null;
    const others = view.players.filter((p) => !p.isMe);
    const waiting = others.filter((p) => p.ready).map((p) => p.name);
    return {
      isHost: view.isHost,
      iAmIn: me?.ready ?? false,
      /** Everyone else who has said they want another game. */
      othersIn: waiting,
      others: others.length,
      gameName: view.routine?.preview.gameName ?? 'the same game',
    };
  });

  /** Reps actually done; resets to the task amount whenever the task changes. */
  protected readonly reps = linkedSignal(() => this.vm()?.myTask?.task.amount ?? 0);
  /** Stake to raise to; follows the table's minimum raise. */
  protected readonly betAmount = linkedSignal(() => {
    const b = this.vm()?.betting;
    return b ? Math.min(Math.max(b.minRaise, 2), b.maxBet) : 0;
  });

  constructor() {
    // A live game gets the whole screen, like solo play.
    inject(DestroyRef).onDestroy(inject(ShellService).requestImmersive());
    effect(() => {
      const r = this.rooms.rejection();
      if (r) this.showToast(REJECTION_TEXT[r.reason] ?? `Not allowed (${r.reason}).`);
    });
    effect(() => {
      const events = this.rooms.events();
      const me = this.rooms.me();
      const text = events.flatMap((e) => this.describe(e, me)).at(-1);
      if (text) this.announcement.set(text);
    });
    effect(() => {
      const events = this.rooms.events();
      const state = this.rooms.state();
      const wins = events.filter((e) => e.type === 'RoundWon');
      if (!wins.length || !state || state.phase === 'finished') return;
      const who = wins.map((w) => this.playerName(w.playerId));
      // The same number the header shows (the engine counts rounds from 1 where a game has a counter).
      const round = wins[0].round || counter(state, 'round') || 1;
      const subject =
        who.length === 1 ? who[0] : `${who.slice(0, -1).join(', ')} and ${who.at(-1)}`;
      const verb = who.length === 1 && who[0] === 'You' ? 'win' : who.length > 1 ? 'win' : 'wins';
      this.showToast(`${subject} ${verb} round ${round}`);
    });
    effect(() => {
      const challenge = this.rooms.events().find((e) => e.type === 'ClaimChallenged');
      if (!challenge) return;
      const start = this.rooms.start();
      const name = (id: string) =>
        id === this.rooms.me() ? 'You' : start ? playerLabel(start.players, id) : 'A player';
      const verdict = challenge.lied
        ? `${name(challenge.claimant)} was bluffing`
        : `${name(challenge.claimant)} told the truth`;
      this.showToast(
        `${name(challenge.playerId)} called — ${verdict}. ${name(challenge.loser)} takes the pile.`,
      );
    });
  }

  /** "You" for this device, else the player's name. */
  private playerName(id: string): string {
    if (id === this.rooms.me()) return 'You';
    const start = this.rooms.start();
    return start ? playerLabel(start.players, id) : 'A player';
  }

  /** What a screen reader should hear about one event, if anything. */
  private describe(e: EngineEvent, me: string | null): string[] {
    const start = this.rooms.start();
    if (!start) return [];
    const cards = new Map(start.deck.cards.map((c) => [c.id, c]));
    const exercises = new Map(start.exercises.map((x) => [x.id, x]));
    const named = (id: string) => {
      const card = cards.get(id);
      if (!card) return 'a face-down card';
      const ex = card.exerciseId ? exercises.get(card.exerciseId) : undefined;
      return card.suit === 'joker'
        ? 'a joker'
        : `${card.rank} of ${SUIT_NAME[card.suit]}${ex ? `, ${ex.name}` : ''}`;
    };
    const playerName = (id: string) => (id === me ? 'You' : playerLabel(start.players, id));
    switch (e.type) {
      case 'CardsDealt':
        return e.faceUp ? [`Dealt ${e.cardIds.map(named).join(', ')}`] : [];
      case 'CardFlipped':
        return [`Flipped ${named(e.cardId)}`];
      case 'CardPlayed':
        return [`${playerName(e.playerId)} played ${named(e.cardId)}`];
      case 'CardsRevealed':
        return [`Revealed ${e.cardIds.map(named).join(', ')}`];
      case 'TaskAssigned': {
        const t = e.task;
        if (t.playerId !== me) return [];
        const name = t.exerciseId
          ? (exercises.get(t.exerciseId)?.name ?? 'exercise')
          : (JOKER_TASK[t.kind] ?? 'exercise');
        return [`Your task: ${t.amount} ${t.measure === 'seconds' ? 'seconds' : 'reps'} ${name}`];
      }
      case 'RoundWon':
        return [`${playerName(e.playerId)} won the round`];
      case 'GameOver':
        return ['Game over'];
      default:
        return [];
    }
  }

  private showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3500);
  }

  /** The game's rules, without leaving the table. */
  protected showRules(): void {
    const start = this.rooms.start();
    if (!start) return;
    const settings = start.settings;
    const data: HowToPlayData = {
      name: start.game.name,
      summary: start.game.summary,
      steps: start.game.howTo ?? [],
      facts: [
        `${start.players.length} players`,
        `${start.deck.name}`,
        `${INTENSITY_LABEL[settings.intensity ?? 'moderate']} intensity`,
        ...(settings.repMultiplier === 1 ? [] : [`×${settings.repMultiplier} reps`]),
        ...(settings.maxRepCap ? [`max ${settings.maxRepCap} per task`] : []),
        `jokers: ${settings.jokerRule}`,
      ],
    };
    this.dialog.open(HowToPlayDialog, { data, maxWidth: '520px' });
  }

  protected play(cardId: string): void {
    this.rooms.dispatch({ type: 'play', cardId });
  }

  protected toggle(cardId: string): void {
    const max = this.vm()?.bluff?.maxCards ?? 0;
    const next = new Set(this.selected());
    if (next.has(cardId)) next.delete(cardId);
    else if (next.size < max) next.add(cardId);
    this.selected.set(next);
  }

  protected claim(): void {
    const hand = new Set(this.vm()?.myHand.map((c) => c.id));
    const cardIds = [...this.selected()].filter((id) => hand.has(id));
    if (!cardIds.length) return;
    this.rooms.dispatch({ type: 'claim', cardIds });
    this.selected.set(new Set());
  }

  protected bet(amount: number): void {
    this.rooms.dispatch({ type: 'bet', amount });
  }

  protected call(): void {
    this.rooms.dispatch({ type: 'call' });
  }

  protected flip(): void {
    this.rooms.dispatch({ type: 'flip' });
  }

  protected pass(): void {
    this.rooms.dispatch({ type: 'pass' });
  }

  protected complete(taskId: string, amount?: number): void {
    this.rooms.dispatch({
      type: 'completeTask',
      taskId,
      ...(amount === undefined ? {} : { amount }),
    });
  }

  /** Host: same routine, fresh deal, everyone at the table included. */
  protected async rematch(): Promise<void> {
    if (this.starting()) return;
    this.starting.set(true);
    this.nextError.set(null);
    try {
      this.nextError.set(await this.rooms.rematch());
    } finally {
      this.starting.set(false);
    }
  }

  /** Host: back to the lobby, where the routine can be swapped. */
  protected changeGame(): void {
    this.rooms.endGame();
  }

  /** Player: tell the host you want another game. */
  protected wantRematch(): void {
    this.rooms.wantRematch();
  }

  protected skip(taskId: string): void {
    this.rooms.dispatch({ type: 'skipTask', taskId });
  }
}
