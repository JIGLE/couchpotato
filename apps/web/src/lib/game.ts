import type { GameSettings, Language, Mood } from '@couchpotato/shared';

/** The four answer shapes, the same on the TV and the phones. */
export const SHAPES = ['●', '▲', '■', '◆'] as const;
export const SHAPE_NAMES = ['circle', 'triangle', 'square', 'diamond'] as const;

/** Answer i → its tile colours (from the current mood) and shape. */
export function tile(i: number) {
  const key = 'abcd'[i % 4];
  return { bg: `var(--tile-${key})`, fg: `var(--tile-${key}-ink)`, shape: SHAPES[i % 4], name: SHAPE_NAMES[i % 4] };
}

export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', 'pt-PT': 'Português', 'es-ES': 'Español' };

export const MOODS: { id: Mood; name: string }[] = [
  { id: 'lamp', name: 'Lamp Light' },
  { id: 'velvet', name: 'Velvet' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'sunday', name: 'Sunday' },
];

export function currentMood(): Mood {
  const m = document.documentElement.dataset.mood;
  return MOODS.some((x) => x.id === m) ? (m as Mood) : 'lamp';
}

const DEFAULT_SETTINGS: GameSettings = { language: 'en', rounds: 10, seconds: 20 };

/** Settings are remembered on the TV between game nights. */
export function loadSettings(): GameSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('cp:settings') ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem('cp:settings', JSON.stringify(s));
  } catch {
    /* private mode: fine, just not remembered */
  }
}

/** Restyle this screen. The TV remembers its mood for next time; phones just follow the room. */
export function applyMood(mood: Mood, remember = true): void {
  document.documentElement.dataset.mood = mood;
  if (!remember) return;
  try {
    localStorage.setItem('cp:mood', mood);
  } catch {
    /* not remembered */
  }
}
