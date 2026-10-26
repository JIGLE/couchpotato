<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CushionColour } from '@couchpotato/shared';
  import { connect } from '../lib/socket';
  import Logo from '../lib/Logo.svelte';
  import { seatColour, initial } from '../lib/seats';

  let name = $state(localStorage.getItem('cp:name') ?? '');
  let code = $state((new URLSearchParams(location.search).get('code') ?? '').toUpperCase());
  let joined = $state(false);
  let online = $state(false);
  let count = $state(0);
  let error = $state('');
  let seat = $state<number | null>(null);
  const COLOURS: { value: CushionColour; label: string }[] = [
    { value: 0, label: 'Gold' },
    { value: 1, label: 'Teal' },
    { value: 2, label: 'Cream' },
    { value: 3, label: 'Rust' },
  ];
  const saved = Number(localStorage.getItem('cp:colour'));
  let colour = $state<CushionColour>(([0, 1, 2, 3] as const).find((c) => c === saved) ?? 0);

  const socket = connect();
  socket.on('connect', () => {
    online = true;
    if (joined) socket.emit('hello', { screen: 'phone', code, name, colour }); // silent rejoin after a blip
  });
  socket.on('disconnect', () => (online = false));
  socket.on('room:joined', (p) => {
    code = p.code;
    joined = true;
    error = '';
  });
  socket.on('room:error', (p) => {
    joined = false;
    error =
      p.reason === 'not-found' ? `No room called ${p.code}. Check the code on the TV.`
      : p.reason === 'full' ? 'The couch is full — all 8 seats are taken.'
      : 'Enter the code shown on the TV.';
  });
  socket.on('room:players', (p) => {
    seat = p.players.find((pl) => pl.id === socket.id)?.seat ?? null;
  });
  socket.on('tap:count', (p) => (count = p.count));
  onDestroy(() => socket.disconnect());

  function join(e: SubmitEvent) {
    e.preventDefault();
    name = name.trim() || 'Potato';
    code = code.trim().toUpperCase();
    localStorage.setItem('cp:name', name);
    localStorage.setItem('cp:colour', String(colour));
    // A fresh connection per attempt, so a wrong code can be retried cleanly.
    socket.disconnect().connect();
    socket.once('connect', () => socket.emit('hello', { screen: 'phone', code, name, colour }));
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
      <label for="code">ROOM CODE</label>
      <input
        id="code"
        class="code"
        bind:value={code}
        maxlength="4"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        placeholder="SPUD"
        aria-describedby="code-error"
      />
      {#if error}<p id="code-error" class="error" role="alert">{error}</p>{/if}
      <label for="name">YOUR NAME</label>
      <input id="name" bind:value={name} maxlength="20" autocomplete="nickname" placeholder="Nickname" />
      <fieldset class="cushions">
        <legend>PICK A CUSHION</legend>
        <div class="swatches">
          {#each COLOURS as c (c.value)}
            {@const sw = seatColour(c.value)}
            <label class="swatch" class:picked={colour === c.value} style:background={sw.bg}>
              <input type="radio" name="colour" value={c.value} bind:group={colour} />
              <span class="sr">{c.label}</span>
            </label>
          {/each}
        </div>
      </fieldset>
      <button class="primary" type="submit">Join</button>
    </form>
  {:else}
    <div class="me">
      {#if seat !== null}
        {@const c = seatColour(colour)}
        <div class="avatar" style:background={c.bg} style:color={c.fg}>{initial(name)}</div>
      {/if}
      <h1>{online ? `You're in, ${name}.` : 'Lost the couch for a sec…'}</h1>
      <p class="hint">{online ? 'Look at the TV. The host starts when everyone’s comfy.' : 'Reconnecting…'}</p>
    </div>
    <button class="tap" onclick={tap} disabled={!online}>Wave at the TV</button>
    <p class="mono">Room {code} · {count} waves</p>
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
  input.code { font: 700 28px var(--font-mono); letter-spacing: 0.2em; color: var(--spud); text-transform: uppercase; height: 64px; }
  .cushions { border: 0; margin: 8px 0 0; padding: 0; }
  .cushions legend { padding: 0; margin-bottom: 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-muted); }
  .swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .swatch {
    position: relative; aspect-ratio: 1; min-height: 56px; border-radius: 50%; cursor: pointer;
    box-shadow: 6px 8px 18px var(--edge-dark); transition: transform var(--dur-press), box-shadow var(--dur-press);
  }
  .swatch:active { transform: scale(0.94); }
  .swatch.picked { box-shadow: 0 0 0 3px var(--surface-0), 0 0 0 6px var(--ink); }
  .swatch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
  .swatch:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 8px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .error { margin: 0; font-size: 15px; font-weight: 600; color: var(--wrong); }
  button { border: 0; cursor: pointer; font: 700 18px var(--font-sans); transition: transform var(--dur-press), box-shadow var(--dur-press); }
  button:active { transform: scale(0.96); box-shadow: var(--morph-inset); }
  .primary { margin-top: auto; height: 60px; border-radius: var(--radius-pill); background: var(--spud); color: var(--ink-on-spud); box-shadow: 6px 8px 18px var(--edge-dark); }
  .hint { margin: 0; text-align: center; font-weight: 600; color: var(--ink-muted); }
  .me { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; }
  .me h1 { margin: 0; }
  .avatar {
    width: 140px; height: 140px; border-radius: 50%; display: grid; place-items: center;
    font-family: var(--font-display); font-size: 56px; font-weight: 700; box-shadow: var(--morph-raised);
  }
  .tap {
    min-height: 120px; border-radius: 40px; background: var(--tile-b); color: var(--tile-b-ink);
    font-family: var(--font-display); font-size: 28px; box-shadow: var(--morph-raised);
  }
  .tap:disabled { opacity: 0.4; }
  .mono { margin: 0; text-align: center; font-family: var(--font-mono); color: var(--ink-muted); }
</style>
