import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  isDevMode,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BundleImportError, BundleService } from '../../core/db/bundle.service';
import { GameRepository, RoutineRepository } from '../../core/db/repositories';
import { RoomRoutineService } from './room-routine.service';
import { SUIT_SYMBOL } from '../../shared/labels';
import { QrCodeComponent } from '../../shared/ui/qr-code/qr-code.component';
import { RoomTableComponent } from './room-table.component';
import { RoomService } from './room.service';
import { HowToPlayComponent } from '../../shared/ui/how-to-play/how-to-play.component';

@Component({
  selector: 'df-lobby',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    QrCodeComponent,
    RoomTableComponent,
    HowToPlayComponent,
  ],
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.scss',
})
export class LobbyComponent implements OnDestroy {
  /** Route param (validated and upper-cased by roomCodeGuard). */
  readonly code = input.required<string>();

  protected readonly rooms = inject(RoomService);
  private readonly bundles = inject(BundleService);
  private readonly routines = inject(RoutineRepository);
  private readonly games = inject(GameRepository);
  private readonly roomRoutines = inject(RoomRoutineService);
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  protected readonly starting = signal(false);

  protected readonly status = signal<'joining' | 'ready' | 'error'>('joining');
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly saved = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly suitSymbol = SUIT_SYMBOL;
  protected readonly canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  protected readonly nameForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] }),
  });
  protected readonly swapping = signal(false);
  protected readonly swapError = signal<string | null>(null);

  /**
   * Host only: what the room could play instead — the built-in group routines plus this device's
   * saved ones. Loaded once; changing it re-broadcasts the routine and clears everyone's ready.
   */
  protected readonly choices = resource({
    params: () => this.rooms.view()?.isHost === true,
    loader: async ({ params: isHost }) => {
      if (!isHost) return [];
      const [saved, games, defaults] = await Promise.all([
        this.routines.list(),
        this.games.list(),
        this.roomRoutines.defaultRoutines(),
      ]);
      const gameById = new Map(games.map((g) => [g.id, g]));
      return [...defaults, ...saved]
        .map((routine) => ({
          routine,
          gameName: gameById.get(routine.gameId)?.name ?? 'Missing game',
          fits: (gameById.get(routine.gameId)?.players.max ?? 0) >= 2,
        }))
        .filter((o) => o.fits);
    },
  });

  protected readonly joinUrl = computed(
    () => new URL(`room/${this.code()}`, this.document.baseURI).href,
  );
  protected readonly spelledCode = computed(() => `Room code ${this.code().split('').join(' ')}`);
  protected readonly myPlayer = computed(
    () => this.rooms.view()?.players.find((p) => p.isMe) ?? null,
  );

  constructor() {
    effect(() => {
      const code = this.code();
      untracked(() => void this.connect(code));
    });
    effect(() => {
      const me = this.myPlayer();
      if (me && this.nameForm.pristine)
        untracked(() => this.nameForm.controls.name.setValue(me.name === 'You' ? '' : me.name));
    });
  }

  ngOnDestroy(): void {
    void this.rooms.leave();
  }

  /** Host: start for everyone. Dev builds honor ?seed= so e2e tests get reproducible deals. */
  protected async startGame(): Promise<void> {
    this.starting.set(true);
    try {
      const seedParam = isDevMode() ? Number(this.route.snapshot.queryParamMap.get('seed')) : NaN;
      await this.rooms.startGame(
        Number.isInteger(seedParam) && seedParam >= 0 ? seedParam : undefined,
      );
    } finally {
      this.starting.set(false);
    }
  }

  /** Host: swap the room's routine (everyone un-readies and reads the new rules). */
  protected async changeRoutine(routineId: string): Promise<void> {
    const option = this.choices.value()?.find((o) => o.routine.id === routineId);
    if (!option || this.swapping()) return;
    this.swapping.set(true);
    this.swapError.set(null);
    try {
      this.rooms.setRoutine(await this.roomRoutines.build(option.routine));
    } catch (err) {
      this.swapError.set(err instanceof Error ? err.message : 'Could not change the game.');
    } finally {
      this.swapping.set(false);
    }
  }

  protected toggleReady(): void {
    this.rooms.setReady(!this.myPlayer()?.ready);
  }

  protected async rename(): Promise<void> {
    await this.rooms.rename(this.nameForm.controls.name.value);
    this.nameForm.markAsPristine();
  }

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.joinUrl());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false);
    }
  }

  protected async share(): Promise<void> {
    await navigator
      .share({
        title: 'Join my DeckFit room',
        text: `Room code ${this.code()}`,
        url: this.joinUrl(),
      })
      .catch(() => undefined);
  }

  /** Imports the routine (and any user-made deck/game/exercises it needs) from the room's bundle. */
  protected async saveRoutine(): Promise<void> {
    const bundle = this.rooms.view()?.routine?.bundle;
    if (!bundle) return;
    this.saveError.set(null);
    try {
      await this.bundles.importBundle(bundle);
      this.saved.set(true);
    } catch (err) {
      this.saveError.set(
        err instanceof BundleImportError ? err.problems.join(' ') : 'Could not save the routine.',
      );
    }
  }

  private async connect(code: string): Promise<void> {
    this.status.set('joining');
    try {
      await this.rooms.join(code);
      this.status.set('ready');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not join.');
      this.status.set('error');
    }
  }
}
