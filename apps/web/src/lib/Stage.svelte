<!-- The TV is designed on a fixed 1280×720 stage that scales to fill any screen (TV, projector, laptop)
     without cropping, so layouts look the same everywhere. The ambient glow stays full-bleed behind it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  let w = $state(window.innerWidth);
  let h = $state(window.innerHeight);
  const scale = $derived(Math.min(w / 1280, h / 720));
</script>

<svelte:window bind:innerWidth={w} bind:innerHeight={h} />

<div class="stage" style:transform="translate(-50%, -50%) scale({scale})">
  {@render children()}
</div>

<style>
  .stage {
    position: fixed; left: 50%; top: 50%; z-index: 1;
    width: 1280px; height: 720px; transform-origin: center;
  }
  :global(body:has(.stage)) { overflow: hidden; }
</style>
