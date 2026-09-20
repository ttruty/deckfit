import { describe, expect, it } from 'vitest';
import { playerLabel, seatName } from './player-name';

describe('player names', () => {
  it('keeps a name the player chose', () => {
    expect(seatName('Ann', 0)).toBe('Ann');
    expect(seatName('  Bo  ', 1)).toBe('Bo');
  });

  it('calls an unnamed player by their seat, never "You"', () => {
    expect(seatName('You', 1)).toBe('Player 2');
    expect(seatName('', 0)).toBe('Player 1');
    expect(seatName('   ', 2)).toBe('Player 3');
  });

  it('looks a player up by id, in seat order', () => {
    const players = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'You' }];
    expect(playerLabel(players, 'a')).toBe('Ann');
    expect(playerLabel(players, 'b')).toBe('Player 2');
    expect(playerLabel(players, 'gone')).toBe('A player');
  });
});
