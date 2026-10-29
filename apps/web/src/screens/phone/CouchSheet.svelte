<!-- The Head Spud's "who's on the couch" sheet: hand the role over or take someone off the couch.
     Opens over the lobby or the game. Risky taps ask twice, so a fumble never kicks a friend. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Player } from '@couchpotato/shared';
  import Potato from '../../lib/Potato.svelte';
  import { seatColour } from '../../lib/seats';

  let {
    open = $bindable(),
    players,
    myId,
    onKick,
    onHandOver,
    children,
  }: {
    open: boolean;
    players: Player[];
    myId: string | null;
    onKick: (playerId: string) => void;
    onHandOver: (playerId: string) => void;
    /** Extra actions shown above the list, e.g. skip and end game during a game. */
    children?: Snippet;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  /** The action waiting for a second tap. Forgotten after a few seconds. */
  let confirm = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function twice(key: string, act: () => void) {
    clearTimeout(timer);
    if (confirm === key) {
      confirm = null;
      act();
      return;
    }
    confirm = key;
    timer = setTimeout(() => (confirm = null), 3000);
  }
  $effect(() => () => clearTimeout(timer));

  const others = $derived(players.filter((p) => p.id !== myId));
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && (open = false)} aria-labelledby="couch-title">
  <div class="sheet">
    <header>
      <h2 id="couch-title">Head Spud remote</h2>
      <button class="close" onclick={() => (open = false)} aria-label="Close">✕</button>
    </header>
    {#if children}<div class="extra">{@render children()}</div>{/if}
    <span class="label">ON THE COUCH</span>
    {#if !others.length}
      <p class="empty">Nobody else is here yet.</p>
    {/if}
    <ul>
      {#each others as p (p.id)}
        {@const c = seatColour(p.colour)}
        <li class:away={p.away}>
          <span class="av" style:background={c.bg}><Potato kind={p.potato} size={36} still asleep={p.away} shadow={false} /></span>
          <span class="name">{p.name}{#if p.away}<small> · away</small>{/if}</span>
          <div class="acts">
            <button
              class="soft"
              class:sure={confirm === `crown:${p.id}`}
              disabled={p.away}
              onclick={() => twice(`crown:${p.id}`, () => {
                onHandOver(p.id);
                open = false;
              })}
            >
              {confirm === `crown:${p.id}` ? 'Sure?' : 'Make host'}
            </button>
            <button class="soft danger" class:sure={confirm === `kick:${p.id}`} onclick={() => twice(`kick:${p.id}`, () => onKick(p.id))}>
              {confirm === `kick:${p.id}` ? 'Kick?' : 'Kick'}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </div>
</dialog>

<style>
  dialog {
    width: 100%; max-width: 480px; max-height: 85dvh; margin: auto auto 0; padding: 0; border: 0;
    border-radius: 28px 28px 0 0; background: var(--surface-0); color: var(--ink); box-shadow: var(--morph-raised);
  }
  dialog[open] { animation: up 240ms var(--ease-out); }
  dialog::backdrop { background: var(--edge-dark); }
  .sheet { padding: 20px var(--space-2) 28px; display: flex; flex-direction: column; gap: 12px; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font: 600 22px var(--font-display); }
  .close { width: 56px; height: 56px; border: 0; border-radius: 50%; background: var(--surface-1); color: var(--ink); font: 700 18px var(--font-sans); cursor: pointer; }
  .extra { display: flex; flex-direction: column; gap: 10px; }
  .label { margin-top: 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-muted); }
  .empty { margin: 0; color: var(--ink-muted); font-weight: 600; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 4px 4px 4px 8px; border-radius: 20px; background: var(--surface-1); }
  li.away { opacity: 0.6; }
  .av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0; }
  .name { flex: 1; min-width: 0; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name small { font-weight: 600; color: var(--ink-muted); }
  .acts { display: flex; gap: 6px; }
  button.soft {
    min-height: 56px; padding: 0 14px; border: 0; border-radius: var(--radius-pill); cursor: pointer;
    background: var(--surface-0); color: var(--ink); font: 700 15px var(--font-sans); box-shadow: var(--morph-raised);
    transition: transform var(--dur-press);
  }
  button.soft:active:not(:disabled) { transform: scale(0.96); box-shadow: var(--morph-inset); }
  button.soft:disabled { opacity: 0.4; cursor: default; }
  button.danger { color: var(--wrong); }
  button.sure { background: var(--spud); color: var(--ink-on-spud); }
  button.danger.sure { background: var(--wrong); color: var(--surface-0); }

  @keyframes up { from { transform: translateY(40px); opacity: 0; } }
</style>
