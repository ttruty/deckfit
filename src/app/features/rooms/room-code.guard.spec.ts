import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { roomCodeGuard } from './room-code.guard';

function run(code: string) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const route = { paramMap: convertToParamMap({ code }) } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => roomCodeGuard(route, {} as RouterStateSnapshot)) as boolean | UrlTree;
}

const url = (r: boolean | UrlTree) => (r instanceof UrlTree ? TestBed.inject(Router).serializeUrl(r) : r);

describe('roomCodeGuard', () => {
  it('allows a valid code', () => {
    expect(run('AB12CD')).toBe(true);
  });

  it('canonicalizes lowercase codes', () => {
    expect(url(run('ab12cd'))).toBe('/room/AB12CD');
  });

  it.each(['ABC', 'ABCDEFG', 'AB-12C', ''])('redirects home for %j', (code) => {
    expect(url(run(code))).toBe('/');
  });
});
