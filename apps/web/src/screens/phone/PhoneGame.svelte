<!-- The phone during a game: answer pad, locked in, round result, rank, final result.
     From the "Phone · Answer" and "Phone · Round result" artboards. The question itself is only on the TV. -->
<script lang="ts">
  import type { GameView } from '@couchpotato/shared';
  import { tile } from '../../lib/game';
  import Timer from '../../lib/Timer.svelte';

  let {
    view,
    offset,
    playerId,
    onAnswer,
  }: { view: GameView; offset: number; playerId: string | null; onAnswer: (choice: number) => void } = $props();

  // Show the pick straight away, before the server confirms it.
  let local = $state<{ round: number; choice: number } | null>(null);
  const myChoice = $derived(
    view.phase === 'question' ? (view.myChoice ?? (local?.round === view.round ? local.choice : null)) : null,
  );

  function pick(i: number) {
    if (view.phase !== 'question' || myChoice !== null || !view.canAnswer) return;
    local = { round: view.round, choice: i };
    navigator.vibrate?.(15);
    onAnswer(i);
  }

  const me = $derived(view.phase === 'reveal' ? view.me : undefined);
  /** This phone's line on the leaderboard or podium. */
  const standing = $derived(
    view.phase === 'leaderboard' || view.phase === 'podium' ? view.standings.find((s) => s.id === playerId) : undefined,
  );
  const total = $derived(view.phase === 'leaderboard' || view.phase === 'podium' ? view.standings.length : 0);
  /** Joined mid-game and sits out until the next question starts. */
  const waiting = $derived(
    view.phase === 'question' ? !view.canAnswer : view.phase === 'reveal' || view.phase === 'leaderboard' ? !!view.waiting : false,
  );
</script>

{#snippet nextRound()}
  <div class="centre">
    <h1>You're in next round</h1>
    <p class="muted">The game had already started. Grab a snack — you play from the next question, starting from the room's average score.</p>
  </div>
{/snippet}

<section class="game">
  {#if view.phase === 'question'}
    <div class="top">
      <span class="mono">ROUND {view.round} / {view.rounds}</span>
      {#if view.endsAt}<Timer endsAt={view.endsAt} {offset} size={56} />{/if}
    </div>
    {#if waiting}
      {@render nextRound()}
    {:else}
      <p class="status" role="status">{myChoice === null ? 'Read the question on the TV, then tap.' : 'Locked in. Fingers crossed.'}</p>
      <div class="pad" class:two={view.choices === 2}>
        {#each Array(view.choices) as _, i (i)}
          {@const t = tile(i)}
          <button
            class="answer"
            class:picked={myChoice === i}
            class:dim={myChoice !== null && myChoice !== i}
            style:background={t.bg}
            style:color={t.fg}
            aria-label="Answer {i + 1}, {t.name}"
            aria-pressed={myChoice === i}
            disabled={myChoice !== null}
            onclick={() => pick(i)}
          >
            <span class="shape">{t.shape}</span>
          </button>
        {/each}
      </div>
    {/if}
  {:else if view.phase === 'reveal'}
    <div class="top"><span class="mono">ROUND {view.round} / {view.rounds}</span><span class="mono">{me && !waiting ? `#${me.rank}` : ''}</span></div>
    {#if waiting}
      {@render nextRound()}
    {:else}
      <div class="centre result" class:good={me?.correct}>
        {#if me}
          <div class="badge" aria-hidden="true">{me.correct ? '✓' : '✕'}</div>
          <h1>{me.correct ? (me.streak >= 3 ? `${me.streak} in a row!` : 'Nailed it!') : me.choice === null ? 'Too slow!' : 'Not this time'}</h1>
          <p class="points mono">+{me.lastPoints}</p>
          <p class="muted">
            {#if me.correct}
              {me.rank === 1 ? "You're in the lead." : `You're #${me.rank}.`}
            {:else}
              The answer was {tile(view.correct).name}. {me.rank === 1 ? 'Still in the lead.' : 'Still in it.'}
            {/if}
          </p>
        {:else}
          <h1>Look at the TV</h1>
        {/if}
      </div>
    {/if}
  {:else if view.phase === 'leaderboard'}
    <div class="top"><span class="mono">AFTER ROUND {view.round} / {view.rounds}</span></div>
    {#if waiting}
      {@render nextRound()}
    {:else}
      <div class="centre">
        {#if standing}
          <p class="place mono">#{standing.rank}</p>
          <h1>{standing.rank === 1 ? "You're in the lead" : `${total} on the couch`}</h1>
          <p class="mono muted">{standing.score.toLocaleString()} points{standing.moved > 0 ? ` · up ${standing.moved}` : ''}</p>
        {:else}
          <h1>Scores are on the TV</h1>
        {/if}
        <p class="muted">Next question coming up…</p>
      </div>
    {/if}
  {:else}
    <div class="centre">
      {#if standing}
        <p class="place mono">#{standing.rank}</p>
        <h1>
          {standing.rank === 1
            ? 'You win the couch!'
            : standing.rank === total && total > 2
              ? 'Couch potato of the night'
              : `${standing.rank === 2 ? 'So close!' : 'Good game!'}`}
        </h1>
        <p class="mono muted">{standing.score.toLocaleString()} points</p>
      {:else}
        <h1>That's the game!</h1>
      {/if}
      <p class="muted">Look at the TV for the podium.</p>
    </div>
  {/if}
</section>

<style>
  .game { flex: 1; display: flex; flex-direction: column; gap: 18px; min-height: 0; }
  .top { display: flex; justify-content: space-between; align-items: center; color: var(--ink-muted); font-size: 13px; }
  .mono { font-family: var(--font-mono); font-weight: 700; }
  .muted { color: var(--ink-muted); }
    .status { margin: 0; text-align: center; font-weight: 600; color: var(--ink-muted); }
  .centre { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 12px; }
  .centre h1 { margin: 0; font: 600 28px/34px var(--font-display); }
  .centre p { margin: 0; max-width: 300px; line-height: 23px; }

  .pad { flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(88px, 1fr); gap: 16px; min-height: 360px; }
  .pad.two { grid-template-columns: 1fr; }
  .answer {
    border: 0; border-radius: var(--radius-md); cursor: pointer; display: grid; place-items: center;
    box-shadow: 6px 8px 18px var(--edge-dark); transition: transform var(--dur-press), opacity var(--dur-press), box-shadow var(--dur-press);
  }
  .answer:active:not(:disabled) { transform: scale(0.96); box-shadow: var(--morph-inset); }
  .answer:disabled { cursor: default; }
  .answer.picked { box-shadow: var(--morph-inset); outline: 3px solid var(--ink); outline-offset: 4px; }
  .answer.dim { opacity: 0.3; }
  .shape { font-size: 64px; line-height: 1; }

  .result .badge {
    width: 140px; height: 140px; border-radius: 50%; display: grid; place-items: center; font-size: 64px; font-weight: 700;
    background: var(--wrong); color: var(--surface-0); box-shadow: var(--morph-raised); animation: pop 420ms var(--ease-out) both;
  }
  .result.good .badge { background: var(--correct); }
  .place { margin: 0; font-size: 64px; color: var(--spud); line-height: 1; }
  .points { margin: 0; font-size: 40px; color: var(--ink-muted); }
  .result.good .points { color: var(--correct); }

  @keyframes pop { from { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.08); } }
</style>
