<!-- The Head Spud's remote in the lobby: pick the game's settings and the room's mood, then start.
     Moved here from the TV so the big screen stays a show, not a menu. -->
<script lang="ts">
  import type { GameSettings, Language, Mood } from '@couchpotato/shared';
  import { LANGUAGE_NAMES, MOODS } from '../../lib/game';

  let {
    settings = $bindable(),
    players,
    mood,
    notice = '',
    onMood,
    onStart,
  }: {
    settings: GameSettings;
    players: number;
    mood: Mood;
    notice?: string;
    onMood: (mood: Mood) => void;
    onStart: () => void;
  } = $props();

  const languages = Object.entries(LANGUAGE_NAMES) as [Language, string][];
  const rounds = [5, 10, 15, 20];
  const times = [
    { v: 10, label: '10 s' },
    { v: 20, label: '20 s' },
    { v: 30, label: '30 s' },
    { v: 0, label: 'No limit' },
  ];
  const ages: { v: number | undefined; label: string }[] = [
    { v: 6, label: '6+' },
    { v: 9, label: '9+' },
    { v: 12, label: '12+' },
    { v: undefined, label: 'Grown-ups' },
  ];
  const countries = [
    { v: 'PT', label: 'Portugal' },
    { v: 'ES', label: 'Spain' },
    { v: 'DK', label: 'Denmark' },
  ];

  function toggleCountry(c: string) {
    const now = settings.regions ?? [];
    const next = now.includes(c) ? now.filter((x) => x !== c) : [...now, c];
    settings = { ...settings, regions: next.length ? next : undefined };
  }

  const minutes = $derived(Math.max(1, Math.round((settings.rounds * ((settings.seconds || 20) + 12)) / 60)));
</script>

<section class="host" aria-label="Game setup">
  <div class="game">
    <div class="badge" aria-hidden="true">?</div>
    <div>
      <h2>Trivia Night</h2>
      <p class="muted">{settings.rounds} questions · ~{minutes} min · {players} on the sofa</p>
    </div>
  </div>

  {#snippet group(label: string, id: string)}
    <span class="label" {id}>{label}</span>
  {/snippet}

  {@render group('LANGUAGE', 'h-lang')}
  <div class="pills" role="radiogroup" aria-labelledby="h-lang">
    {#each languages as [v, label] (v)}
      <button role="radio" aria-checked={settings.language === v} class:on={settings.language === v} onclick={() => (settings = { ...settings, language: v })}>{label}</button>
    {/each}
  </div>

  {@render group('QUESTIONS', 'h-rounds')}
  <div class="pills" role="radiogroup" aria-labelledby="h-rounds">
    {#each rounds as v (v)}
      <button role="radio" aria-checked={settings.rounds === v} class:on={settings.rounds === v} onclick={() => (settings = { ...settings, rounds: v })}>{v}</button>
    {/each}
  </div>

  {@render group('ANSWER TIME', 'h-time')}
  <div class="pills" role="radiogroup" aria-labelledby="h-time">
    {#each times as t (t.v)}
      <button role="radio" aria-checked={settings.seconds === t.v} class:on={settings.seconds === t.v} onclick={() => (settings = { ...settings, seconds: t.v })}>{t.label}</button>
    {/each}
  </div>

  {@render group('YOUNGEST', 'h-age')}
  <div class="pills" role="radiogroup" aria-labelledby="h-age">
    {#each ages as a (a.label)}
      <button role="radio" aria-checked={settings.youngest === a.v} class:on={settings.youngest === a.v} onclick={() => (settings = { ...settings, youngest: a.v })}>{a.label}</button>
    {/each}
  </div>

  {@render group('COUNTRIES', 'h-where')}
  <div class="pills" role="group" aria-labelledby="h-where">
    {#each countries as c (c.v)}
      {@const on = settings.regions?.includes(c.v) ?? false}
      <button aria-pressed={on} class:on onclick={() => toggleCountry(c.v)}>{on ? '✓ ' : ''}{c.label}</button>
    {/each}
  </div>

  {@render group('MOOD', 'h-mood')}
  <div class="pills" role="radiogroup" aria-labelledby="h-mood">
    {#each MOODS as m (m.id)}
      <button role="radio" aria-checked={mood === m.id} class:on={mood === m.id} onclick={() => onMood(m.id)}>{m.name}</button>
    {/each}
  </div>

  {#if notice}<p class="notice" role="alert">{notice}</p>{/if}
  <button class="go" onclick={onStart} disabled={players === 0}>Start game</button>
</section>

<style>
  .host { display: flex; flex-direction: column; gap: 8px; }
  .game { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
  .badge {
    width: 64px; height: 64px; flex-shrink: 0; border-radius: 22px; display: grid; place-items: center;
    background: var(--spud); color: var(--ink-on-spud); font: 700 36px var(--font-display);
    box-shadow: 0 0 30px var(--glow), 4px 6px 14px var(--edge-dark);
  }
  h2 { margin: 0; font: 600 24px var(--font-display); }
  .muted { margin: 4px 0 0; color: var(--ink-muted); font-weight: 600; }
  .label { margin-top: 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-muted); }
  .pills {
    display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: 20px;
    background: var(--surface-1); box-shadow: var(--morph-inset);
  }
  .pills button {
    min-height: 48px; border: 0; cursor: pointer; padding: 0 6px; border-radius: 16px;
    background: transparent; color: var(--ink); font: 700 15px var(--font-sans);
  }
  .pills button.on { background: var(--spud); color: var(--ink-on-spud); box-shadow: 3px 4px 10px var(--edge-dark); }
  .notice { margin: 8px 0 0; font-weight: 600; color: var(--wrong); }
  .go {
    margin-top: 16px; min-height: 64px; border: 0; cursor: pointer; border-radius: var(--radius-pill);
    background: var(--spud); color: var(--ink-on-spud); font: 700 22px var(--font-display);
    box-shadow: 0 0 40px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .go:active { transform: scale(0.97); }
  .go:disabled { opacity: 0.45; cursor: default; }
</style>
