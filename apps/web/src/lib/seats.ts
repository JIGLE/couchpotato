/** Cushion colour index (0–3) → the matching answer-tile colour of the current mood. */
export function seatColour(colour: number): { bg: string; fg: string } {
  const key = 'abcd'[((colour % 4) + 4) % 4];
  return { bg: `var(--tile-${key})`, fg: `var(--tile-${key}-ink)` };
}

export function initial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}
