import { Routes } from '@angular/router';
import { sessionGuard } from './features/play/session.guard';
import { roomCodeGuard } from './features/rooms/room-code.guard';
import { unsavedChangesGuard } from './shared/unsaved-changes.guard';

// §8. Every feature route is lazy-loaded; route params bind to component inputs.
export const routes: Routes = [
  { path: '', title: 'DeckFit', loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent) },
  {
    path: 'library',
    title: 'Library · DeckFit',
    loadComponent: () => import('./features/library/library.component').then((m) => m.LibraryComponent),
  },
  {
    path: 'library/new',
    title: 'New exercise · DeckFit',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/library/exercise-editor.component').then((m) => m.ExerciseEditorComponent),
  },
  {
    path: 'library/:exerciseId/edit',
    title: 'Edit exercise · DeckFit',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/library/exercise-editor.component').then((m) => m.ExerciseEditorComponent),
  },
  {
    path: 'library/:exerciseId',
    title: 'Exercise · DeckFit',
    loadComponent: () => import('./features/library/exercise-detail.component').then((m) => m.ExerciseDetailComponent),
  },
  {
    path: 'decks',
    title: 'Decks · DeckFit',
    loadComponent: () => import('./features/decks/deck-list.component').then((m) => m.DeckListComponent),
  },
  {
    path: 'decks/:deckId/edit',
    title: 'Edit deck · DeckFit',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/decks/deck-editor.component').then((m) => m.DeckEditorComponent),
  },
  {
    path: 'games',
    title: 'Games · DeckFit',
    loadComponent: () => import('./features/games/game-catalog.component').then((m) => m.GameCatalogComponent),
  },
  {
    path: 'games/new',
    title: 'New game · DeckFit',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/games/builder/game-builder.component').then((m) => m.GameBuilderComponent),
  },
  {
    path: 'games/:gameId/edit',
    title: 'Edit game · DeckFit',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/games/builder/game-builder.component').then((m) => m.GameBuilderComponent),
  },
  {
    path: 'routines/new',
    title: 'New routine · DeckFit',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/routines/routine-editor.component').then((m) => m.RoutineEditorComponent),
  },
  {
    path: 'routines/:id/edit',
    title: 'Edit routine · DeckFit',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./features/routines/routine-editor.component').then((m) => m.RoutineEditorComponent),
  },
  {
    path: 'play/:sessionId',
    title: 'Play · DeckFit',
    data: { immersive: true }, // app shell hides toolbar and nav
    canActivate: [sessionGuard],
    loadComponent: () => import('./features/play/table.component').then((m) => m.TableComponent),
  },
  // 'room/new' must precede 'room/:code'.
  {
    path: 'room/new',
    title: 'New room · DeckFit',
    loadComponent: () => import('./features/rooms/room-create.component').then((m) => m.RoomCreateComponent),
  },
  {
    path: 'room/:code',
    title: 'Room · DeckFit',
    canActivate: [roomCodeGuard],
    loadComponent: () => import('./features/rooms/lobby.component').then((m) => m.LobbyComponent),
  },
  // 'challenges' must precede 'challenges/:code'.
  {
    path: 'challenges',
    title: 'Challenges · DeckFit',
    loadComponent: () => import('./features/challenges/challenge-list.component').then((m) => m.ChallengeListComponent),
  },
  {
    path: 'challenges/:code',
    title: 'Challenge · DeckFit',
    loadComponent: () => import('./features/challenges/challenge-detail.component').then((m) => m.ChallengeDetailComponent),
  },
  {
    path: 'history',
    title: 'History · DeckFit',
    loadComponent: () => import('./features/history/history.component').then((m) => m.HistoryComponent),
  },
  {
    path: 'settings',
    title: 'Settings · DeckFit',
    loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '**', redirectTo: '' },
];
