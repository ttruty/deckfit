import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, isDevMode, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BundleImportError, BundleService } from '../../core/db/bundle.service';
import { SUIT_SYMBOL } from '../../shared/labels';
import { QrCodeComponent } from '../../shared/ui/qr-code/qr-code.component';
import { RoomTableComponent } from './room-table.component';
import { RoomService } from './room.service';

@Component({
  selector: 'df-lobby',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, QrCodeComponent, RoomTableComponent],
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.scss',
})
export class LobbyComponent implements OnDestroy {
  /** Route param (validated and upper-cased by roomCodeGuard). */
  readonly code = input.required<string>();

  protected readonly rooms = inject(RoomService);
  private readonly bundles = inject(BundleService);
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

  protected readonly joinUrl = computed(() => new URL(`room/${this.code()}`, this.document.baseURI).href);
  protected readonly spelledCode = computed(() => `Room code ${this.code().split('').join(' ')}`);
  protected readonly myPlayer = computed(() => this.rooms.view()?.players.find((p) => p.isMe) ?? null);

  constructor() {
    effect(() => {
      const code = this.code();
      untracked(() => void this.connect(code));
    });
    effect(() => {
      const me = this.myPlayer();
      if (me && this.nameForm.pristine) untracked(() => this.nameForm.controls.name.setValue(me.name === 'You' ? '' : me.name));
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
      await this.rooms.startGame(Number.isInteger(seedParam) && seedParam >= 0 ? seedParam : undefined);
    } finally {
      this.starting.set(false);
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
    await navigator.share({ title: 'Join my DeckFit room', text: `Room code ${this.code()}`, url: this.joinUrl() }).catch(() => undefined);
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
      this.saveError.set(err instanceof BundleImportError ? err.problems.join(' ') : 'Could not save the routine.');
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
