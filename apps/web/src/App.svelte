<script lang="ts">
  import Tv from './screens/Tv.svelte';
  import Phone from './screens/Phone.svelte';

  // Tiny router: /tv is the big screen, everything else is the phone.
  // Swap for a real router once there are more screens (see docs/ROADMAP.md, Phase 1).
  const isTv = location.pathname.startsWith('/tv');
</script>

{#if isTv}
  <Tv />
{:else}
  <Phone />
{/if}
