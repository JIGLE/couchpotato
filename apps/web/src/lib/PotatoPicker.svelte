<!-- Pick your potato: a 4×2 grid of 88px tiles. Potatoes other players already have are shown with their name. -->
<script lang="ts">
  import type { PotatoKind } from '@couchpotato/shared';
  import Potato from './Potato.svelte';
  import { POTATOES } from './potatoes';

  let {
    value,
    taken = new Map(),
    legend = 'PICK YOUR POTATO',
    onPick,
  }: {
    value: PotatoKind;
    /** Potato → name of the player who has it. Your own potato is not in here. */
    taken?: Map<PotatoKind, string>;
    legend?: string;
    onPick: (kind: PotatoKind) => void;
  } = $props();

  const picked = $derived(POTATOES.find((p) => p.kind === value));
</script>

<fieldset class="picker">
  <legend>{legend}</legend>
  <div class="grid">
    {#each POTATOES as p, i (p.kind)}
      {@const owner = taken.get(p.kind)}
      <label class="tile" class:picked={value === p.kind} class:taken={!!owner}>
        <input
          type="radio"
          name="potato"
          value={p.kind}
          checked={value === p.kind}
          disabled={!!owner}
          onchange={() => onPick(p.kind)}
        />
        <Potato kind={p.kind} size={60} still={value !== p.kind} delay={i * 0.3} />
        <span class="name">{owner ?? p.name}</span>
      </label>
    {/each}
  </div>
  {#if picked}<p class="quirk"><strong>{picked.name}.</strong> {picked.quirk}.</p>{/if}
</fieldset>

<style>
  .picker { border: 0; margin: 8px 0 0; padding: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-muted); }
  .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .tile {
    position: relative; min-height: 88px; padding: 6px 2px 8px; border-radius: 20px; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px;
    background: var(--surface-1); box-shadow: var(--morph-raised);
    transition: transform var(--dur-press), box-shadow var(--dur-press);
  }
  .tile:active { transform: scale(0.94); }
  .tile.picked { background: var(--surface-2); box-shadow: 0 0 0 3px var(--spud), 0 0 24px var(--glow); }
  .tile.picked :global(.potato) { animation: hop 360ms var(--ease-out); }
  .tile.taken { cursor: default; opacity: 0.4; box-shadow: var(--morph-inset); filter: grayscale(0.7); }
  .tile input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: inherit; }
  .tile:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 4px; }
  .name {
    font-size: 12px; font-weight: 700; color: var(--ink-muted); max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .picked .name { color: var(--ink); }
  .quirk { margin: 12px 0 0; font-size: 15px; color: var(--ink-muted); }
  .quirk strong { color: var(--ink); }
  @keyframes hop { 40% { transform: translateY(-10px) scale(0.95, 1.06); } 70% { transform: translateY(0) scale(1.06, 0.92); } }
</style>
