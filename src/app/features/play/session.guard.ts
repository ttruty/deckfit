import { Injector, inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * Sends /play/:sessionId home when the session does not exist in Dexie.
 * The repository is imported lazily: routes are eager, and Dexie/Zod must stay out of the initial bundle.
 */
export const sessionGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const injector = inject(Injector);
  const { SessionRepository } = await import('../../core/db/repositories');
  const id = route.paramMap.get('sessionId') ?? '';
  return (await injector.get(SessionRepository).exists(id)) || router.createUrlTree(['/']);
};
