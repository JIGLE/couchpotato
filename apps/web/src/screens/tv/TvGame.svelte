<!-- The TV during a game: question → reveal → leaderboard → podium. Built from the canvas artboards. -->
<script lang="ts">
  import type { GameView, Player, Standing } from '@couchpotato/shared';
  import { tile } from '../../lib/game';
  import type { PotatoKind } from '@couchpotato/shared';
  import { seatColour } from '../../lib/seats';
  import Potato from '../../lib/Potato.svelte';
  import Timer from '../../lib/Timer.svelte';

  let {
    view,
    offset,
    players,
    onPlayAgain,
    onEnd,
  }: { view: GameView; offset: number; players: Player[]; onPlayAgain: () => void; onEnd: () => void } = $props();

  // Players who left mid-game keep their place on the leaderboard, so remember their cushion colour.
  const seen = new Map<string, Player>();
  const byId = $derived.by(() => {
    for (const p of players) seen.set(p.id, p);
    return new Map(seen);
  });
  const colourOf = (id: string) => seatColour(byId.get(id)?.colour ?? 0);
  const nameOf = (id: string) => byId.get(id)?.name ?? '?';
  const potatoOf = (id: string): PotatoKind => byId.get(id)?.potato ?? 'boiled';

  /** Podium order on screen: 2nd, 1st, 3rd. */
  const podium = $derived.by(() => {
    if (view.phase !== 'podium') return [];
    const top = view.standings.slice(0, 3);
    return [top[1], top[0], top[2]].filter((s): s is Standing => !!s);
  });
  /** Bar heights by position on screen (2nd, 1st, 3rd), so ties still look like a podium. */
  const heights = ['200px', '260px', '150px'];
</script>

<section class="game">
  {#if view.phase === 'question'}
    <header class="bar">
      <span class="mono muted">ROUND {view.round} / {view.rounds} · {view.category.toUpperCase()}</span>
      <div class="right">
        <span class="muted">{view.answered} of {view.players} locked in</span>
        {#if view.endsAt}<Timer endsAt={view.endsAt} {offset} />{/if}
      </div>
    </header>
    <h1 class="question">{view.text}</h1>
    <div class="tiles">
      {#each view.answers ?? [] as answer, i (i)}
        {@const t = tile(i)}
        <div class="tile" style:background={t.bg} style:color={t.fg}>
          <span class="shape" aria-label={t.name}>{t.shape}</span>
          <span class="answer">{answer}</span>
        </div>
      {/each}
    </div>
  {:else if view.phase === 'reveal'}
    <header class="bar">
      <span class="mono muted">ROUND {view.round} / {view.rounds} · ANSWER</span>
      <span class="muted">{view.pickedBy[view.correct].length} got it</span>
    </header>
    <h2 class="question small">{view.text}</h2>
    <div class="tiles">
      {#each view.answers ?? [] as answer, i (i)}
        {@const t = tile(i)}
        {@const right = i === view.correct}
        <div class="tile reveal" class:right class:dim={!right} style:background={t.bg} style:color={t.fg}>
          <div class="top">
            <span class="shape" aria-label={t.name}>{t.shape}</span>
            <span class="answer">{answer}</span>
            {#if right}<span class="mark" aria-label="correct">✓</span>{/if}
          </div>
          <div class="pickers">
            {#each view.pickedBy[i] as id (id)}
              {@const c = colourOf(id)}
              <span class="mini" style:background={c.bg} style:color={c.fg} title={nameOf(id)}><Potato kind={potatoOf(id)} size={40} still /></span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    {#if view.fact}<p class="fact">{view.fact}</p>{/if}
  {:else if view.phase === 'leaderboard'}
    {@const leader = view.standings[0]}
    <div class="board">
      <div class="headline">
        <span class="mono muted">AFTER ROUND {view.round} / {view.rounds}</span>
        <h1>{leader ? `${leader.name} ${leader.moved > 0 ? 'takes the lead' : 'leads'}.` : 'Scores'}</h1>
        {#each view.standings.filter((s) => s.streak >= 3).slice(0, 2) as s (s.id)}
          <div class="note"><span class="label">ON A ROLL</span>{s.name} · {s.streak} in a row</div>
        {/each}
      </div>
      <ol class="rows">
        {#each view.standings.slice(0, 6) as s, i (s.id)}
          {@const c = colourOf(s.id)}
          <li class:first={i === 0} class:away={s.away}>
            <span class="mono rank">{s.rank}</span>
            <span class="av" style:background={c.bg}><Potato kind={potatoOf(s.id)} size={48} still asleep={s.away} /></span>
            <span class="name">{s.name}</span>
            <span class="mono moved">{s.moved > 0 ? `▲ ${s.moved}` : s.moved < 0 ? `▼ ${-s.moved}` : ''}</span>
            <span class="mono score">{s.score.toLocaleString()}</span>
          </li>
        {/each}
      </ol>
    </div>
  {:else}
    <div class="podium">
      <span class="mono muted">TRIVIA NIGHT · FINAL</span>
      <h1>{view.standings[0] ? `${view.standings[0].name} wins the couch!` : 'Game over'}</h1>
      <div class="stands">
        {#each podium as s, i (s.id)}
          {@const c = colourOf(s.id)}
          {@const h = heights[i]}
          <div class="stand" class:away={s.away}>
            <span class="av big" class:winner={s.rank === 1} style:background={c.bg}><Potato kind={potatoOf(s.id)} size={s.rank === 1 ? 116 : 90} delay={i * 0.5} /></span>
            <span class="name">{s.name}</span>
            <div class="bar-col" style:height={h}>
              <span class="place">{s.rank}</span>
              <span class="mono">{s.score.toLocaleString()}</span>
            </div>
          </div>
        {/each}
      </div>
      <div class="actions">
        {#if view.standings.length > 3}
          <span class="muted">Couch potato of the night: <strong>{view.standings.at(-1)!.name}</strong></span>
        {:else}
          <span></span>
        {/if}
        <div class="buttons">
          <button class="ghost" onclick={onEnd}>Lobby</button>
          <button class="primary" onclick={onPlayAgain}>Play again</button>
        </div>
      </div>
    </div>
  {/if}

  {#if view.phase !== 'podium'}
    <button class="end" onclick={onEnd} aria-label="End game">✕</button>
  {/if}
</section>

<style>
  .game { flex: 1; display: flex; flex-direction: column; gap: 28px; min-height: 0; position: relative; }
  .muted { color: var(--ink-muted); }
  .mono { font-family: var(--font-mono); font-weight: 700; }
  .bar { display: flex; justify-content: space-between; align-items: center; font-size: 32px; font-weight: 600; padding-right: 72px; }
  .bar .right { display: flex; align-items: center; gap: 24px; }

  .question { flex: 1; margin: 0; display: grid; place-items: center; text-align: center; font: 600 56px/64px var(--font-display); letter-spacing: -0.02em; padding: 0 40px; }
  .question.small { flex: 0; font-size: 40px; line-height: 48px; place-items: start; text-align: left; padding: 0; }

  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
  .tile {
    min-height: 104px; border-radius: var(--radius-md); padding: 18px 32px; display: flex; align-items: center; gap: 24px;
    font-size: 36px; font-weight: 700; box-shadow: 6px 8px 18px var(--edge-dark); animation: rise 280ms var(--ease-out) both;
  }
  .tile:nth-child(2) { animation-delay: 60ms; }
  .tile:nth-child(3) { animation-delay: 120ms; }
  .tile:nth-child(4) { animation-delay: 180ms; }
  .shape { font-size: 44px; line-height: 1; }
  .tile.reveal { flex-direction: column; align-items: stretch; justify-content: space-between; gap: 12px; flex: 1; }
  .top { display: flex; align-items: center; gap: 24px; }
  .mark { margin-left: auto; font-size: 44px; }
  .tile.dim { opacity: 0.35; box-shadow: none; }
  .tile.right { outline: 4px solid var(--correct); outline-offset: 5px; box-shadow: 0 0 70px var(--glow), 8px 10px 22px var(--edge-dark); animation: glow 600ms var(--ease-out); }
  .pickers { display: flex; gap: 10px; flex-wrap: wrap; min-height: 44px; }
  .mini { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font: 700 20px var(--font-display); box-shadow: 0 0 0 3px var(--edge-dark); }
  .fact { margin: 0; font-size: 32px; font-weight: 600; color: var(--ink-muted); }

  .board { flex: 1; display: flex; gap: 48px; min-height: 0; }
  .headline { width: 34%; display: flex; flex-direction: column; gap: 18px; }
  .headline h1 { margin: 0; font: 600 52px/58px var(--font-display); letter-spacing: -0.02em; }
  .note { padding: 16px 20px; border-radius: 22px; background: var(--surface-1); box-shadow: var(--morph-raised); font-size: 32px; font-weight: 700; display: flex; flex-direction: column; }
  .label { font-size: 32px; letter-spacing: 0.06em; color: var(--spud); }
  .rows { flex: 1; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; justify-content: center; gap: 12px; }
  .rows li {
    height: 80px; border-radius: 24px; padding: 0 24px; display: flex; align-items: center; gap: 20px;
    background: var(--surface-1); box-shadow: var(--morph-raised); animation: rise 320ms var(--ease-out) both;
  }
  .rows li.first { background: var(--spud); color: var(--ink-on-spud); box-shadow: 0 0 60px var(--glow), 8px 10px 22px var(--edge-dark); }
  .rank { width: 40px; font-size: 32px; }
  .av { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; font: 700 24px var(--font-display); flex-shrink: 0; }
  .name { flex: 1; font-size: 32px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .moved { font-size: 32px; opacity: 0.8; }
  .score { width: 150px; text-align: right; font-size: 32px; }
  .rows li.away, .stand.away { opacity: 0.45; filter: grayscale(1); }

  .podium { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 0; }
  .podium h1 { margin: 0; font: 700 56px var(--font-display); letter-spacing: -0.03em; text-align: center; }
  .stands { margin-top: auto; display: flex; align-items: flex-end; gap: 28px; }
  .stand { width: 240px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .av.big { width: 96px; height: 96px; font-size: 40px; box-shadow: 8px 10px 22px var(--edge-dark); animation: pop 500ms var(--ease-out) both; }
  .av.winner { width: 124px; height: 124px; font-size: 52px; box-shadow: 0 0 80px var(--glow), 8px 10px 22px var(--edge-dark); }
  .stand .name { flex: 0; text-align: center; max-width: 100%; }
  .bar-col {
    width: 100%; border-radius: 32px 32px 0 0; background: var(--surface-1); box-shadow: var(--morph-raised);
    display: flex; flex-direction: column; align-items: center; padding-top: 16px; gap: 4px; font-size: 32px;
    animation: grow 700ms var(--ease-out) both;
  }
  .place { font: 700 56px var(--font-display); color: var(--spud); }
  .actions { width: 100%; display: flex; justify-content: space-between; align-items: center; font-size: 32px; font-weight: 600; padding-top: 16px; }
  .buttons { display: flex; gap: 16px; }
  .buttons button { border: 0; cursor: pointer; padding: 18px 36px; border-radius: var(--radius-pill); font: 700 32px var(--font-sans); }
  .primary { background: var(--spud); color: var(--ink-on-spud); box-shadow: 0 0 40px var(--glow), 6px 8px 18px var(--edge-dark); }
  .ghost { background: var(--surface-1); color: var(--ink); box-shadow: var(--morph-raised); }

  .end {
    position: absolute; top: -4px; right: 0; width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer;
    background: var(--surface-1); color: var(--ink-muted); font-size: 32px; box-shadow: var(--morph-raised); opacity: 0.6;
  }
  .end:hover, .end:focus-visible { opacity: 1; }

  @keyframes rise { from { opacity: 0; transform: translateY(24px); } }
  @keyframes pop { from { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.08); } }
  @keyframes grow { from { transform: scaleY(0); transform-origin: bottom; } }
  @keyframes glow { from { transform: scale(0.96); } 60% { transform: scale(1.03); } }
</style>
