import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { normalizeRoomCode } from '../../core/sync/room-code';

/** Rejects malformed /room/:code (home) and canonicalizes case (/room/abc123 → /room/ABC123). */
export const roomCodeGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const raw = route.paramMap.get('code') ?? '';
  const code = normalizeRoomCode(raw);
  if (!code) return router.createUrlTree(['/']);
  return code === raw || router.createUrlTree(['/room', code]);
};
