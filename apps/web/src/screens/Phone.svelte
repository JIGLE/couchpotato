<script lang="ts">
  import { onDestroy } from 'svelte';
  import { connect } from '../lib/socket';
  import Logo from '../lib/Logo.svelte';

  let name = $state(localStorage.getItem('cp:name') ?? '');
  let joined = $state(false);
  let online = $state(false);
  let count = $state(0);

  const socket = connect();
  socket.on('connect', () => {
    online = true;
    if (joined) socket.emit('hello', { screen: 'phone', name }); // silent rejoin after a blip
  });
  socket.on('disconnect', () => (online = false));
  socket.on('tap:count', (p) => (count = p.count));
  onDestroy(() => socket.disconnect());

  function join(e: SubmitEvent) {
    e.preventDefault();
    name = name.trim() || 'Potato';
    localStorage.setItem('cp:name', name);
    joined = true;
    socket.emit('hello', { screen: 'phone', name });
  }

  function tap() {
    navigator.vibrate?.(10);
    socket.emit('tap');
  }
</script>

<main>
  <div class="brand"><Logo iconOnly size={34} /><span>couch potato</span></div>

  {#if !joined}
    <form onsubmit={join}>
      <h1>Pull up a seat.</h1>
      <label for="name">YOUR NAME</label>
      <input id="name" bind:value={name} maxlength="20" autocomplete="nickname" placeholder="Nickname" />
      <button class="primary" type="submit">Join</button>
    </form>
  {:else}
    <p class="hint">{online ? `Hi ${name}! Watch the TV.` : 'Lost the couch for a sec — reconnecting…'}</p>
    <button class="tap" onclick={tap} disabled={!online}>Tap</button>
    <p class="mono">{count} taps so far</p>
  {/if}
</main>

<style>
  main {
    min-height: 100dvh; padding: 48px var(--space-2) 32px; max-width: 480px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 24px;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-weight: 600; font-size: 18px; letter-spacing: -0.03em; }
  form { display: flex; flex-direction: column; gap: 10px; flex: 1; }
  h1 { font-family: var(--font-display); font-weight: 600; font-size: 28px; margin: 0 0 18px; }
  label { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-muted); }
  input {
    appearance: none; border: 0; height: 56px; padding: 0 20px; border-radius: 16px;
    background: var(--surface-1); color: var(--ink); font: 600 18px var(--font-sans); box-shadow: var(--morph-inset);
  }
  button { border: 0; cursor: pointer; font: 700 18px var(--font-sans); transition: transform var(--dur-press), box-shadow var(--dur-press); }
  button:active { transform: scale(0.96); box-shadow: var(--morph-inset); }
  .primary { margin-top: auto; height: 60px; border-radius: var(--radius-pill); background: var(--spud); color: var(--ink-on-spud); box-shadow: 6px 8px 18px var(--edge-dark); }
  .hint { margin: 0; text-align: center; font-weight: 600; color: var(--ink-muted); }
  .tap {
    flex: 1; min-height: 260px; border-radius: 40px; background: var(--tile-b); color: var(--tile-b-ink);
    font-family: var(--font-display); font-size: 48px; box-shadow: var(--morph-raised);
  }
  .tap:disabled { opacity: 0.4; }
  .mono { margin: 0; text-align: center; font-family: var(--font-mono); color: var(--ink-muted); }
</style>
