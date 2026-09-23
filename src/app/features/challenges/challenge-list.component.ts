import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { ChallengeError } from '../../core/challenges/challenge-gateway';
import { ChallengeService } from '../../core/challenges/challenge.service';
import { dayKey } from '../../domain/challenges/progress';
import { goalText, type ChallengeGoal } from '../../domain/models/challenge.schema';
import { Clock } from '../../core/time/clock.service';

const GOALS = [
  { kind: 'streak', label: 'A workout every day' },
  { kind: 'daily', label: 'A number of points every day' },
  { kind: 'total', label: 'A total before it ends' },
] as const;

/** §7b: your challenges, plus the two ways into one — start it, or join with a code. */
@Component({
  selector: 'df-challenge-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  templateUrl: './challenge-list.component.html',
  styleUrl: './challenges.scss',
})
export class ChallengeListComponent {
  protected readonly challenges = inject(ChallengeService);
  private readonly router = inject(Router);
  private readonly clock = inject(Clock);

  protected readonly goals = GOALS;
  protected readonly goalText = goalText;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly mine = resource({
    loader: async () => {
      // Opening the screen is also when this device's progress goes up (§7b).
      await this.challenges.syncAll();
      const today = dayKey(this.clock.epoch());
      return (await this.challenges.mine()).map((challenge) => ({
        challenge,
        over: challenge.endsOn < today,
        soon: challenge.startsOn > today,
      }));
    },
  });

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    kind: new FormControl<ChallengeGoal['kind']>('streak', { nonNullable: true }),
    points: new FormControl(150, { nonNullable: true, validators: [Validators.min(1), Validators.max(10_000)] }),
    days: new FormControl(7, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(90)] }),
    ante: new FormControl(20, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(500)] }),
  });

  protected readonly joinForm = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[A-Za-z0-9]{6}$/)] }),
  });

  /** What the wager comes to, so nobody agrees to something silly by accident. */
  protected worst(): number {
    return this.form.controls.ante.value * this.form.controls.days.value;
  }

  protected async create(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { name, kind, points, days, ante } = this.form.getRawValue();
      const start = new Date(this.clock.epoch());
      const end = new Date(start);
      end.setDate(end.getDate() + days - 1);
      const goal: ChallengeGoal = kind === 'streak' ? { kind } : { kind, points };
      const challenge = await this.challenges.create({
        name: name.trim(),
        goal,
        ante,
        startsOn: dayKey(start.getTime()),
        endsOn: dayKey(end.getTime()),
      });
      await this.router.navigate(['/challenges', challenge.code]);
    } catch (err) {
      this.error.set(message(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async join(): Promise<void> {
    if (this.joinForm.invalid || this.busy()) return;
    await this.router.navigate(['/challenges', this.joinForm.controls.code.value.toUpperCase()]);
  }
}

export function message(err: unknown): string {
  if (err instanceof ChallengeError) return err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}
