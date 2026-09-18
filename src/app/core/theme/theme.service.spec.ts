import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const root = document.documentElement;

  it('stamps data-theme for light/dark and removes it for system', () => {
    const theme = TestBed.inject(ThemeService);

    theme.set('dark');
    TestBed.tick();
    expect(root.dataset['theme']).toBe('dark');

    theme.set('light');
    TestBed.tick();
    expect(root.dataset['theme']).toBe('light');

    theme.set('system');
    TestBed.tick();
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
