import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DRY_RUN_TURNS, GameBuilderStore } from './game-builder.store';
import { describeEvent, formatDuration } from './model/event-text';
import { SelectValueDirective } from './fields/select-value.directive';

/** §6.4 step 6: play 20 seeded turns with scripted players and show the log and the estimated work. */
@Component({
  selector: 'df-dry-run-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectValueDirective, MatButtonModule, MatIconModule],
  templateUrl: './dry-run-panel.component.html',
  styleUrl: './dry-run-panel.component.scss',
})
export class DryRunPanelComponent {
  protected readonly store = inject(GameBuilderStore);
  protected readonly turns = DRY_RUN_TURNS;
  protected readonly format = formatDuration;

  protected readonly playerRange = computed(() => {
    const p = this.store.validation().game?.players ?? (this.store.draft().game['players'] as { min: number; max: number } | undefined);
    const min = Math.max(1, p?.min ?? 1);
    return Array.from({ length: Math.max(0, (p?.max ?? min) - min + 1) }, (_, i) => min + i);
  });

  protected readonly view = computed(() => {
    const r = this.store.dryRunResult();
    if (!r) return null;
    const exercises = this.store.exercisesById();
    return {
      ...r,
      lines: r.events.map((e) => ({ type: e.type, text: describeEvent(e, r.deck, exercises) })),
      players: r.players.map((p) => ({ id: p, est: r.perPlayer[p] })),
    };
  });

  protected setOption(key: 'deckId' | 'seed' | 'players', raw: string): void {
    this.store.dryRunOptions.update((o) => ({ ...o, [key]: key === 'deckId' ? raw : Math.max(0, Math.floor(Number(raw) || 0)) }));
  }

  protected newSeed(): void {
    this.store.dryRunOptions.update((o) => ({ ...o, seed: Math.floor(Math.random() * 1_000_000) }));
    this.run();
  }

  protected run(): void {
    this.store.runDryRun();
  }
}
