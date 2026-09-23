import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ChallengeService, type ChallengeView } from '../../core/challenges/challenge.service';
import { goalText } from '../../domain/models/challenge.schema';
import { message } from './challenge-list.component';

/**
 * One challenge (§7b): the terms, where everyone stands, the pot, and what you owe. It refreshes
 * itself while open, so a friend finishing a workout shows up without a reload.
 */
@Component({
  selector: 'df-challenge-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './challenge-detail.component.html',
  styleUrl: './challenges.scss',
})
export class ChallengeDetailComponent {
  /** Route param: the six-character code. */
  readonly code = input.required<string>();

  protected readonly challenges = inject(ChallengeService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly view = signal<ChallengeView | null>(null);
  protected readonly status = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly copied = signal(false);

  protected readonly title = computed(() => this.view()?.state.challenge.name ?? 'Challenge');
  protected readonly goalText = goalText;

  constructor() {
    effect(() => {
      const code = this.code();
      untracked(() => void this.load(code));
    });
  }

  protected async join(): Promise<void> {
    await this.run(async () => {
      await this.challenges.join(this.code());
      await this.load(this.code());
    });
  }

  protected async leave(): Promise<void> {
    const challenge = this.view()?.state.challenge;
    if (!challenge || !confirm(`Leave "${challenge.name}"? Your days stay on the board.`)) return;
    await this.run(async () => {
      await this.challenges.leave(challenge.id);
      await this.load(this.code());
    });
  }

  protected async refresh(): Promise<void> {
    await this.run(() => this.load(this.code()));
  }

  protected async copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.code());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false);
    }
  }

  private async load(code: string): Promise<void> {
    this.status.set(this.view() ? 'ready' : 'loading');
    try {
      const view = await this.challenges.open(code);
      if (!view) {
        this.status.set('missing');
        return;
      }
      this.view.set(view);
      this.status.set('ready');
      this.listen(view.state.challenge.id);
    } catch (err) {
      this.error.set(message(err));
      this.status.set(this.view() ? 'ready' : 'error');
    }
  }

  /** Follows the challenge while this screen is open, so other people's days arrive live. */
  private watching: string | null = null;
  private listen(challengeId: string): void {
    if (this.watching === challengeId) return;
    this.watching = challengeId;
    const stop = this.challenges.watch(challengeId, () => void this.reload());
    this.destroyRef.onDestroy(stop);
  }

  private async reload(): Promise<void> {
    const view = await this.challenges.open(this.code()).catch(() => null);
    if (view) this.view.set(view);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (err) {
      this.error.set(message(err));
    } finally {
      this.busy.set(false);
    }
  }
}
