/** A device that never set a name is called this — see `IdentityService`. */
export const DEFAULT_NAME = 'You';

/**
 * How to write another player's name. Names are self-declared and default to "You", which reads
 * as the wrong person on everyone else's screen, so an unnamed player is called by their seat.
 */
export function seatName(name: string, seat: number): string {
  const trimmed = name.trim();
  return trimmed && trimmed !== DEFAULT_NAME ? trimmed : `Player ${seat + 1}`;
}

/** `seatName` by id, using the list's order as the seating. */
export function playerLabel(players: readonly { id: string; name: string }[], id: string): string {
  const seat = players.findIndex((p) => p.id === id);
  return seat < 0 ? 'A player' : seatName(players[seat].name, seat);
}
