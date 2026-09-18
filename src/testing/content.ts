import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PoseLibraryService } from '../app/core/content/pose-library.service';
import { PoseLibrarySchema } from '../app/domain/models/schemas';

/** Real pose library, served synchronously so figure components render without HTTP. */
export function providePoses() {
  const poses = PoseLibrarySchema.parse(JSON.parse(readFileSync(join(process.cwd(), 'src/assets/content/poses.json'), 'utf8')));
  const stub: Pick<PoseLibraryService, 'poses' | 'load'> = { poses: signal(poses), load: async () => undefined };
  TestBed.configureTestingModule({ providers: [{ provide: PoseLibraryService, useValue: stub }, provideRouter([])] });
}
