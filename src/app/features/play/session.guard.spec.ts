import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { SessionRepository } from '../../core/db/repositories';
import { sessionGuard } from './session.guard';

function run(sessionId: string, exists: boolean) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: SessionRepository, useValue: { exists: async () => exists } }],
  });
  const route = { paramMap: convertToParamMap({ sessionId }) } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => sessionGuard(route, {} as RouterStateSnapshot)) as Promise<boolean | UrlTree>;
}

describe('sessionGuard', () => {
  it('allows an existing session', async () => {
    expect(await run('abc', true)).toBe(true);
  });

  it('redirects home for a missing session', async () => {
    const result = await run('nope', false);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/');
  });
});
