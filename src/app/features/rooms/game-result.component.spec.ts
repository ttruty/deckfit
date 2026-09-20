import { TestBed } from '@angular/core/testing';
import { GameResultComponent, type FinalScore } from './game-result.component';

const score = (over: Partial<FinalScore> & { id: string }): FinalScore => ({
  name: over.id, score: 0, isMe: false, place: 1, won: false, ...over,
});

/** Renders the panel and returns its element. */
function render(headline: string, scores: FinalScore[], celebrate = true) {
  const fixture = TestBed.createComponent(GameResultComponent);
  fixture.componentRef.setInput('headline', headline);
  fixture.componentRef.setInput('scores', scores);
  fixture.componentRef.setInput('unit', 'rounds won');
  fixture.componentRef.setInput('celebrate', celebrate);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('GameResultComponent', () => {
  it('sets off fireworks when you win, and slumps the players who didn’t', () => {
    const el = render('You win!', [
      score({ id: 'ann', score: 4, isMe: true, won: true }),
      score({ id: 'bo', score: 2, place: 2 }),
      score({ id: 'cy', score: 1, place: 3 }),
    ]);
    expect(el.querySelector('df-fireworks')).not.toBeNull();
    expect(el.querySelectorAll('li.lost')).toHaveLength(2);
    expect(el.querySelector('li.won')?.textContent).toContain('ann');
    expect(el.querySelector('h2')?.classList.contains('won')).toBe(true);
  });

  it('no fireworks when someone else won — losing just slumps your row', () => {
    const el = render('Ann wins!', [
      score({ id: 'ann', score: 4, won: true }),
      score({ id: 'bo', score: 2, isMe: true, place: 2 }),
    ]);
    expect(el.querySelector('df-fireworks')).toBeNull();
    expect(el.querySelector('li.me')?.classList.contains('lost')).toBe(true);
    expect(el.querySelector('h2')?.classList.contains('won')).toBe(false);
  });

  it('celebrates the winner for someone who only watched', () => {
    const el = render('Ann wins!', [score({ id: 'ann', score: 4, won: true }), score({ id: 'bo', score: 2, place: 2 })]);
    expect(el.querySelector('df-fireworks')).not.toBeNull(); // no row is "me": a spectator
  });

  it('nobody scored: no fireworks and nobody slumps', () => {
    const el = render('Nobody scored', [score({ id: 'ann', isMe: true }), score({ id: 'bo' })]);
    expect(el.querySelector('df-fireworks')).toBeNull();
    expect(el.querySelectorAll('li.lost')).toHaveLength(0);
    expect(el.querySelectorAll('li.won')).toHaveLength(0);
  });

  it('a caller can turn the celebration off', () => {
    const el = render('You win!', [score({ id: 'ann', score: 1, isMe: true, won: true })], false);
    expect(el.querySelector('df-fireworks')).toBeNull();
  });
});
