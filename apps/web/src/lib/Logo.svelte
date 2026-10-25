<script lang="ts">
  let { size = 64, iconOnly = false }: { size?: number; iconOnly?: boolean } = $props();
</script>

{#if iconOnly}
  <svg viewBox="20 22 62 56" width={size} height={size * 0.9} aria-hidden="true">
    <path d="M31 58 C27 38 41 26 55 28 C71 30 79 43 75 58 C72 71 59 75 49 74 C39 73 33 68 31 58 Z" fill="var(--spud)" />
    <path d="M42 51 q3.5 3.5 7 0 M56 51 q3.5 3.5 7 0" stroke="#1C1916" stroke-width="3" fill="none" stroke-linecap="round" />
  </svg>
{:else}
  <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Couch Potato">
    <rect x="14" y="40" width="72" height="30" rx="13" fill="var(--sofa)" />
    <path d="M31 58 C27 38 41 26 55 28 C71 30 79 43 75 58 C72 71 59 75 49 74 C39 73 33 68 31 58 Z" fill="var(--spud)" />
    <path d="M42 51 q3.5 3.5 7 0 M56 51 q3.5 3.5 7 0" stroke="#1C1916" stroke-width="2.4" fill="none" stroke-linecap="round" />
    <rect x="6" y="60" width="88" height="22" rx="11" fill="var(--sofa)" opacity="0.85" />
    <rect x="3" y="52" width="16" height="30" rx="8" fill="var(--sofa)" />
    <rect x="81" y="52" width="16" height="30" rx="8" fill="var(--sofa)" />
  </svg>
{/if}
