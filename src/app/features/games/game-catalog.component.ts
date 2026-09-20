import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { GameRepository, RoutineRepository } from '../../core/db/repositories';
import type { GameDefinition } from '../../domain/models/game.schema';
import { HowToPlayComponent } from '../../shared/ui/how-to-play/how-to-play.component';

const settingCount = (g: GameDefinition) => Object.keys(g.settingsSchema).length;

/** /games — built-in and user-built games, with the builder's entry points (§6.4, §8). */
@Component({
  selector: 'df-game-catalog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, HowToPlayComponent],
  templateUrl: './game-catalog.component.html',
  styleUrl: './game-catalog.component.scss',
})
export class GameCatalogComponent {
  private readonly games = inject(GameRepository);
  private readonly routines = inject(RoutineRepository);
  private readonly snack = inject(MatSnackBar);

  protected readonly data = resource({ loader: () => this.games.list() });

  protected readonly sections = computed(() => {
    const games = [...(this.data.value() ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const view = (g: GameDefinition) => ({
      game: g,
      multiplayer: g.players.max >= 2,
      players: g.players.min === g.players.max ? `${g.players.min} ${g.players.min === 1 ? 'player' : 'players'}` : `${g.players.min}–${g.players.max} players`,
      tags: [
        g.scoring === 'rounds-won' ? 'Most rounds wins' : 'Most work wins',
        ...(g.teams ? [`Teams of ${g.teams.size}`] : []),
        ...(g.hidden ? ['Your cards stay private'] : []),
        ...(g.timing ? ['Be quick'] : []),
        ...(settingCount(g) ? [`${settingCount(g)} ${settingCount(g) === 1 ? 'setting' : 'settings'} to tune`] : []),
      ],
    });
    return [
      { id: 'mine', title: 'Your games', games: games.filter((g) => !g.builtIn).map(view), empty: 'Build a game from rule blocks, or duplicate a built-in one.' },
      { id: 'built-in', title: 'Built-in games', games: games.filter((g) => g.builtIn).map(view), empty: 'No built-in games loaded.' },
    ];
  });

  protected async remove(game: GameDefinition): Promise<void> {
    const using = (await this.routines.list()).filter((r) => r.gameId === game.id);
    if (using.length && !window.confirm(`${using.length} ${using.length === 1 ? 'routine uses' : 'routines use'} “${game.name}” and won’t start without it. Delete anyway?`)) return;
    await this.games.delete(game.id);
    this.data.reload();
    const ref = this.snack.open(`Deleted “${game.name}”`, 'Undo', { duration: 6000 });
    if ((await firstValueFrom(ref.afterDismissed())).dismissedByAction) {
      await this.games.save(game);
      this.data.reload();
    }
  }
}
