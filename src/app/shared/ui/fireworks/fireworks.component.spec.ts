import { TestBed } from '@angular/core/testing';
import { FireworksComponent } from './fireworks.component';

function render(count?: number): HTMLElement {
  const fixture = TestBed.createComponent(FireworksComponent);
  if (count !== undefined) fixture.componentRef.setInput('count', count);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('FireworksComponent', () => {
  it('draws the asked-for number of bursts, each a ring of sparks', () => {
    const el = render(3);
    const bursts = el.querySelectorAll('.burst');
    expect(bursts).toHaveLength(3);
    expect(bursts[0].querySelectorAll('.spark')).toHaveLength(12);
    // Sparks fly outwards on their own angle, and bursts are staggered.
    expect(bursts[0].querySelector('.spark')?.getAttribute('style')).toContain('--a: 0deg');
    expect(bursts[1].getAttribute('style')).toContain('--delay: 0.35s');
  });

  it('clamps the count to the bursts it knows, and is decorative for screen readers', () => {
    expect(render(99).querySelectorAll('.burst').length).toBe(5);
    expect(render(0).querySelectorAll('.burst').length).toBe(1);
    expect(render().getAttribute('aria-hidden')).toBe('true');
  });
});
