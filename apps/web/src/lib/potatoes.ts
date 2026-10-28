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

export type PotatoFace = 'happy' | 'blink' | 'sleep' | 'ouch';

/**
 * How each potato is drawn, in a 100×100 box: its outline (also its physics hull on the sofa), colours,
 * where the face sits, and a slight tilt for character. Shared by the SVG art and the sofa physics.
 */
export type PotatoLook = { body: string; fill: string; shade: string; face: { x: number; y: number; s: number }; tilt?: number };
export const POTATO_LOOKS: Record<PotatoKind, PotatoLook> = {
    boiled: {
      body: 'M20 60 C20 40 34 30 50 30 C68 30 82 42 80 60 C79 76 65 86 50 86 C34 86 21 76 20 60 Z',
      fill: 'var(--potato-boiled)', shade: 'var(--potato-boiled-shade)', face: { x: 50, y: 60, s: 1.2 },
    },
    grilled: {
      body: 'M20 60 C17 39 33 26 52 27 C72 28 85 42 81 61 C78 78 63 86 48 85 C32 84 22 75 20 60 Z',
      fill: 'var(--potato-skin)', shade: 'var(--potato-skin-shade)', face: { x: 51, y: 59, s: 1.2 },
    },
    chip: {
      body: 'M15 60 Q17 41 33 37 Q42 33 50 36 Q58 33 67 37 Q83 41 85 58 Q87 74 69 80 Q59 85 50 82 Q41 85 31 80 Q13 74 15 60 Z',
      fill: 'var(--potato-gold)', shade: 'var(--potato-gold-shade)', face: { x: 50, y: 60, s: 1.14 }, tilt: -6,
    },
    fry: {
      body: 'M41 12 H59 Q64 12 64 17 V85 Q64 90 59 90 H41 Q36 90 36 85 V17 Q36 12 41 12 Z',
      fill: 'var(--potato-gold)', shade: 'var(--potato-gold-shade)', face: { x: 50, y: 46, s: 0.9 }, tilt: 8,
    },
    mashed: {
      body: 'M16 80 C13 64 22 53 32 49 C33 38 44 33 51 37 C59 31 71 37 71 47 C82 51 88 64 84 80 C70 87 30 87 16 80 Z',
      fill: 'var(--potato-mash)', shade: 'var(--potato-mash-shade)', face: { x: 50, y: 66, s: 1.14 },
    },
    jacket: {
      body: 'M18 62 C15 40 32 25 51 26 C71 27 86 41 82 62 C80 79 65 88 49 87 C32 86 20 77 18 62 Z',
      fill: 'var(--potato-skin)', shade: 'var(--potato-skin-shade)', face: { x: 50, y: 52, s: 1.08 },
    },
    hashbrown: {
      body: 'M22 36 Q22 26 32 26 H69 Q79 26 79 36 V74 Q79 84 69 84 H32 Q22 84 22 74 Z',
      fill: 'var(--potato-hash)', shade: 'var(--potato-hash-shade)', face: { x: 50, y: 57, s: 1.14 }, tilt: -4,
    },
    sweet: {
      body: 'M12 66 C12 50 28 37 50 35 C71 33 89 40 89 53 C89 67 73 80 50 82 C29 84 12 79 12 66 Z',
      fill: 'var(--potato-sweet)', shade: 'var(--potato-sweet-shade)', face: { x: 49, y: 60, s: 1.14 }, tilt: -10,
    },
  };


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
