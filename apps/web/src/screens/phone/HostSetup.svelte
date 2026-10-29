<!-- The Head Spud's remote in the lobby, in three steps: pick a game, set it up, start.
     Moved here from the TV so the big screen stays a show, not a menu. -->
<script lang="ts">
  import type { GameSettings, Language, Mood, Player } from '@couchpotato/shared';
  import { LANGUAGE_NAMES, MOODS } from '../../lib/game';
  import { seatColour } from '../../lib/seats';

  let {
    settings = $bindable(),
    step = $bindable('pick'),
    players,
    mood,
    notice = '',
    onMood,
    onStart,
  }: {
    settings: GameSettings;
    /** Kept by the caller so "Back to lobby" after a game lands on the settings, not the shelf. */
    step?: 'pick' | 'setup';
    players: Player[];
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
    { v: undefined, label: 'Adults' },
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

  /** The games on the shelf. Only Trivia is playable until the Phase 4 module contract lands. */
  const games = [
    { id: 'trivia', name: 'Trivia Night', badge: '?', blurb: 'Quick-fire questions, answers on your phone', ready: true },
    { id: 'liars-dice', name: "Liar's Dice", badge: '⚄', blurb: 'Bluff about the dice in your hand', ready: false },
  ];
  let picked = $state('trivia');
  const game = $derived(games.find((g) => g.id === picked) ?? games[0]);

  function pick(id: string) {
    picked = id;
    step = 'setup';
    window.scrollTo({ top: 0 });
  }

  const minutes = $derived(Math.max(1, Math.round((settings.rounds * ((settings.seconds || 20) + 12)) / 60)));
  const sofa = $derived(`${players.length} on the sofa`);
  /** What's behind "More options", so the host can see it without opening it. */
  const extras = $derived(
    [
      ages.find((a) => a.v === settings.youngest)?.label ?? `${settings.youngest}+`,
      settings.regions?.length ? settings.regions.join(' · ') : 'All countries',
      MOODS.find((m) => m.id === mood)?.name,
    ].join(' · '),
  );
</script>

<section class="host" aria-label="Game setup">
  <ol class="steps">
    <li class:now={step === 'pick'} class:done={step === 'setup'}>
      {#if step === 'setup'}
        <button onclick={() => (step = 'pick')}><span class="dot" aria-hidden="true">✓</span>Game</button>
      {:else}
        <span class="dot" aria-hidden="true">1</span>Game
      {/if}
    </li>
    <li class:now={step === 'setup'}><span class="dot" aria-hidden="true">2</span>Settings</li>
    <li><span class="dot" aria-hidden="true">3</span>Start</li>
  </ol>

  {#if step === 'pick'}
    <h2>What are we playing?</h2>
    <div class="games">
      {#each games as g (g.id)}
        <button class="game" class:on={picked === g.id} disabled={!g.ready} onclick={() => pick(g.id)}>
          <span class="badge" aria-hidden="true">{g.badge}</span>
          <span class="text">
            <span class="name">{g.name}</span>
            <span class="muted">{g.ready ? g.blurb : 'Coming soon'}</span>
          </span>
          {#if g.ready}<span class="chev" aria-hidden="true">›</span>{/if}
        </button>
      {/each}
    </div>
  {:else}
    <button class="picked" onclick={() => (step = 'pick')} aria-label="{game.name}. Change game">
      <span class="badge small" aria-hidden="true">{game.badge}</span>
      <span class="text">
        <span class="name">{game.name}</span>
        <span class="muted">{settings.rounds} questions · ~{minutes} min</span>
      </span>
      <span class="change">Change</span>
    </button>

    {#snippet group(label: string, id: string)}
      <span class="label" {id}>{label}</span>
    {/snippet}

    <div class="card">
      {@render group('QUESTIONS', 'h-rounds')}
      <div class="pills" role="radiogroup" aria-labelledby="h-rounds">
        {#each rounds as v (v)}
          <button role="radio" aria-checked={settings.rounds === v} class:on={settings.rounds === v} onclick={() => (settings = { ...settings, rounds: v })}>{v}</button>
        {/each}
      </div>

      {@render group('TIME TO ANSWER', 'h-time')}
      <div class="pills" role="radiogroup" aria-labelledby="h-time">
        {#each times as t (t.v)}
          <button role="radio" aria-checked={settings.seconds === t.v} class:on={settings.seconds === t.v} onclick={() => (settings = { ...settings, seconds: t.v })}>{t.label}</button>
        {/each}
      </div>

      {@render group('LANGUAGE', 'h-lang')}
      <div class="pills" role="radiogroup" aria-labelledby="h-lang">
        {#each languages as [v, label] (v)}
          <button role="radio" aria-checked={settings.language === v} class:on={settings.language === v} onclick={() => (settings = { ...settings, language: v })}>{label}</button>
        {/each}
      </div>
    </div>

    <details class="card more">
      <summary>
        <span class="text">
          <span class="name">More options</span>
          <span class="muted">{extras}</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </summary>

      {@render group('YOUNGEST PLAYER', 'h-age')}
      <div class="pills" role="radiogroup" aria-labelledby="h-age">
        {#each ages as a (a.label)}
          <button role="radio" aria-checked={settings.youngest === a.v} class:on={settings.youngest === a.v} onclick={() => (settings = { ...settings, youngest: a.v })}>{a.label}</button>
        {/each}
      </div>

      {@render group('LOCAL QUESTIONS FROM', 'h-where')}
      <div class="pills" role="group" aria-labelledby="h-where">
        {#each countries as c (c.v)}
          {@const on = settings.regions?.includes(c.v) ?? false}
          <button aria-pressed={on} class:on onclick={() => toggleCountry(c.v)}>{on ? '✓ ' : ''}{c.label}</button>
        {/each}
      </div>

      {@render group('TV MOOD', 'h-mood')}
      <div class="pills two" role="radiogroup" aria-labelledby="h-mood">
        {#each MOODS as m (m.id)}
          <button role="radio" aria-checked={mood === m.id} class:on={mood === m.id} onclick={() => onMood(m.id)}>{m.name}</button>
        {/each}
      </div>
    </details>

    <span class="label" id="h-sofa">ON THE SOFA · {players.length}</span>
    <ul class="sofa" aria-labelledby="h-sofa">
      {#each players as p (p.id)}
        <li class:away={p.away}>
          <span class="seat" style:background={seatColour(p.colour).bg} aria-hidden="true"></span>{p.name}{p.away ? ' (away)' : ''}
        </li>
      {/each}
    </ul>

    <div class="dock">
      {#if notice}<p class="notice" role="alert">{notice}</p>{/if}
      <button class="go" onclick={onStart} disabled={players.length === 0}>
        Start {game.name}
        <span class="sub">{sofa} · ~{minutes} min</span>
      </button>
    </div>
  {/if}
</section>

<style>
  .host { display: flex; flex-direction: column; gap: 12px; }
  h2 { margin: 4px 0 0; font: 600 24px var(--font-display); }

  .steps { display: flex; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .steps li {
    flex: 1; display: flex; align-items: center; gap: 8px; color: var(--ink-muted); font: 700 14px var(--font-sans);
  }
  .steps li:not(:last-child)::after { content: ''; flex: 1; height: 2px; border-radius: 2px; background: var(--surface-2); }
  .steps li.done::after { background: var(--spud); }
  .steps li.now, .steps li.done { color: var(--ink); }
  .steps button {
    display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0; border: 0; cursor: pointer;
    background: none; color: inherit; font: inherit;
  }
  .dot {
    width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; display: grid; place-items: center;
    background: var(--surface-1); box-shadow: var(--morph-inset); font: 700 14px var(--font-sans);
  }
  .now .dot, .done .dot { background: var(--spud); color: var(--ink-on-spud); box-shadow: 0 0 16px var(--glow); }

  .games { display: flex; flex-direction: column; gap: 12px; }
  .game, .picked {
    display: flex; align-items: center; gap: 16px; min-height: 88px; padding: 12px 16px; border: 0; border-radius: 24px;
    cursor: pointer; text-align: left; background: var(--surface-1); color: var(--ink); box-shadow: var(--morph-raised);
    transition: transform var(--dur-press), box-shadow var(--dur-press);
  }
  .game:active:not(:disabled), .picked:active { transform: scale(0.98); }
  .game:disabled { opacity: 0.5; cursor: default; box-shadow: var(--morph-inset); }
  .picked { min-height: 72px; padding: 10px 16px 10px 10px; box-shadow: 0 0 0 2px var(--spud), var(--morph-raised); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font: 600 22px var(--font-display); }
  .badge {
    width: 64px; height: 64px; flex-shrink: 0; border-radius: 22px; display: grid; place-items: center;
    background: var(--spud); color: var(--ink-on-spud); font: 700 36px var(--font-display);
    box-shadow: 0 0 30px var(--glow), 4px 6px 14px var(--edge-dark);
  }
  .badge.small { width: 52px; height: 52px; border-radius: 18px; font-size: 28px; }
  .chev { font: 600 32px var(--font-display); color: var(--ink-muted); transition: transform var(--dur-press); }
  .change { color: var(--spud); font: 700 15px var(--font-sans); }
  .muted { margin-top: 2px; color: var(--ink-muted); font: 600 15px var(--font-sans); }

  .card {
    display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 16px; border-radius: 24px;
    background: var(--surface-1); box-shadow: var(--morph-raised);
  }
  .more { padding-bottom: 12px; }
  .more[open] { padding-bottom: 16px; }
  .more summary {
    display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 0 6px; cursor: pointer; list-style: none;
  }
  .more summary::-webkit-details-marker { display: none; }
  .more summary .name { font-size: 18px; }
  .more summary .muted { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .more[open] .chev { transform: rotate(90deg); }
  .more summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; border-radius: 16px; }

  .label { margin: 6px 6px 0; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-muted); }
  .pills {
    display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: 20px;
    background: var(--surface-0); box-shadow: var(--morph-inset);
  }
  .pills.two { grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
  .pills button {
    min-height: 56px; border: 0; cursor: pointer; padding: 0 6px; border-radius: 16px;
    background: transparent; color: var(--ink); font: 700 15px var(--font-sans);
  }
  .pills button.on { background: var(--spud); color: var(--ink-on-spud); box-shadow: 3px 4px 10px var(--edge-dark); }
  .pills button:active { transform: scale(0.96); }

  .sofa { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .sofa li {
    display: flex; align-items: center; gap: 8px; padding: 8px 14px 8px 8px; border-radius: var(--radius-pill);
    background: var(--surface-1); box-shadow: var(--morph-raised); font: 600 15px var(--font-sans);
  }
  .sofa li.away { opacity: 0.5; }
  .seat { width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 2px var(--edge-dark); }

  /* Always in reach of a thumb; the lobby page leaves room underneath for it. */
  .dock {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; max-width: 480px; margin: 0 auto;
    padding: 24px var(--space-2) calc(16px + env(safe-area-inset-bottom));
    background: linear-gradient(to bottom, transparent, var(--surface-0) 28px);
  }
  .notice { margin: 0 0 8px; text-align: center; font-weight: 600; color: var(--wrong); }
  .go {
    width: 100%; min-height: 72px; border: 0; cursor: pointer; border-radius: var(--radius-pill);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    background: var(--spud); color: var(--ink-on-spud); font: 700 22px var(--font-display);
    box-shadow: 0 0 40px var(--glow), 6px 8px 18px var(--edge-dark); transition: transform var(--dur-press);
  }
  .go .sub { font: 600 14px var(--font-sans); opacity: 0.75; }
  .go:active { transform: scale(0.97); }
  .go:disabled { opacity: 0.45; cursor: default; }
</style>
