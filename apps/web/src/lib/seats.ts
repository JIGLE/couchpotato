/** Seat → cushion colour, cycling through the four answer-tile colours of the current mood. */
export function seatColour(seat: number): { bg: string; fg: string } {
  const key = 'abcd'[((seat % 4) + 4) % 4];
  return { bg: `var(--tile-${key})`, fg: `var(--tile-${key}-ink)` };
}

export function initial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}
