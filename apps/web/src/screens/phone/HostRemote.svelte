<!-- The Head Spud's remote during a game: one slim row under their own answer pad, so they can play and run the
     night from the same phone. Pause, +10 s and "move on" are one tap; skipping, kicking, handing over and ending
     live one step away in the sheet. The server checks every press; this only sends intents. -->
<script lang="ts">
  import type { GameControl, GameView, Player } from '@couchpotato/shared';
  import CouchSheet from './CouchSheet.svelte';

  let {
    view,
    players,
    myId,
    onControl,
    onKick,
    onHandOver,
    onEnd,
  }: {
    view: GameView;
    players: Player[];
    myId: string | null;
    onControl: (action: GameControl) => void;
    onKick: (playerId: string) => void;
    onHandOver: (playerId: string) => void;
    onEnd: () => void;
  } = $props();

  let sheet = $state(false);
  const paused = $derived(view.phase !== 'podium' && !!view.paused);
  const timed = $derived(view.phase === 'question' && (view.endsAt !== null || typeof view.left === 'number'));
  const nextLabel = $derived(view.phase === 'question' ? 'Reveal' : 'Next');

  /** Skip and End ask twice too, like kicks in the sheet. */
  let confirm = $state<'skip' | 'end' | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function twice(key: 'skip' | 'end', act: () => void) {
    clearTimeout(timer);
    if (confirm === key) {
      confirm = null;
      sheet = false;
      act();
      return;
    }
    confirm = key;
    timer = setTimeout(() => (confirm = null), 3000);
  }
  $effect(() => () => clearTimeout(timer));

  function press(action: GameControl) {
    navigator.vibrate?.(8);
    onControl(action);
  }
</script>

<div class="remote" role="toolbar" aria-label="Head Spud remote">
  <button class:on={paused} onclick={() => press(paused ? 'resume' : 'pause')}>
    <span class="icon" aria-hidden="true">{paused ? '▶' : '❚❚'}</span>{paused ? 'Resume' : 'Pause'}
  </button>
  <button disabled={!timed} onclick={() => press('add-time')}><span class="icon" aria-hidden="true">+</span>10 s</button>
  <button onclick={() => press('next')}><span class="icon" aria-hidden="true">⏭</span>{nextLabel}</button>
  <button onclick={() => (sheet = true)} aria-haspopup="dialog"><span class="icon" aria-hidden="true">⋯</span>More</button>
</div>

<CouchSheet bind:open={sheet} {players} {myId} {onKick} {onHandOver}>
  {#if view.phase === 'question'}
    <button class="wide" class:sure={confirm === 'skip'} onclick={() => twice('skip', () => onControl('skip'))}>
      {confirm === 'skip' ? 'Tap again to skip' : 'Skip this question'}
      <small>Nobody scores it; the next one starts.</small>
    </button>
  {/if}
  <button class="wide danger" class:sure={confirm === 'end'} onclick={() => twice('end', onEnd)}>
    {confirm === 'end' ? 'Tap again to end' : 'End game for everyone'}
    <small>Back to the lobby. Scores are lost.</small>
  </button>
</CouchSheet>

<style>
  .remote {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 8px;
    border-radius: 24px; background: var(--surface-1); box-shadow: var(--morph-inset);
  }
  button {
    border: 0; cursor: pointer; font: 700 14px var(--font-sans); transition: transform var(--dur-press), box-shadow var(--dur-press);
  }
  .remote button {
    min-height: 56px; border-radius: 18px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    background: var(--surface-0); color: var(--ink); box-shadow: var(--morph-raised);
  }
  .remote button:active:not(:disabled) { transform: scale(0.95); box-shadow: var(--morph-inset); }
  .remote button:disabled { opacity: 0.35; cursor: default; }
  .remote button.on { background: var(--spud); color: var(--ink-on-spud); box-shadow: 0 0 20px var(--glow); }
  .icon { font-size: 16px; line-height: 1; letter-spacing: -0.1em; }

  .wide {
    min-height: 64px; padding: 10px 20px; border-radius: 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    background: var(--surface-1); color: var(--ink); font-size: 17px; text-align: left; box-shadow: var(--morph-raised);
  }
  .wide small { font-size: 13px; font-weight: 600; color: var(--ink-muted); }
  .wide.danger { color: var(--wrong); }
  .wide.sure { background: var(--spud); color: var(--ink-on-spud); }
  .wide.danger.sure { background: var(--wrong); color: var(--surface-0); }
  .wide.sure small { color: inherit; opacity: 0.8; }
</style>
