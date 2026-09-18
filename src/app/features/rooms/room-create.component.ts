import { ChangeDetectionStrategy, Component, effect, inject, input, resource, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { GameRepository, RoutineRepository } from '../../core/db/repositories';
import { IdentityService } from '../../core/identity/identity.service';
import { RoomRoutineService, ROOM_DEFAULT_PREFIX, ROOM_DEFAULT_ROUTINE_ID } from './room-routine.service';
import { REALTIME_CONFIGURED } from '../../core/sync/realtime-config';
import { RoomService } from './room.service';

@Component({
  selector: 'df-room-create',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  templateUrl: './room-create.component.html',
  styleUrl: './room-create.component.scss',
})
export class RoomCreateComponent {
  /** Query param: start a room for this game (from the game catalog). */
  readonly game = input<string>();

  private readonly routines = inject(RoutineRepository);
  private readonly games = inject(GameRepository);
  private readonly roomRoutines = inject(RoomRoutineService);
  private readonly rooms = inject(RoomService);
  private readonly identity = inject(IdentityService);
  private readonly router = inject(Router);
  /** False when no realtime backend is configured: the room won't be reachable from another device. */
  protected readonly realtime = inject(REALTIME_CONFIGURED);

  protected readonly name = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] });
  protected readonly routineId = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  /** Needed so (ngSubmit) fires and the native form submit is prevented. */
  protected readonly form = new FormGroup({ name: this.name, routineId: this.routineId });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Saved routines plus the built-in group default; only multi-player games are selectable. */
  protected readonly options = resource({
    loader: async () => {
      const [saved, games, defaults, me] = await Promise.all([
        this.routines.list(), this.games.list(), this.roomRoutines.defaultRoutines(), this.identity.me(),
      ]);
      const gameById = new Map(games.map((g) => [g.id, g]));
      this.name.setValue(me.name === 'You' ? '' : me.name);
      return [...defaults, ...saved].map((routine) => {
        const game = gameById.get(routine.gameId);
        return { routine, gameName: game?.name ?? 'Missing game', fitsGroup: !!game && game.players.max >= 2 };
      });
    },
  });

  constructor() {
    effect(() => {
      const opts = this.options.value();
      const wanted = this.game();
      if (!opts || this.routineId.value) return;
      // A game picked in the catalog wins; then Interval Deck (any group size); then the first group game.
      const forGame = wanted
        ? (opts.find((o) => o.routine.id === `${ROOM_DEFAULT_PREFIX}${wanted}`) ?? opts.find((o) => o.fitsGroup && o.routine.gameId === wanted))
        : undefined;
      const preferred = forGame ?? opts.find((o) => o.routine.id === ROOM_DEFAULT_ROUTINE_ID) ?? opts.find((o) => o.fitsGroup);
      this.routineId.setValue(preferred?.routine.id ?? '');
    });
  }

  protected async create(): Promise<void> {
    const option = this.options.value()?.find((o) => o.routine.id === this.routineId.value);
    if (!option || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.name.value.trim()) await this.identity.rename(this.name.value);
      const code = await this.rooms.create(await this.roomRoutines.build(option.routine));
      // Keep query params (dev builds accept ?seed= for reproducible e2e deals).
      await this.router.navigate(['/room', code], { queryParamsHandling: 'preserve' });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not create the room.');
    } finally {
      this.busy.set(false);
    }
  }
}
