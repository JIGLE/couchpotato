import type { PotatoKind } from '@couchpotato/shared';

/** The cast, in the order the server hands out free potatoes (mirrors POTATOES in apps/server/src/rooms.ts). */
export const POTATOES: { kind: PotatoKind; name: string; quirk: string }[] = [
  { kind: 'boiled', name: 'Boiled', quirk: 'Soft plop, sinks deep' },
  { kind: 'grilled', name: 'Grilled', quirk: 'Sizzles on landing' },
  { kind: 'chip', name: 'Chip', quirk: 'Flutters down like a leaf' },
  { kind: 'fry', name: 'Fry', quirk: 'Lands on its end, tips over' },
  { kind: 'mashed', name: 'Mashed', quirk: 'Splats, then pulls itself together' },
  { kind: 'jacket', name: 'Jacket', quirk: 'Heavy. The sofa notices' },
  { kind: 'hashbrown', name: 'Hash brown', quirk: 'Slides along the seat' },
  { kind: 'sweet', name: 'Sweet', quirk: 'Bouncy, two little hops' },
];

export const potatoName = (kind: PotatoKind) => POTATOES.find((p) => p.kind === kind)?.name ?? 'Potato';

export function loadPotato(): PotatoKind | undefined {
  try {
    const v = localStorage.getItem('cp:potato');
    return POTATOES.find((p) => p.kind === v)?.kind;
  } catch {
    return undefined;
  }
}

export function savePotato(kind: PotatoKind): void {
  try {
    localStorage.setItem('cp:potato', kind);
  } catch {
    /* private mode: not remembered */
  }
}
