<!-- Game setup on the TV, from the "TV · Game setup" artboard. Big pills that work with a mouse or a TV remote. -->
<script lang="ts">
  import type { GameSettings, Language } from '@couchpotato/shared';
  import { LANGUAGE_NAMES, MOODS, applyMood } from '../../lib/game';

  let {
    settings = $bindable(),
    players,
    onStart,
    onBack,
  }: { settings: GameSettings; players: number; onStart: () => void; onBack: () => void } = $props();

  let mood = $state(document.documentElement.dataset.mood ?? 'lamp');

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

<section class="setup">
  <aside>
    <button class="back" onclick={onBack}>← Lobby</button>
    <div class="badge" aria-hidden="true">?</div>
    <h1>Trivia Night</h1>
    <p class="muted">Everyone answers on their phone. Faster right answers score more.</p>
    <div class="summary">
      <span class="label">TONIGHT</span>
      <span class="mono">{settings.rounds} questions · ~{minutes} min</span>
      <span class="muted">{players} on the couch · {LANGUAGE_NAMES[settings.language]}</span>
    </div>
  </aside>

  <div class="card">
    <div class="row">
      <span class="label" id="l-lang">Language</span>
      <div class="pills" role="radiogroup" aria-labelledby="l-lang">
        {#each languages as [v, label] (v)}
          <button role="radio" aria-checked={settings.language === v} class:on={settings.language === v} onclick={() => (settings = { ...settings, language: v })}>{label}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="label" id="l-rounds">Questions</span>
      <div class="pills" role="radiogroup" aria-labelledby="l-rounds">
        {#each rounds as v (v)}
          <button role="radio" aria-checked={settings.rounds === v} class:on={settings.rounds === v} onclick={() => (settings = { ...settings, rounds: v })}>{v}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="label" id="l-time">Answer time</span>
      <div class="pills" role="radiogroup" aria-labelledby="l-time">
        {#each times as t (t.v)}
          <button role="radio" aria-checked={settings.seconds === t.v} class:on={settings.seconds === t.v} onclick={() => (settings = { ...settings, seconds: t.v })}>{t.label}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="label" id="l-age">Youngest</span>
      <div class="pills" role="radiogroup" aria-labelledby="l-age">
        {#each ages as a (a.label)}
          <button role="radio" aria-checked={settings.youngest === a.v} class:on={settings.youngest === a.v} onclick={() => (settings = { ...settings, youngest: a.v })}>{a.label}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="label" id="l-where">Countries</span>
      <div class="pills" role="group" aria-labelledby="l-where">
        {#each countries as c (c.v)}
          {@const on = settings.regions?.includes(c.v) ?? false}
          <button aria-pressed={on} class:on onclick={() => toggleCountry(c.v)}>{on ? '✓ ' : ''}{c.label}</button>
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="label" id="l-mood">Mood</span>
      <div class="pills" role="radiogroup" aria-labelledby="l-mood">
        {#each MOODS as m (m.id)}
          <button role="radio" aria-checked={mood === m.id} class:on={mood === m.id} onclick={() => { mood = m.id; applyMood(m.id); }}>{m.name}</button>
        {/each}
      </div>
    </div>
    <button class="go" onclick={onStart} disabled={players === 0}>Start game →</button>
  </div>
</section>

<style>
  .setup { flex: 1; display: flex; gap: 40px; min-height: 0; }
  aside { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; gap: 18px; }
  .back { align-self: flex-start; background: none; border: 0; padding: 8px 0; color: var(--ink-muted); font: 700 32px var(--font-sans); cursor: pointer; }
  .badge {
    width: 132px; height: 132px; border-radius: 36px; display: grid; place-items: center;
    background: var(--spud); color: var(--ink-on-spud); font: 700 72px var(--font-display);
    box-shadow: 0 0 60px var(--glow), 8px 10px 22px var(--edge-dark);
  }
  h1 { margin: 0; font: 700 40px/44px var(--font-display); letter-spacing: -0.02em; }
  .muted { color: var(--ink-muted); }
  aside p { margin: 0; font-size: 32px; line-height: 40px; font-weight: 600; }
  .summary {
    margin-top: auto; display: flex; flex-direction: column; gap: 6px; padding: 18px 20px;
    border-radius: var(--radius-md); background: var(--surface-1); box-shadow: var(--morph-inset); font-size: 32px; font-weight: 600;
  }
  .summary .mono { font-family: var(--font-mono); font-weight: 700; color: var(--spud); }
  .label { font-size: 32px; font-weight: 700; }
  .summary .label { color: var(--ink-muted); letter-spacing: 0.06em; }

  .card {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; padding: 28px 32px;
    border-radius: 32px; background: var(--surface-1); box-shadow: var(--morph-raised);
  }
  .row { display: flex; align-items: center; gap: 20px; }
  .row .label { width: 220px; flex-shrink: 0; }
  .pills {
    display: flex; gap: 6px; padding: 6px; border-radius: var(--radius-pill);
    background: var(--surface-0); box-shadow: var(--morph-inset); flex-wrap: wrap;
  }
  .pills button {
    border: 0; cursor: pointer; padding: 8px 20px; border-radius: var(--radius-pill);
    background: transparent; color: var(--ink); font: 700 32px var(--font-sans);
  }
  .pills button.on { background: var(--spud); color: var(--ink-on-spud); box-shadow: 3px 4px 10px var(--edge-dark); }
  .go {
    margin-top: auto; align-self: flex-end; border: 0; cursor: pointer; padding: 22px 48px; border-radius: var(--radius-pill);
    background: var(--spud); color: var(--ink-on-spud); font: 700 36px var(--font-sans);
    box-shadow: 0 0 40px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .go:disabled { opacity: 0.45; cursor: default; }
</style>
