<!-- Seconds left until the server's deadline. `offset` = this device's clock minus the server's. -->
<script lang="ts">
  let { endsAt, offset, size = 104 }: { endsAt: number; offset: number; size?: number } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 200);
    return () => clearInterval(t);
  });
  const left = $derived(Math.max(0, Math.ceil((endsAt - (now - offset)) / 1000)));
</script>

<div
  class="timer"
  class:urgent={left <= 5}
  role="timer"
  aria-label="{left} seconds left"
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.38)}px"
>
  {left}
</div>

<style>
  .timer {
    border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
    font-family: var(--font-mono); font-weight: 700; color: var(--spud);
    background: var(--surface-1); box-shadow: var(--morph-inset);
  }
  .urgent { animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { transform: scale(1.08); } }
  @media (prefers-reduced-motion: reduce) { .urgent { animation: none; } }
</style>
