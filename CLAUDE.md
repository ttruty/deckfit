# CLAUDE.md — DeckFit (working title)

Living specification for an Angular PWA that turns a deck of exercise cards into
workout games, solo or with friends on multiple devices. Inspired by the
*mechanics* of exercise-card games such as Stack 52. Keep this file current: when
a decision changes, update this file in the same commit.

---

## 1. Product summary

Users pick (or build) a **deck** of exercise cards, pick (or build) a **game**,
tune the settings, and play. A saved combination of deck + game + settings is a
**routine**. Games can be played solo offline, or in a **room** that other
devices join with a code/QR and play in real time.

### Goals
- Start a workout in under 10 seconds from app open (one-tap routines).
- Every game is data, not code: built-in games and user-built games run on the
  same rules engine.
- Fully usable offline for solo play; installable PWA on iOS/Android/desktop.
- Live multiplayer across devices with a single authoritative game state.

### Non-goals (v1)
- No accounts beyond anonymous device identity (optional sign-in later).
- No social feed, leaderboards across strangers, or payments.
- No video hosting; exercise demos are optional external links or local media.

### Content rule (important)
Do **not** copy Stack 52 card text, exercise descriptions, artwork, game names
or game write-ups. Game mechanics are fine to model; all names, descriptions,
and exercise content in `src/assets/content/` must be original. Built-in game
names in this file are already original — use them.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Framework | Angular (latest stable), standalone components, signals, new control flow (`@if`, `@for`) |
| PWA | `@angular/pwa` service worker, manifest, offline asset caching |
| UI | Angular Material (M3) + CDK (drag-drop for deck/rule builders) |
| Forms | Reactive typed forms (`FormGroup<T>`), custom validators for rule definitions |
| State | Signal-based stores (`signal`, `computed`) per feature; no NgRx unless complexity demands it |
| Local persistence | IndexedDB via Dexie |
| Realtime sync | Supabase Realtime (broadcast + presence) behind a `SyncTransport` interface — see §7 |
| Validation | Zod schemas shared by forms, import/export, and network messages |
| Tests | Vitest (unit), Playwright (e2e, incl. two-browser multiplayer tests) |
| Lint/format | ESLint (angular-eslint) + Prettier |

Deliberately excluded: localStorage for app data (use Dexie), any server-side
rules logic in v1 (host device is authoritative).

---

## 3. Commands

```bash
npm install
npm start               # ng serve
npm test                # vitest
npm run e2e             # playwright (starts ng serve -c local on :4310; uses installed Chrome)
npm run start:local     # ng serve with environment.local.ts (real Supabase)
npm run lint
npm run build           # production build with service worker
npm run content:build   # python3 tools/build_content.py (regenerates assets/content except games.json)
npm run content:preview # tools/out/card-preview.html contact sheet
npm run content:shots   # Playwright screenshots of the contact sheet
npm run contrast        # WCAG AA check of the card palette in both themes (tools/check_contrast.mjs)
npm run icons           # regenerate the app icon set from tools/build_icons.mjs (§11)
npm run check:realtime  # is the Supabase Realtime backend working? (subscribe, broadcast, presence, two clients)
npm run serve:pwa       # production build served on :4311 (service worker; used by the offline e2e)
BASE_HREF=/<repo>/ npm run build:pages   # GitHub Pages build (base href, 404.html fallback, .nojekyll)
npx http-server dist/deckfit/browser -p 8080   # test SW/offline locally
```

Environment: `src/environments/environment.ts` (committed, empty) holds `supabaseUrl`
and `supabaseKey`; with them empty, rooms use the in-memory LoopbackTransport —
they exist only in that browser, so `npm start` + a second browser gives
"Room not found". Use `npm run start:local` for real rooms, and
`npm run check:realtime` when the backend itself is in doubt; the room screens
say so when no backend is configured (`REALTIME_CONFIGURED`). Real
values go in `environment.local.ts` (gitignored), swapped in by the `local`
configuration. `supabaseKey` must be a publishable/anon key — it ships to browsers;
never a secret or service-role key. Multiplayer e2e specs skip when it's absent.

---

## 4. Project structure

```
src/app/
  core/
    db/                 # Dexie database, migrations, repositories
    sync/               # SyncTransport interface, Supabase impl, local (loopback) impl
    identity/           # anonymous device id, display name, avatar color
    audio/              # beeps, countdowns, speech synthesis cues
    wake-lock/          # Screen Wake Lock service
    pwa/                # service-worker update prompt (§11)
    safety/             # §12 disclaimer dialog + service
    settings/           # device preferences stored in `meta`
    content/            # pose library loader, content seeding service
    theme/              # data-theme on <html> (system/light/dark)
    time/               # injectable Clock (tests swap in FakeClock)
  domain/
    models/             # TS types + Zod schemas (§5)
    engine/             # pure rules engine, no Angular imports (§6)
    shuffle/            # seeded RNG (mulberry32) + Fisher–Yates
  features/
    home/               # routines list, quick start
    library/            # exercise browser, filters
    decks/              # deck list + deck editor
    games/              # game catalog + custom game builder
    routines/           # routine editor (deck + game + settings)
    play/               # table view, card components, timers, rep counters
    rooms/              # create/join room, lobby, presence
    history/            # completed sessions, totals
    settings/
  shared/
    ui/                 # card-face, suit-badge, timer-ring, stepper, etc.
src/testing/            # test-only helpers (fake-indexeddb DB, fake clock, content loaders); excluded from the app build
src/assets/content/     # GENERATED by tools/build_content.py — do not hand-edit
  poses.json            # pictogram pose library (joint coordinates)
  exercises.json        # 120 built-in original exercises
  decks.json            # 10 built-in 54-card decks
  games.json            # built-in game definitions (engine DSL, hand-written; not generated)
src/styles/_card-tokens.scss   # palette, fonts, card + figure styles
tools/
  build_content.py      # source of truth for poses, exercises, decks
  build_preview.mjs     # contact sheet of every card → tools/out/card-preview.html
  build_icons.mjs       # the app icon, drawn in code → public/icons, favicon.svg/.ico (npm run icons)
  brand/                # GENERATED: icon.svg, icon-maskable.svg (the mark, for reuse)
  check_contrast.mjs    # WCAG AA check of the card tokens (npm run contrast)
  shot.cjs              # Playwright screenshots of the contact sheet for visual QA
```

Rule: `domain/engine` must stay framework-free and 100% unit-testable
(`domain/framework-free.spec.ts` fails on any import other than zod/relative).
Content version: bump the `version` of any content file you change, or
already-seeded devices will never see the change (§10).
Keep Zod and Dexie out of the initial bundle: code reachable from `app.config`
or `app.routes` must import them lazily (`import()`); the shell avoids
Material menu/tooltip (overlay) for the same reason. UI never
mutates game state directly; it dispatches intents to the engine.

---

## 5. Domain model

```ts
type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker';
type Rank = 'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'JOKER';
type MuscleGroup = 'legs'|'arms'|'chest'|'shoulders'|'back'|'core'|'cardio'|'full-body'|'mobility';
type Equipment = 'none'|'dumbbell'|'kettlebell'|'barbell'|'band'|'ball'|'suspension'|'mat';

interface Exercise {
  id: string;
  name: string;
  description: string;          // original text, short
  cues?: string[];              // form cues
  category: 'bodyweight'|'dumbbell'|'kettlebell'|'barbell'|'band'|'ball'|'suspension'|'flexibility'|'yoga'|'running';
  muscleGroups: MuscleGroup[];
  equipment: Equipment[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  measure: 'reps' | 'seconds';
  figure: FigureSpec;           // { start: poseId, end: poseId, prop } — see §9a
  adaptive?: { seated?: boolean; lowImpact?: boolean; notes?: string };
  mediaUrl?: string;
  builtIn: boolean;
}

interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  exerciseId: string | null;    // null for jokers
  baseAmount: number;           // reps (rank value) or seconds (rank value × 5)
}

interface SuitMapping {           // how a deck assigns meaning to suits
  suit: Suit;
  label: string;                // e.g. "Legs"
  color: string;                // theme token
  muscleGroups: MuscleGroup[];
}

interface Deck {
  id: string;
  name: string;
  category?: Exercise['category']; // built-in decks: the family their exercises come from
  suits: SuitMapping[];
  cards: Card[];                // usually 52 (+ optional jokers)
  builtIn: boolean;             // built-ins are read-only; "Duplicate to edit"
  basedOn?: string;
  updatedAt: number;
}

interface Routine {
  id: string;
  name: string;
  deckId: string;
  gameId: string;
  settings: GameSettings;       // overrides of game defaults
  deckFilters?: { suits?: Suit[]; maxDifficulty?: number; equipment?: Equipment[] };
  favorite: boolean;
  updatedAt: number;
}

interface GameSettings {
  intensity?: 'low' | 'moderate' | 'high'; // scales every task; absent on old records = moderate
  repMultiplier: number;        // 0.5–3
  faceCardValue: number;        // reps for J/Q/K
  aceValue: number;
  jokerRule: 'skip' | 'wild' | 'rest' | 'bonus-cardio';
  maxRepCap?: number;           // §12: cap on a task's multiplied amount
  timeLimitSec?: number;
  rounds?: number;
  players: { min: number; max: number };
  [key: string]: unknown;       // game-specific, validated by the game's settingsSchema
}

interface Session {               // one played game
  id: string;
  routineId?: string;
  roomId?: string;
  playerId?: string;            // which entry in `players` is this device (multiplayer)
  seed: number;                 // reproducible shuffles
  startedAt: number;
  endedAt?: number;
  outcome?: 'finished' | 'abandoned'; // absent while in progress
  game: { id: string; name: string };
  deck: DeckSnapshot;           // { id, name, suits, cards } as played (filters applied)
  settings: GameSettings;       // resolved
  players: { id: string; name: string }[];
  log: EngineEvent[];           // append-only
  intents?: Intent[];           // applied so far; replay from seed to resume
  totals: Record<string /*playerId*/, Record<string /*exerciseId*/, number>>;
}
```

Sessions are self-contained snapshots: later deck/routine edits never change
history, and replaying `intents` from `seed` must reproduce `log` exactly (the
play screen checks this on resume and restarts the workout if it doesn't).

All types are `z.infer`'d from Zod schemas in `domain/models/schemas.ts` (the
TS above is a summary; the schemas win). Import/export (JSON file share)
validates against them. Schema-level invariants: jokers are exactly
`suit: 'joker'` + `rank: 'JOKER'` + `exerciseId: null`; card ids are unique
within a deck and every card's suit has a mapping. `Pose`, `Prop` and
`FigureSpec` live there too; `figure-geometry.ts` imports them type-only.
`domain/models/content.spec.ts` parses every file in `src/assets/content` (a
file without a registered schema fails) and checks the §9b deck invariants.

---

## 6. Rules engine and games

### 6.1 Engine shape
Pure reducer: `(state, intent, ctx) => { state, events }`.

- **State**: piles (draw, discard, center, per-player hands/piles), turn order,
  phase, timers, scores, pending exercise tasks.
- **Intents**: `deal`, `flip`, `play(cardId)`, `claim`, `bet`, `call`, `pass`,
  `completeTask(taskId)`, `skipTask`, `timerElapsed`, `nextRound`, `leave`.
- **Events**: `CardsDealt`, `CardPlayed`, `TaskAssigned`, `TaskCompleted`,
  `RoundWon`, `GameOver`, … (these drive UI animation and the session log).
- **Tasks**: an assigned exercise = `{ playerId, cards[], amount, measure }`.
  Amount = sum of card values × `repMultiplier` (rounded), using settings for
  face cards/aces/jokers.

Determinism: all randomness comes from a mulberry32 RNG seeded by `Session.seed`,
so a host can resync any client by replaying the log. **The RNG position lives in
`GameState.rngState`, not in `ctx`**, so a snapshot (host migration, §7) resumes
the exact same shuffles. `ctx` holds only read-only inputs: settings, card and
exercise indexes, and the game's `GameRules`.

Implementation (`domain/engine`, Zod schemas for state/intents/events):
- `reduce()` handles `completeTask`/`skipTask` itself (game-agnostic) and
  delegates every other intent to `ctx.rules.apply` (the DSL interpreter).
  `rules.afterTask` runs after a successful task intent.
- Invalid intents don't throw: they return the unchanged state plus an
  `IntentRejected { intent, reason }` event (drives the "returned to hand" toast).
- `leave` (a player drops out, §7): they leave `turn.order` and are marked
  `left` in `players` (seats, teams and scores keep their shape), their pending
  tasks are skipped, and their hand and pile go face down to the discard pile.
  `PlayerLeft` is emitted, then `rules.afterLeave` closes a round the remaining
  players have already finished. Rounds only ever wait on `turn.order`.
- `rules.canActFor(state, actor, task, ctx)` lets one player complete or skip
  another's task (the judge, below); otherwise `not-your-task`.
- Task ids are `t<n>` from `state.nextId`, so logs are deterministic.

Amount rules (`domain/engine/amounts.ts`):
- Number cards use `card.baseAmount` (already ×5 for timed exercises; deck
  edits carry through). J/Q/K use `faceCardValue`, A uses `aceValue`, ×5 when
  the exercise is timed.
- One task per exercise per assignment (cards summed), in order of first
  appearance; jokers of the same rule are grouped into one task.
- Order: sum → × intensity → × `repMultiplier` → round half up → cap (`maxRepCap`
  reps, or `maxRepCap × 5` seconds). Zero-amount tasks are dropped.
- **Intensity** (`INTENSITY_FACTOR`: low 0.7, moderate 1, high 1.4) is the plain-language
  knob over the same maths as `repMultiplier`, and applies to reps and held seconds
  alike (a 10-rep card is 7 / 10 / 14). Rest is never scaled, and neither is a game's
  fixed work window — interval-deck still works 20 seconds, but the rep targets in it
  scale. Records saved before it read as `moderate` (`workScale()` is the one place
  that decides).
- Jokers by `jokerRule`: `skip` → no task; `rest` → 30s per joker, never
  multiplied or capped, not counted in totals; `wild` → `faceCardValue` reps
  per joker, multiplied and capped, and the player may name the exercise on
  `completeTask` (totals key = that exercise, else `wild`); `bonus-cardio` →
  60s per joker, multiplied and capped.
- `completeTask.amount` optionally logs work actually done (defaults to the
  task amount).

### 6.2 Game definition DSL (`games.json` and user-built games)
A game is JSON, validated by Zod (`domain/models/game.schema.ts`, strict
objects so typos fail) and run by the interpreter in `domain/engine/dsl`:

```jsonc
{
  "id": "end-match",
  "name": "End Match",
  "summary": "Lay out a row of four. When the two ends match, work both ends and clear the row; otherwise work the middle pair.",
  "players": { "min": 1, "max": 1 },
  "setup": { "shuffle": true, "deal": [{ "deal": { "to": "table", "count": 4, "faceUp": true } }] },
  "turn": {
    "steps": [
      { "if": { "count": "table", "lt": 4 },
        "then": [{ "assign": "table.all" }, { "move": "table.all", "to": "discard" }],
        "else": [
          { "if": { "match": ["table.first", "table.last"], "on": { "setting": "matchOn" } },
            "then": [{ "assign": ["table.first", "table.last"] }, { "move": "table.all", "to": "discard" }],
            "else": [{ "assign": "table.middle" }, { "move": "table.middle", "to": "discard" }] }
        ] },
      { "refill": { "zone": "table", "to": 4 } }
    ]
  },
  "end": { "when": { "all": ["draw.empty", "table.empty"] } },
  "scoring": "total-work",
  "settingsSchema": {
    "matchOn": { "type": "enum", "options": ["suit", "rank", "color"], "default": "suit", "label": "Ends match on" }
  },
  "builtIn": true
}
```

Primitives available to the DSL (keep this list the source of truth):
`deal`, `flip`, `move`, `refill`, `assign`, `compare(high|low)`, `match(suit|rank|color|adjacent-rank)`,
`timer(countdown|interval)`, `turn(next|all-simultaneous)`, `race`, `bet`,
`challenge`, `if/then/else`, `repeat`, `end.when`.

**Implemented**: `deal` (incl. to `hands`/`piles`), `flip`, `move`, `refill`,
`assign` (to current/each/winners/losers/owner), `timer` (countdown + interval),
`incr`/`reset` (counters), `winners` (compare high|low across players),
`turn: next`, `if/then/else`, `repeat`; turn modes sequential and
`simultaneous`; `actions` (`play`, `pass`) with `require`; `race`; draw
filter `only: { measure }`; conditions `<zone>.empty`, `anyEmpty`, `match`,
`compare`, `count`, `var`, `elapsed`, `setting equals`, `all/any/not`;
`end.when` + `end.then`; setup `filter` + `shuffle`; host `timing` policy;
scoring `total-work` | `rounds-won`. Numbers anywhere may be literals,
`{ "setting": k }` or `{ "var": name }` (`$players` = player count).
Hidden-information games (phase 7): game blocks `betting`, `bluff`, `teams`,
`hidden`; steps `startBetting`, `reveal`, `reshuffle`, `assignPot`,
`winners { by: poker | empty-team }`; deal target `teams`, selectors
`team.<pick>` / `teams.<pick>`; flags `betting`, `claim-open`.
`bet` = intents `bet`/`call`/`pass` in a betting round; `challenge` = `call`
on an open bluff claim. (`turn: all-simultaneous` is spelled
`{ mode: 'simultaneous' }`.)

Semantics (decided where the spec was ambiguous; each has a test in
`interpreter.spec.ts`):
- **Flow**: intent `deal` runs setup once (filter → shuffle → deal steps,
  phase → playing). Each `flip` intent runs one turn; rejected while *any* task
  is pending (`tasks-pending`) or if it isn't the player's turn. `timerElapsed`
  marks a named timer elapsed. Other intents → `not-supported` for now.
- **End**: `end.when` is checked whenever no tasks are pending — after setup, a
  turn, a completed/skipped task, or a timer. A time cap therefore lets the card
  in progress finish. `GameOver.scores` for `total-work`: 1 point per rep, 1 per
  5 seconds (the card-value scale); rest never scores.
- **Zones/selectors**: `<zone>.<first|last|middle|all>`; zones `draw`,
  `discard`, `table`, `hand`/`pile` (= current player's). Draw top is index 0.
  `middle` = all but first and last (empty for ≤2 cards). Selector lists are a
  union in order, deduped — so `[table.first, table.last]` on a one-card row
  assigns that card once. `move` skips cards already in the target zone.
- **Face-up**: `deal`/`refill` default face-up on the table, face-down
  elsewhere; `flip` is always face-up; cards moved off the table turn face-down.
- **deal to `hands`**: one card per player per pass, in turn order, stopping
  when draw runs out. `deal`/`refill` take what's available; no error when short.
- **match**: needs ≥2 distinct cards; `color` groups are red (♥♦), black (♣♠),
  and joker; `adjacent-rank` checks each consecutive pair, A is adjacent to
  both K and 2, jokers are never adjacent.
- **compare**: first card of each selector, rank order 2…10 J Q K A; false if
  either side is missing, both are the same card, or either is a joker.
- **timer**: named `id`; starting an id that is already running replaces it and
  clears its elapsed flag; `seconds` from an unset setting (null default) skips
  the step (how "optional time cap" works). The engine never reads clocks.
- **turn: next**: advances seat order; wrapping to seat 0 increments `round`.
- **incr / var** (added for pyramid-climb, interval-deck): `{ "incr": name,
  "by"?: n }` adds to a counter (starts at 0, stored as `vars["var:<name>"]`,
  no event). `{ "var": name }` reads it wherever a number is accepted;
  `{ "var": name, "gte": n }` (exactly one of lt/lte/eq/gte/gt) is a condition.
- **assign object form**: `{ "assign": { "cards": sel, "to"?: "current" |
  "each", "timedSec"?: n } }`. `each` gives every player their own tasks, in
  seat order (ids stay sequential). `timedSec` makes timed exercise and
  bonus-cardio tasks last exactly that long (a work window: not multiplied,
  not capped); reps tasks keep the card amount as a target and players log
  what they did via `completeTask.amount`; rest tasks keep 30s.
- **timer interval**: `{ kind: "interval", seconds, restSeconds? }` starts in
  phase `work`; `timerElapsed` during work emits `TimerElapsed{phase: work}` +
  `TimerStarted` for the same id in phase `rest`. `durationSec` is always the
  current phase's length. Only the end of rest (or of work, without
  `restSeconds`) removes the timer and satisfies `elapsed`. `restSeconds` on a
  countdown is a validation error.
- **Actors**: every step runs as a player. `hand`/`pile` = the actor's zone:
  the current player for setup, sequential turns, `turn.then`, and `end.then`;
  the sender for `play`/`pass` and for a simultaneous `turn.each`.
- **Player zones** (selectors only): `hands.<pick>` / `piles.<pick>` apply the
  pick to every player's zone in seat order (`piles.last` = each top card).
  `intent.card` = the card named by a `play` intent. `deal` to `hands`/`piles`
  goes one card per player per pass (piles face up by default).
- **Simultaneous turns** `{ mode: 'simultaneous', each, then }`: a player's
  `flip` runs `each` as them (rejected `already-acted` if repeated); when all
  players have acted, flags clear and `then` runs once. Rejected while any
  task is pending. A player who leaves the room blocks the round (open issue).
- **winners** `{ cards, wins }`: each player's first selected card (from their
  own hand/pile) is ranked 2…A; jokers never win. Top rank wins, ties at the
  top all win, but if every player with a card ties (2+), nobody wins. Emits
  `RoundWon` per winner (`round` = the `round` counter, else turn round),
  adds a win, and stores winners for `assign to: winners|losers`.
- **assign to owner**: each card goes to the player whose hand/pile held it
  (shared-zone cards go to the actor).
- **only { measure }** on deal/flip/refill: cards whose exercise has the other
  measure — and jokers — go to discard (`CardsMoved`) and the next card is drawn.
- **actions**: `play` requires the card in the sender's own hand
  (`not-in-hand`), then each `require { when, reason }` in order. Actions are
  rejected while the sender has pending tasks, before dealing, and once the
  game is ending. `reset` sets a counter back to 0.
- **race**: a sequential `flip` (or a simultaneous `then`) starts a race
  round; the first player whose round tasks are all done — none skipped — wins
  it (`RoundWon`, +1 win). Later finishers don't.
- **end.then**: when `end.when` first holds (no tasks pending), the steps run
  once (e.g. assign leftovers); GameOver follows when their tasks are done.
- **timing** `{ windowMs, intents }`: read by GameHost, not the engine (§7).
- **simulate()**: complete the first pending task; else elapse the first timer;
  else (action games) the first player in seat order with an accepted `play`
  plays it, otherwise players `pass` in rotation; else (simultaneous) the first
  player who hasn't acted flips; else the current player flips.
- **repeat**: count may be a setting; hard limit 1000.
- **hidden**: `true` marks a game whose hands and face-down cards are private
  (§7 privacy). Required when `betting` or `bluff` is present (validation error
  otherwise). The engine itself is unchanged; the host redacts per player.
- **betting** `{ maxBet, then }` + step `startBetting`: opens a round (vars
  `bet:*`, flag `betting`) with the current player to act. Only the current
  player may act (`not-your-turn`): `bet { amount }` raises their stake *to*
  `amount` (must exceed the stake to call and be ≤ `maxBet`, else `bad-bet`;
  a raise re-opens action for everyone); `call` matches it (`nothing-to-call`
  if already matched); `pass` checks when matched, else folds. Turn moves to
  the next player still in. The round closes when one player remains, or
  everyone still in has acted since the last raise with equal stakes; then
  `then` runs and the `bet:*` vars clear. `flip` is rejected while betting is
  open (`betting-open`). Events `BetPlaced{amount = total stake, pot}`,
  `PlayerChecked`, `PlayerFolded`. simulate(): call stakes ≤ 8 else fold; with
  nothing to call, raise by 2 while own stake < 4, else check.
- **winners by poker** `{ cards, by: "poker" }`: each non-folded player's
  selected cards are scored as a poker hand (`domain/engine/poker.ts`: up to 5
  cards; jokers are dead; A-2-3-4-5 is the lowest straight; no wrap-around);
  best hand wins, exact ties share.
- **reveal** selector: turns the cards face up once (`CardsRevealed`), skipping
  hands of folded players. **reshuffle**: discard → draw, shuffled with the
  game RNG (`CardsShuffled`; face-up flags cleared).
- **assignPot** `{ to: "losers" }`: every non-winner (folded included) gets one
  task for the pot: the exercise of the highest-ranked exercise card in their
  hand, pot × 1 rep (× 5 s if timed), capped by `maxRepCap`; not multiplied
  (the stake was agreed in play). Pot 0 → no task.
- **bluff** `{ maxCards }`: no `turn`; the current player sends
  `claim { cardIds }` (1..maxCards distinct cards from their hand, else
  `bad-claim`/`not-in-hand`): cards go face down to `table`, `ClaimMade{rank,
  count}` names the required rank (cycles A, 2 … K, then A), the actual ids stay
  in the secret var `secret:claim:cards`, turn passes on. Making a claim accepts
  the previous one; if that claimant's hand is now empty they win (flag
  `bluff:winner`, `RoundWon`, the new claim is not made). Any *other* player may
  `call` an open claim (`no-claim`, `own-claim`; not while tasks are pending):
  the claimed cards are revealed; the claim is a lie if any isn't the claimed
  rank (jokers are wild). The loser — liar, or wrong challenger — gets tasks
  for every card in the pile (normal amount rules) and takes the pile into their
  hand; if the claim was true and the claimant's hand is empty, they win.
  simulate(): call when the open claim is 2+ cards or its count + own cards of
  that rank > 4; else claim all matching cards (jokers too) up to the limit, or
  bluff with the lowest card.
- **judge** (game level, `true` or `{ setting }`): a rotating judge, seat by
  seat, one per round (round n → `turn.order[(n-1) % n]`, using the `round`
  counter when there is one). The judge is skipped by `assign to: 'each'`, so
  they get no tasks and can't win the round, and they may complete or skip any
  other player's task (`canActFor`). Needs 2+ players; off when its setting is
  false. `judgeOf(state, def, settings)` is exported for the UI.
- **teams** `{ size }`: teams are interleaved by seat (with T = ⌈players /
  size⌉ teams, seat s is on team s mod T); the lowest seat is the captain and
  holds the team's shared hand. Deal `to: "teams"` deals to captains;
  `team.<pick>` = the actor's team hand; `teams.<pick>` = every team hand;
  `anyEmpty: "teams"`; `winners { by: "empty-team" }` → every member of each
  team whose hand is empty wins. Turns rotate through all players in seat order,
  so teammates alternate.
- **Settings**: `{ "setting": "key" }` references resolve against the merged
  settings: `BASE_SETTINGS` (×1, face 10, ace 11, jokers `rest`) → game
  `defaults` → `settingsSchema` defaults → routine overrides (null = off).
  `settingsSchema` entries are typed (`enum`, `number` with min/max/step and
  nullable default, `boolean`, `suits`) so the routine form can be generated.
  Always-present core keys (multiplier, face/ace values, jokerRule, maxRepCap,
  players) can't be redeclared; optional core keys `timeLimitSec`/`rounds` can
  be, to opt in. Unknown setting references fail validation.

Golden logs: `dsl/games.golden.spec.ts` plays every built-in game on the
bodyweight deck with seed 2026 via `simulate()` (also the builder's dry-run
driver) and compares the full event log to `dsl/__golden__/*.json`, plus
rule-level invariants checked independently of the interpreter. An intended
behavior change: delete the affected golden file, re-run `npm test` to record
it (`ng test` has no `-u`), and review the git diff before committing.

If a built-in game needs something the DSL can't express, add a primitive — do
not write a one-off game component.

### 6.3 Built-in games (original names)

Every built-in game carries `howTo`: three or four plain-language steps (no jargon,
no engine words). They show as "How to play" in the catalog and the room lobby (the
routine preview carries `gameHowTo`, so a joiner reads them without the game
installed) and behind the **Rules** button while playing. Custom games get the same
field in the builder's Basics section. Keep them short and original (§1 content rule).

| Id | Players | Mechanic |
|---|---|---|
| `solo-deal` | 1 | Flip one card at a time, do it. Optional suit filter and time cap. |
| `end-match` | 1 | Deal 4; if ends match (setting: suit/rank/color), do both ends and clear; else do middle two. |
| `pyramid-climb` | 1 | Work through rows of increasing card count. Row n = n cards, `rows` setting (default 5); ends early if the deck runs out. |
| `interval-deck` | 1–6 | Tabata-style: 8 rounds of 20s work / 10s rest, card sets the exercise; score = reps logged. Settings `rounds`/`workSec`/`restSec`; every player gets the round's card; timed exercises hold for the work window; jokers default to `skip` (a free round). The play screen currently drives one player per device. |
| `high-card-duel` | 2–6 | Everyone flips; highest wins, everyone else does all flipped cards. Simultaneous turn; `rounds` (6); rounds-won scoring; all-tie → nobody wins. |
| `neighbor-rush` | 2–6 | Simultaneous play onto a center card that is ±1 rank or same suit; stuck players draw; leftover cards at end = exercises. Action game (`play`/`pass`); `handSize` (5); ends when a hand empties, or the draw is empty and passes since the last play reach the player count; timing window 300ms on `play`. |
| `rep-race` | 2–6 | Everyone gets the same 3 (setting) rep-based cards; first to finish wins. Timed cards are redrawn. Optional judge role. `cards` (3), `rounds` (5), race + rounds-won; timing window 250ms on `completeTask`. Optional `judge` setting: a rotating judge sits the round out and marks the racers done (golden log `rep-race-judge.3p`). |
| `fit-poker` | 2–6 | Poker hands; bets are reps instead of chips; losers perform the pot. Hidden. Each `flip` deals a hand: old hands → discard, reshuffle, 5 cards each, betting; showdown reveals non-folded hands, best poker hand wins, every loser works the pot on their highest card. `rounds` (3 hands), `maxBet` (20); jokers `skip`. |
| `bluff-pile` | 3–6 | Cheat/Bluff rules; caught liar (or wrong challenger) performs the pile. Hidden. `handSize` (7), up to 4 cards per claim; first player to empty their hand with an accepted claim wins; jokers wild in claims, `skip` as tasks. |
| `team-relay` | 4–8 | Teams share a hand; teammates alternate tasks. Hidden. Teams of 2; `handSize` (6) per team; on your turn flip your team's next card face up and work it; first team to empty its hand wins (all its members). |

### 6.4 Custom game builder
Form-based editor (`features/games/builder`) that produces the same JSON:
1. Basics: name, players, end condition.
2. Setup: deal steps (CDK drag-drop list).
3. Turn steps: block editor for the primitives above with nested if/then/else.
4. Task rules: which cards get assigned, multipliers.
5. Settings: expose selected values as user-tunable settings.
6. **Dry run**: simulate 20 turns with a seeded deck and show the event log +
   estimated total reps/time before saving.

Validation errors map to the exact block in the form.

Implementation (`features/games`):
- **/games** (`GameCatalogComponent`): your games (Edit, Duplicate, Delete with undo; warns
  when routines use the game) and built-ins ("Duplicate to edit" → `/games/new?from=<id>`).
  `/games/:id/edit` on a built-in also opens a copy. Both builder routes use
  `unsavedChangesGuard`.
- **Model** (`builder/model`, pure, `model.spec.ts`):
  - `blocks.ts`: `Block { uid, kind, body, children }`. `body` = the step JSON minus its child
    lists, so any step round-trips exactly. `PRIMITIVES` = the palette (label, icon, group,
    a valid default).
  - `draft.ts`: `GameDraft { game, slots }`. Slots are the top-level step lists
    (`setup.deal`, `turn.steps`, `turn.each`, `turn.then`, `actions.play|pass.steps`,
    `betting.then`, `end.then`); a slot exists exactly when the game declares that list.
    Immutable tree ops: insert/move/remove/update/duplicate, add or remove `else`. A block
    can't move into its own descendants. `serializeDraft` → JSON plus each block's JSON path.
    Every built-in game round-trips exactly (tested).
  - `validation.ts`: each block is validated on its own with `STEP_SCHEMAS[kind]` (children
    stubbed) and conditions with `CONDITION_SCHEMAS` (exported by `game.schema.ts` for this),
    so errors land on the offending block with a short path ("count: Too small…"). Then
    `GameDefinitionSchema` runs for game-level rules: custom issues inside a block (unknown
    setting) are pinned to it, union noise from invalid blocks is dropped, and the rest become
    field problems (`name`, `players`, `end.when`, …).
  - `settings.ts`: "Make adjustable" (tune icon on a number, or "New setting…" for match-on)
    adds a settingsSchema entry (key from the label, never a core key) and references it with
    `{ setting }`. Removing a setting inlines its default everywhere; that's refused when the
    setting is referenced and its default is off (null).
- **UI** (`builder/`): `GameBuilderStore` (page-scoped signals over the draft) instead of
  reactive forms: the rules are a recursive tree that drag-drop reorders, and Zod is the
  validator. Sections: basics, setup (shuffle, suit filter, deal), turns (sequential /
  simultaneous / none, race, play/pass actions with requirements, speed timing), end
  (condition + optional final steps), task-rule defaults, teams/bluff/betting/hidden,
  adjustable settings, dry run. There's a sticky save bar ("N problems" jumps to the first
  one; saving is refused while invalid).
  - `BlockListComponent` is recursive: CDK `cdkDropList` per list, connected to every list
    id deepest first, plus `BlockPaletteComponent` as a copy-only source. Keyboard and
    touch alternative: per-list "Add step" menu and per-block menu (move up/down,
    duplicate, else, delete).
  - Placeholders are a 4px insertion line on purpose: CDK caches nested list rects at drag
    start, and full-height placeholders shift branches so nested drops miss.
  - Field editors are compact native controls. `SelectValueDirective` re-applies
    `<select [value]>` after `@for` renders the options.
  - Saved games are ordinary `GameDefinition`s in Dexie (`GameRepository.save`,
    `builtIn: false`), so routines, solo play and rooms run them on the same interpreter.
- **Dry run** (`domain/engine/dsl/dry-run.ts`): `simulate()` with `maxTurns: 20` (and a
  2000-intent safety stop) on the chosen deck, player count and seed, through the real
  engine; never throws (setting or script errors are reported). The estimate comes from
  completed tasks: reps, timed seconds, rest, and total ≈ seconds + rest + reps × 3 s.
  The panel shows stats, per-player rows, and a readable event log (`event-text.ts`).
- **Tests**: `model.spec.ts` (round trips, tree ops, pinning, settings, dry run, a built
  game running through `createDslRules`). `e2e/game-builder.spec.ts` covers the whole flow
  in a real browser:
  - drag from the palette and into a nested Then branch;
  - a bad value pinned to its nested block, and saving refused;
  - make a value adjustable, dry run twice with identical logs, save;
  - the setting appears in the routine form; Save & start, then Flip shows a task;
  - reopening the game restores the nested blocks.

---

## 7. Multiplayer (live, multi-device)

### Model: host-authoritative
- The device that creates a room is the **host** and runs the engine.
- Clients send **intents**; host validates, reduces, and broadcasts
  `{ seq, events, stateHash }`.
- Clients apply events in `seq` order; on gap or hash mismatch they request
  `snapshot` (full state + log).
- Private information (hands in poker/bluff) is sent only to the owning player
  via per-player channels; the public state never contains other hands.
  Implemented for games with `hidden: true` — see **Privacy** below.

### Transport
```ts
interface SyncTransport {
  createRoom(): Promise<RoomInfo>;          // returns 6-char code
  joinRoom(code: string, player: PlayerInfo): Promise<RoomInfo>;
  send(msg: NetMessage, to?: PlayerId): void;
  messages$: Observable<NetMessage>;
  presence$: Observable<PlayerPresence[]>;
  leave(): Promise<void>;
}
```
- `SupabaseTransport`: Realtime broadcast + presence, room code = channel name.
- `LoopbackTransport`: in-memory, used for solo play and tests.
All `NetMessage`s are Zod-validated on receipt; drop invalid ones.

### Timing-sensitive games (`neighbor-rush`, `rep-race`)
- Clients stamp intents with a clock-offset-corrected time (offset measured
  with ping on join).
- Host resolves conflicting plays on the same target by earliest corrected
  time, tie → lower seat index. Losing play is returned to hand with a toast.

### Resilience
- Host migration: if host is gone > 10s, the lowest-seat connected client
  becomes host using its latest snapshot.
- Rejoin with same device id restores seat and hand.
- Arriving mid-game: the host answers a joiner's `room-state-request` with the
  `start` payload marked `resumed`, so nobody is stranded in the lobby while the
  others play. A device already in the game (a reload) resumes as a player; any
  other device watches until the next game (`RoomGame.spectator`: no intents,
  the table shows "you're watching"). A resumed device never deals; if the room
  still calls it host (it reloaded inside the 10s window) it takes the game back
  over once its client has a snapshot — a hidden game can't, so it reports
  `host-left`.
- Dropouts: a player missing from presence for `LEAVE_AFTER_MS` (20s) is
  dropped from the running game by the host (engine `leave`), so a simultaneous
  round or someone's turn can't wait forever. They keep their room seat but are
  out of that game.
- Lobby shows code, QR, player list, ready toggles, and routine preview.
- After a game: the host deals the same routine again in one tap (everyone still at
  the table is in, including anyone who joined mid-game and watched) or takes the room
  back to the lobby to pick another game; other players say whether they're in, which
  is the lobby's ready flag. A finished game clears every ready flag, so "in" always
  means someone said so after this game.

Implementation (`core/sync`, framework-free except `sync.providers.ts`):
- **Messages** (`net-message.ts`): Zod union — game: `intent`, `events`
  (`{ seq, intent, events, stateHash }`), `snapshot-request`, `snapshot`
  (`{ seq, state, log }`); room: `room-state-request`, `room-state`, `ready`,
  `start`; clock: `ping`, `pong`; privacy: `key`, `key-request`, `private`
  (ciphertext of a `PrivateMessage`: `intent`, `view`, `view-request`).
  `SyncTransport` adds `updatePlayer()`.
- **Transports**: `SYNC_TRANSPORT_FACTORY` picks `SupabaseTransport` when the
  environment has URL + key, else `LoopbackTransport` on one app-wide hub.
  - `LoopbackTransport/Hub`: any number of in-memory peers; async microtask
    delivery, JSON round-trip, validation on receipt. Used by solo play and tests.
  - `SupabaseTransport`: one public Realtime channel per room
    (`deckfit:room:<CODE>`). Presence keyed by device id (a reconnect replaces the
    old entry; newest connection wins). One broadcast event `msg` carrying
    `{ to?, msg }`, delivered to everyone incl. self; addressed envelopes are
    dropped by others; every msg is Zod-validated. Create probes the code for
    existing members; join waits up to 4s for anyone present, else "not found".
    Realtime access is behind `RealtimeLike` (fake in `src/testing/fake-realtime.ts`).
- **GameHost / GameClient / createGame / promoteToHost**: host applies intents
  and broadcasts events with the intent; clients reduce locally, verify
  `stateHash`, and recover via snapshot on gap/mismatch (duplicates ignored).
  Host drops intents whose `playerId` ≠ `from`. `promoteToHost(client)`
  continues a running game from a client's state/seq/log. Hidden games use
  the privacy path below instead.
- **Privacy (hidden games)**: a public channel delivers every message to every
  member, so `to` hides nothing. Instead:
  - *Redaction* (`domain/engine/redact.ts`, pure): `visibleCardIds(state, p)` =
    face-up cards ∪ p's hand and pile ∪ p's team (captain's) hand ∪ cards of p's
    own tasks. `redactState` replaces every other card id with `'?'` (zones keep
    their length), zeroes `rngState`, drops `secret:` vars and other players'
    per-exercise totals, and turns other players' tasks on hidden cards into
    work only (`cardIds: ['?']`, `exerciseId: null`, amount/status kept).
    `redactEvents(before, events, after, p)` keeps an id if p could see it before
    or after the step or the step revealed it; `TaskCompleted.exerciseKey` of
    such hidden tasks → `'hidden'`.
  - *PrivateLink* (`private-link.ts`, WebCrypto): each device makes an
    ephemeral ECDH P-256 key pair per game and announces the public key (`key`;
    `key-request` asks everyone to re-announce; latest key per id wins). Peers
    derive an AES-GCM-256 key; `private { from, to, iv, data }` is encrypted with
    associated data `room|from|to`, so it can't be read by or redirected to
    anyone else. Sends wait for the peer's key (≤ 32 queued); ciphertext from a
    sender whose key isn't known yet is held; failures are dropped and counted.
  - *Host*: `GameHost({ privacy: link })` subscribes only to the link. Intents
    arrive privately (sender must be **seated** and equal `intent.playerId`;
    timing rules still apply); the host's own intents use `submit()`. After every
    step each other player gets `view { seq, state: redactState, events:
    redactEvents }`; `view-request` answers with the current view — to anyone in
    the room, not just players, so a latecomer can watch. A non-player's view is
    redacted against an id that holds nothing: hand sizes and turns, never a
    card. Nothing
    game-related goes on the public channel (no `events`/`snapshot`/`intent`).
  - *Clients*: `ViewClient` never runs the engine. It shows views (older `seq`
    ignored; a repeat of the current seq replaces state without re-animating)
    and requests a view whenever the host's key becomes known (start, host
    reload). `RoomSession.start` broadcasts hidden games with `seed: 0` (the
    real seed would let anyone replay the shuffle); the host keeps the real
    payload locally. On the host device the UI also gets only its own
    redacted view.
  - *Limits*: keys are unauthenticated (anonymous devices), so this protects
    hands from other players' apps and channel readers, not from an active
    impersonator announcing a key under someone else's id. The host device
    knows everything, and anyone with the room code can watch a hidden game
    (redacted: no card ids, no seed, no secret vars). A hidden game can't migrate hosts (only the host has the
    full state): on a host change RoomGame reports `problem: 'host-left'`; a
    host reload also ends it. WebCrypto needs a secure context (https or
    localhost); otherwise `problem: 'insecure-context'`. Others see how much
    work you're doing (task amounts), not which exercises.
- **RoomSession** (same on every transport): host-owned `RoomState` = code,
  hostId, **epoch**, **seats**, phase, routine (routine + Bundle + preview),
  ready map; rebroadcast on every change.
  - *Seats / rejoin*: `seats` lists ids in first-join order and never drops
    them, so a returning device id gets its old seat. A host that rejoins with no
    state is handed the room back by any peer that kept it.
  - *Names*: a device that never set one is called "You" locally, so every other
    screen renames it by seat — `core/identity/player-name.ts` (`seatName`,
    `playerLabel`) is the one place that decides, used by the room view and the
    table; only your own row ever says "You".
  - *After a game* (§7 above): `clearReady()` (the host calls it on GameOver),
    `readyAll()` + `start()` = rematch, `endGame()` = back to the lobby (phase
    `lobby`, ready cleared, `ownStart` dropped). Peers notice the phase going
    `playing` → `lobby` and fire `onEnd`, which is how `RoomService` drops the
    finished game while keeping the connection. A rematch never passes through the
    lobby: the second `start` replaces each device's RoomGame in place.
  - *Clock offset*: joiners (and everyone after a host change) ping the host 5×;
    offset = t1 − (t0+t2)/2 from the lowest-RTT sample; `hostNow()` stamps
    timing-sensitive intents.
  - *Host migration*: host absent from presence for 10s → the earliest-seated
    present player claims with epoch+1 (`hostAway` shows meanwhile). A newer
    epoch is accepted only while the old host is absent (or by the old host
    itself, and only from the rightful successor); same-term tie → earlier seat.
- **Timing conflicts** (GameHost `timing`, from the game's `timing`): listed
  intents are held; the first opens a `windowMs` window; the batch is applied
  by `sentAt` (client's `hostNow()`, else arrival), ties → lower seat, then
  arrival. The engine rejects plays that no longer apply (`no-match` → "Too
  late" toast). Clients stamp `sentAt` via `GameClient(…, hostNow)`.
- **RoomGame** (runtime per device, on `start`): host → GameHost with timing,
  deals; others → GameClient + snapshot request. On host migration to this
  device its client is promoted (`promoteToHost`, keeps timing). Exposes state
  updates and this player's rejections. `RoomStartService` builds the payload
  from the routine's bundle, else local built-ins (deck filters applied).
  Hidden games: every device opens a PrivateLink; the host runs GameHost in
  privacy mode, others a ViewClient; `problem$` as above.
  Presence lag: `ready` from a player not yet in presence is kept and applied
  when they appear. When a game finishes, the device saves it to History
  (`session-record.ts`, `Session.playerId` = this device); hidden games redact
  other players' totals, so only your own work is complete in the record.
- **Trust model**: public channels + anonymous devices mean `from` is
  self-declared and anyone with the room code can read and send. The rules above
  stop stale hosts, races, and accidents — not a deliberate forger. Hidden
  games add end-to-end encryption for hands (above); stronger identity or
  anti-cheat needs Supabase auth (RLS on realtime.messages) or signed keys.
- **UI** (`features/rooms`): `RoomService` keeps the connection across
  /room/new → /room/:code; the lobby leaves on destroy. Lobby: code, QR, copy/share
  link, presence with ready status and host badge, host-away notice, rename,
  ready toggle, routine preview, "Save routine to my device", host Start (enabled
  when `blocker` is null; dev builds honor `?seed=` for reproducible e2e deals).
  The lobby is a three-panel grid (invite / players / routine) that stacks on a phone:
  it declares `grid-template-areas` for one column too, or the named `grid-area`s have no
  lines to resolve against and every panel lands in the first cell (`e2e/rooms.spec.ts`
  checks the stack at 390px — `newDevice(browser, { phone: true })`).
  Getting there: Home has "Start a room" beside the join-by-code form, and every
  multiplayer game in /games has "Start a room" (`/room/new?game=<id>`, which
  preselects that game's routine). /room/new offers one default routine per
  built-in game with max players ≥ 2.
  While playing, the lobby shows `df-room-table` (full screen via
  `ShellService.requestImmersive`): players strip (wins, flipped / yet to flip /
  working out, and their card — face down (`df-card-back`) until they flip in a
  simultaneous round, so last round's card never lingers; every card shows again
  once the round resolves, to compare), center, your hand as playable cards (`data-card-id`), Flip /
  "Stuck? Draw a card" per game rules, your task (stepper), rejection toasts,
  final scores. Hidden games: face-down cards render as `df-card-back`; the
  players strip shows turn, team, stake/folded and any revealed cards
  (`.revealed[data-card-id]`); betting panel (pot, stake stepper, Bet/Raise to
  N, Call N, Check/Fold, "Deal a hand" for the next hand); bluff panel (select
  up to maxCards, "Claim N × rank", "Call bluff", pile count + last claim, a
  toast naming the challenge result); team games show your team's hand. A
  `problem` shows as a notice. Multiplayer sessions are not saved to History yet.
  When the game is over, the result panel carries what's next: the host gets
  **Play again** (`RoomService.rematch`, a fresh seed) and **Change game**
  (`endGame`, back to the lobby), everyone else gets **Play again** as "I'm in"
  and sees who else has said so. In the lobby the host has a **Game** picker
  (built-in group routines + this device's saved ones) that re-broadcasts the
  routine and un-readies everyone.
- **Tests**: unit specs drive several loopback / fake-Realtime peers
  (`room-session`, `room-resilience`, `game-client`, `supabase-transport`,
  and in `room-game`: a dropout dropped after 20s so the round resolves, and a
  judge marking another player's task done);
  `e2e/rooms.spec.ts` uses two–three real browser contexts against Supabase
  (join + see each other, reload keeps seat, host migration after 10s, the host
  swapping the game in the lobby, and a finished game → a player asks for another →
  the host deals it → Change game returns everyone to the lobby);
  `e2e/neighbor-rush.spec.ts` finds a seed with the real engine where both
  players hold a card fitting the center but not each other, clicks both at once,
  and checks exactly one lands and the other player gets the toast.
  Privacy: `redact.spec.ts` (redaction rules); `privacy.spec.ts` plays
  fit-poker, bluff-pile (3 devices) and team-relay (4) over fake Realtime and
  checks, against the host's true states by seq, that every card id in every
  view a device received is one it legitimately knew by then (never an unseen
  card of another hand), that no public payload but `start`/`room-state` names
  a card, that public `start.seed` is 0 and can't reproduce the deal, and that
  an eavesdropper can neither decrypt re-addressed ciphertext nor get a view
  (verified to fail when redaction is broken). `e2e/fit-poker.spec.ts`: two
  real browsers over Supabase; each hand is absent from the other screen and
  from every WebSocket frame the other browser receives until the showdown
  reveals both.

Decided: Supabase Realtime (behind `SyncTransport`). Keep all
vendor code inside `core/sync/*` so this stays swappable.

---

## 8. Routes / screens

| Route | Screen |
|---|---|
| `/` | Home: favorite routines (one-tap start), Quick Start, start or join a room |
| `/library` | Exercise library with filters (muscle, equipment, difficulty, adaptive) |
| `/library/:exerciseId` | Exercise detail, cues, "used in decks" |
| `/library/new`, `/library/:exerciseId/edit` | Exercise editor: figure poses + prop, classification (§9c) |
| `/decks` | Deck list (built-in + mine) |
| `/decks/:deckId/edit` | Deck editor: suit mappings, 52-card grid, swap exercise per card, auto-fill by suit |
| `/games` | Game catalog with rules summary |
| `/games/new`, `/games/:gameId/edit` | Custom game builder |
| `/routines/new`, `/routines/:id/edit` | Routine form: deck → game → settings (settings form generated from `settingsSchema`) |
| `/play/:sessionId` | Table view |
| `/room/new`, `/room/:code` | Lobby, then play |
| `/history` | Past sessions, totals per exercise/muscle group |
| `/settings` | Display name, theme, default intensity, sound, data export/import, safety notice, about (no units: nothing records weights) |

Lazy-load every feature route. Guard `/play` against a missing session and
`/room/:code` against an invalid code.

---

## 9. Play screen UX

- Card faces: large rank + suit badge in the suit's color, exercise name,
  amount (already multiplied), measure icon. Tap to open cues/demo.
- Task panel: current exercise, rep stepper or countdown ring, **Done** / **Skip**.
- Big touch targets (min 48px); readable at arm's length; landscape supported.
- Screen Wake Lock during play; audio + optional speech cues ("Ten squats").
- Motion: flip/deal animations via CSS; respect `prefers-reduced-motion`.
- Multiplayer: player strip with avatars, card counts, "working out" status.
- Results are said in words: every round raises a toast ("You win round 3"),
  and the end shows `df-game-result` — a headline ("You win!", "Ann wins!",
  "It's a tie", "Nobody scored"), places with 🏆, and each score with its unit
  spelled out plus what the unit means.
- Winning is celebrated: `df-fireworks` (CSS-only bursts in the suit colours,
  three cycles then gone) plays for a player who won — a tie celebrates both,
  and a spectator sees the winner's. Losing rows slump instead (a short fade and
  desaturate, staggered by place). Finishing a solo workout celebrates too.
  Every one of these sits behind `prefers-reduced-motion: no-preference`, and
  the fireworks render nothing at all under `reduce` (§9).
- The room table carries the game's one-line objective under the title and a
  **Rules** button; solo play has the same button in its bar.
- Accessibility: WCAG AA contrast, suits never conveyed by color alone,
  screen-reader announcements for dealt cards and assigned tasks.

Intensity (§6.1) is picked with one shared control, `shared/ui/intensity-picker`
(`df-intensity-picker`, low / moderate / high with a one-line explanation):
- Home's Quick Start and /room/new use the **device default** (`PreferencesService.intensity`,
  stored in `meta`), which /settings also sets; a saved routine carries its own.
- The routine form has it as the headline of step 3, with `repMultiplier` demoted to fine
  tuning under it, and a live example ("A 10-rep card asks for 14").
- In a room the host owns it: /room/new builds the routine at that level, and the lobby
  picker re-broadcasts the routine (so everyone re-readies). The lobby's routine facts and
  the in-play **Rules** dialog both name it.

Implementation (`features/play`):
- `SessionLauncher` creates the Session (random seed, deck snapshot after
  routine filters, resolved settings, device identity as the player);
  `/play/:id` runs it. Quick Start = bodyweight deck + solo-deal defaults.
- `PlayStore` (per page): GameHost on LoopbackTransport; persists after every
  applied intent (log, intents, totals), so reload/leave resumes; on GameOver
  sets `endedAt` + `outcome: finished`; "End" saves `outcome: abandoned`.
- Play route has `data.immersive`: the app shell hides toolbar and bottom nav.
- Table: `deal` is dispatched automatically on load; the player taps Deal/Next
  to `flip`. Card amounts on faces are already multiplied.
- Task panel: reps → stepper starting at the task amount (Done logs the stepper
  value). Timed → ring; Start runs a countdown with 3-2-1 ticks and
  auto-completes at 0 with the full amount; Done before Start logs the full
  amount; Done mid-countdown logs elapsed whole seconds.
- Engine timers (e.g. solo-deal time cap) are shown in the bar; the store
  measures them with the injectable `Clock` and dispatches `timerElapsed`. On
  resume a running timer restarts from its full duration.
- Deal animation is CSS on newly inserted cards (`li.dealt`), disabled under
  `prefers-reduced-motion`. Wake lock (`core/wake-lock`) and beeps/speech
  (`core/audio`) are no-ops where unsupported; audio unlocks on first tap.
  Beep/voice toggles are not persisted yet (TODO: `meta`).
- Wild jokers: the task panel offers the deck's exercises (`df-wild-picker`);
  the work is logged under the one you pick, or `wild` if you don't.

Accessibility (§9, done in the polish pass):
- Live regions: solo play and the room table announce dealt/flipped cards,
  your assigned task, round results and game over (`aria-live="polite"`,
  visually hidden). Speech cues are separate and optional.
- `ExerciseFigureComponent` is `role="img"` only with a `label`; unlabelled
  figures are `aria-hidden` (the card, tile or option names them).
- Suits never rely on colour alone: rank + pip glyph + the suit's label.
- `e2e/a11y.spec.ts` runs axe (WCAG 2.1 A/AA) over home, library, decks, games,
  history, settings, both editors, the routine form, the deck editor and a live
  workout, in **both** themes; the suite fails on any violation.

### 9a. Card visual system (implemented)

Original look; do not imitate any commercial deck's artwork or layout.

- **Palette** (`_card-tokens.scss`): paper `#eef2ef`, table `#d5ddd8`, ink
  `#1f2a44`, far-limb `#9aa3b5`; suit *plates* hearts `#d7263d`, diamonds
  `#e89a00` (dark text on it), clubs `#168378`, spades `#2e4ac9`, joker
  `#7b3fbf`, each with an `--on-*` text colour at AA. Dark theme swaps
  paper/ink. Suit **text** (rank, pip, suit labels) uses the separate
  `--suit-text-*` tokens — darker in light theme, lighter in dark — because the
  plate fills don't reach 4.5:1 on paper. Never colour text with a plate fill;
  `npm run contrast` checks every pair in both themes and fails under 4.5:1.
- **Type**: Big Shoulders Display (rank, amounts) and Atkinson Hyperlegible
  (everything else), self-hosted via `@fontsource` for offline use.
- **Card layout** (5:7): large rank + pip top-left in suit color; pictogram in
  the upper field; solid suit-colored plate at the bottom with exercise name,
  amount + unit, and the suit's label from the deck.
- **Cards size themselves.** `df-card-face` (and `.card-box` in the contact
  sheet) is a `container-type: inline-size` wrapper and the card's type is
  `8.5cqw`, so callers set a width and never a font-size. Below 132px the
  pictogram drops and the rank grows; below 74px only the rank, suit and amount
  remain — a 52px card in the players strip still reads "2♥ 2 reps".
- **Pictograms**: side-view figure facing right in a 100×100 box, ground at
  y=90. Thick round strokes, detached circular head, far limbs lighter. The
  **start pose is a ghost in the suit color, the end pose is solid ink** — this
  is the signature element. Holds use one pose.
- **Props** drawn from the figure's hands/feet: dumbbell, kettlebell, barbell
  plate, dashed band to an anchor (feet/front/behind/above/knees/hands),
  tinted ball (explicit x/y/r), suspension strap to a top anchor.
- Rendering lives in `shared/ui/exercise-figure/figure-geometry.ts` (pure) and
  `ExerciseFigureComponent`; `CardFaceComponent` composes the card.

### 9b. Built-in decks (implemented)

Ten decks: bodyweight, dumbbell, kettlebell, barbell, resistance band,
exercise ball, suspension, flexibility, yoga, running — 12 exercises each.

- Suits map to groups per deck family:
  strength decks — ♥ Legs, ♦ Push, ♣ Pull, ♠ Core;
  flexibility & yoga — ♥ Hips & legs, ♦ Shoulders & chest, ♣ Spine, ♠ Balance & calves;
  running — ♥ Drills, ♦ Strength, ♣ Running, ♠ Mobility.
- Each suit has 3 exercises sorted by difficulty: ranks 2–5 → easiest,
  6–9 → middle, 10/J/Q/K/A → hardest.
- Amount = rank value (2–10, J/Q/K = 10, A = 11); timed exercises ×5 seconds.
  `GameSettings.faceCardValue` / `aceValue` override at play time.
- Two jokers per deck (`exerciseId: null`), handled by `jokerRule`.

### 9c. User-made exercises (implemented)

`/library/new` and `/library/:exerciseId/edit` (`features/library/exercise-editor`).
Built-ins are read-only: their detail page offers "Duplicate to edit"
(`/library/new?from=<id>`), which is also what `/library/:id/edit` does for one.

- Typed reactive form: name, description, cues (add/remove), category,
  difficulty, measure, muscle groups, equipment, adaptations.
- Figure: start and end pose come from `PosePickerDialog`, a searchable grid of
  every pose in `poses.json` drawn with `ExerciseFigureComponent` (grouped by the
  first word of the pose id) — plus the prop (dumbbell/kettlebell/barbell, band +
  anchor, ball x/y/r, straps + attachment), with a live preview beside the form.
- `exercise-form.model.ts` (pure, spec'd) converts form ↔ `Exercise` and keeps
  the equipment list honest: a drawn prop always adds its equipment and drops
  "none". Saved through `ExerciseRepository` (`builtIn: false`), so user
  exercises appear in the library (tagged "Yours"), in the deck editor's picker,
  and in decks; deleting one warns when your decks use it.
- The deck picker starts narrowed to the deck's category and the suit's muscle
  groups, so it offers "N more match outside these filters — show all".
- `e2e/exercise-editor.spec.ts` builds an exercise with poses and a band, then
  puts it on a card and reloads the deck to prove it persisted.

Workflow for content changes: edit `tools/build_content.py` → run it →
`node tools/build_preview.mjs` → `node tools/shot.cjs` → look at every
changed card before committing. The script asserts each suit has exactly 3
exercises and every pose id exists.

---

## 10. Persistence and data

- Dexie tables: `exercises`, `decks`, `games`, `routines`, `sessions`, `meta`.
- Built-in content seeded from `assets/content/*.json` on first run and on
  content version bump (never overwrite user copies).
- Export/import: single JSON bundle (decks/games/routines), Zod-validated,
  downloaded from /settings (and shareable via the share sheet where it takes
  files — a separate button, since desktop Chrome would otherwise swallow the
  download).
- Device preferences (theme, beeps, speech, default intensity) live in `meta` too, loaded by
  `PreferencesService` from the lazy app initializer and written on change; no
  localStorage (§2).
- Room invites may carry a routine bundle so joiners don't need it locally.

Implementation (`core/db`):
- `DeckfitDb` (Dexie v1). Indexes only on real key types — IndexedDB can't
  index booleans, so `builtIn`/`favorite` filter in memory. Changing indexes =
  new `version(n)` with an upgrade; never edit a shipped version.
- Repositories (`repositories.ts`) Zod-validate every write. Built-ins are
  read-only through them (`ReadOnlyError`); `DeckRepository.duplicate()` makes
  the editable copy (`builtIn: false`, `basedOn`, fresh card ids).
- Seeding (`seed-content.ts`, run by `ContentSeedService` in an app
  initializer; failure is logged, never blocks): content version =
  `e<exercises.version>.d<decks.version>.g<games.version>` in `meta`. Bump a
  file's `version` to reseed. Upserts built-ins but skips any id whose stored
  row is a user record; built-ins dropped from content are deleted unless a
  routine (deck/game) or user deck (exercise) references them. One
  transaction, including the version stamp.
- Bundles (`BundleService`, schema in `domain/models/bundle.schema.ts`):
  export all user-made items, or selected routines plus the user
  decks/games/exercises they need. Built-ins are never bundled (referenced by
  id). Import is all-or-nothing: schema errors, built-in items or id
  collisions with built-ins, and unresolved references (within bundle ∪ DB)
  are reported together via `BundleImportError.problems`; same-id user
  records are replaced.
- Dexie wraps errors thrown inside `transaction()` callbacks (breaks
  `instanceof`): return a result from the transaction and throw after it.
- Tests use `core/db/testing.ts` (`provideTestDb()` = fresh fake-indexeddb
  factory per test). Don't use fake timers with Dexie; stub `Date.now`.

---

## 11. PWA requirements

- Installable manifest (icons, theme color, `display: standalone`).
- Service worker: prefetch app shell + content JSON; lazy cache media.
- Offline: everything except room create/join works.
- Update flow: `SwUpdate` → snackbar "New version — reload".
- iOS: test add-to-home-screen, safe-area insets, audio unlock on first tap.

Implementation:
- **The icon is drawn in code**: `tools/build_icons.mjs` (`npm run icons`) holds one SVG
  of the mark — an ink squircle, three fanned cards (hearts red, spades blue, paper
  front with a small heart pip) and a solid jumping-jack figure in the brand's stroke
  style (§9a) — and renders every file with Playwright Chromium: `public/icons/icon-*.png`
  at the manifest sizes, `icon-maskable-{192,512}.png` (art at 0.74 inside the safe zone,
  colour bleeding to the edges), `apple-touch-icon.png` (square tile, full-size art —
  iOS does its own rounding), `public/favicon.svg`, and a PNG-embedded `favicon.ico`
  at 16/32/48. Icons ≤ 152px drop the pip; below that it is noise. Edit the script,
  never the PNGs, and check the result at 48px before committing.
- `public/manifest.webmanifest`: name/short_name, description, theme and
  background colours, `standalone`, icons at every size with separate `any` and
  `maskable` entries, and shortcuts (room, library).
- `index.html`: `viewport-fit=cover`, per-scheme `theme-color`, apple
  mobile-web-app tags, the touch icon and both favicons (svg + ico).
- Safe areas: the toolbar pads the top inset, the bottom nav the bottom inset,
  content the side insets; immersive screens (play, room) carry all of them.
- Updates: `core/pwa/app-update.service.ts` (loaded lazily so the snackbar stays
  out of the initial bundle) shows "New version available — Reload" on
  `VERSION_READY`, offers a reload on `unrecoverable`, and re-checks every 30
  minutes; no-op when the service worker is disabled. Unit-tested.
- Audio unlock: the shell unlocks the AudioContext on the first pointer or key
  event anywhere, as iOS requires a gesture.
- Offline: `e2e/offline.spec.ts` loads the production build (`npm run serve:pwa`
  on :4311), waits for the service worker to control the page, goes offline, and
  plays a whole Quick Start workout, then checks the library and its figures.
- **Every font is self-hosted** (`@fontsource`: Big Shoulders, Atkinson,
  Roboto, Material Icons). Nothing is fetched from Google Fonts, or icons would
  render as their ligature text offline. `styles.scss` also carries the
  `.material-icons` rules that Google's stylesheet would otherwise provide.
- Startup tasks that load lazily from the shell (update prompt, safety notice)
  must check the injector is still alive before using it: the app can be torn
  down before a dynamic `import()` resolves, and the rejection fails `npm test`
  (Vitest treats unhandled errors as failures, so CI catches it).
- **Install prompt**: `core/pwa/install-prompt.ts` captures `beforeinstallprompt`
  in `main.ts` (it fires before Angular boots and is unusable later);
  `InstallService` turns it into a state — `installed` / `prompt` / `ios` /
  `none` — used by the Home banner (`df-install-banner`) and a Settings row.
  iOS never fires the event, so it gets the Share → Add to Home Screen steps.
  "Not now" is remembered in `meta` (`installDismissedAt`) and Settings can
  bring the offer back.

### Deploying to GitHub Pages

Static hosting over HTTPS suits this app: the backend is Supabase, and the
service worker and hidden-game crypto both need a secure context.

- `npm run build:pages` (`tools/build_pages.mjs`) builds with `--base-href`,
  copies `index.html` to `404.html` so deep links like `/room/ABC123` reach the
  router on a cold visit, and writes `.nojekyll`. Everything else is relative:
  manifest `id`/`scope`/`start_url` are `./`, so the app identifies as
  `/<repo>/`, and the service worker registers with that scope.
- `.github/workflows/pages.yml` runs the unit tests, writes
  `environment.local.ts` from the `SUPABASE_URL` / `SUPABASE_KEY` repository
  secrets (publishable key only — it ships to browsers), builds with
  `BASE_HREF=/<repo>/`, and deploys. Without those secrets the site still works
  for solo play; rooms fall back to the in-memory transport and say so.
- Set Settings → Pages → Source to "GitHub Actions".

---

## 12. Safety

- First-run disclaimer (consult a professional; stop if pain) stored in `meta`
  as `disclaimerAcceptedAt`: `DisclaimerService` opens it once per device and
  it can't be dismissed unaccepted; /settings shows the date and can re-open it.
- Difficulty and adaptive filters on every deck/routine.
- Max rep cap setting per task to avoid absurd multiplied totals.

---

## 13. Build phases

Work one phase at a time; within a phase, prefer one primary file per session
and finish it with tests before moving on.

1. **Scaffold** — Angular app, PWA, Material, routes stubbed, Dexie DB, seeding.
2. **Domain + engine** — models, Zod schemas, seeded RNG, reducer, DSL
   primitives; `solo-deal` and `end-match` passing unit tests.
3. **Library + decks** — done: content, pose library, card faces and figures
   (§9a–b), library screens, deck editor, duplicate built-ins, and user-made
   exercises with the pose picker (§9c).
4. **Routines + solo play** — routine form, table view, timers, history.
5. **Remaining solo/group-on-one-device games** — `pyramid-climb`, `interval-deck`.
6. **Multiplayer** — transport interface, loopback, Supabase, lobby, host
   authority, `high-card-duel`, then `rep-race`, `neighbor-rush`.
7. **Hidden-info games** — done: per-player private channels (§7 privacy),
   `fit-poker`, `bluff-pile`, `team-relay`.
8. **Custom game builder** — block editor + dry run. (Done: see §6.4.)
9. **Polish** — done: accessibility pass (§9) and axe suite, PWA manifest,
   update prompt, iOS safe areas and audio unlock, offline e2e (§11), WCAG AA
   card palette with `npm run contrast`, the `/settings` screen (name, theme,
   sound, export/import, safety, about), the first-run disclaimer (§12),
   multiplayer sessions in History, the wild-joker picker, the rep-race judge,
   and dropped players no longer blocking a round.

Ideas beyond the plan: sign-in for cross-device sync (§15), richer game-builder
blocks (roles, per-player conditions), a deck/exercise marketplace, and Health
app export.

---

## 14. Conventions for Claude

- Implement directly; don't produce long plans unless asked. Update this file
  when a decision changes.
- Engine changes require unit tests for every new primitive and every
  built-in game touched (golden event logs from fixed seeds).
- Multiplayer changes require a Playwright test with two browser contexts.
- Keep components presentational; logic lives in stores/services/engine.
- Use `inject()`, `input()`/`output()`, `OnPush` everywhere.
- No `any`; derive types from Zod where possible (`z.infer`).
- Never add third-party copyrighted exercise or game text, illustrations, or card designs to content files.
- New figures must pass visual QA on the contact sheet (no floating props, head clear of the ground, readable at 150px card width).

---

## 15. Open decisions

- ~~Realtime backend~~ — decided: Supabase Realtime behind `SyncTransport` (§7).
- Whether to add optional sign-in for cross-device sync of decks/routines.
- Exercise media: local illustrations vs. links only.
- Final app name and branding.
