import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Pose } from '../../shared/ui/exercise-figure/figure-geometry';

/** Loads the pose library once; cached by the service worker for offline use. */
@Injectable({ providedIn: 'root' })
export class PoseLibraryService {
  private http = inject(HttpClient);
  readonly poses = signal<Record<string, Pose> | null>(null);

  async load(): Promise<void> {
    if (this.poses()) return;
    this.poses.set(await firstValueFrom(this.http.get<Record<string, Pose>>('assets/content/poses.json')));
  }
}
