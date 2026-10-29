<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CushionColour, Player, PotatoKind } from '@couchpotato/shared';
  import { connect } from '../lib/socket';
  import Logo from '../lib/Logo.svelte';
  import { seatColour } from '../lib/seats';
  import Potato from '../lib/Potato.svelte';
  import PotatoPicker from '../lib/PotatoPicker.svelte';
  import { POTATOES, loadPotato, savePotato } from '../lib/potatoes';
  import type { GameSettings, GameView, Mood } from '@couchpotato/shared';
  import PhoneGame from './phone/PhoneGame.svelte';
  import HostSetup from './phone/HostSetup.svelte';
  import Claim from './phone/Claim.svelte';
  import { applyMood, loadSettings, saveSettings } from '../lib/game';

  /** The seat this phone last sat in. The token lets the server give it back after a refresh. */
  type SavedSeat = { code: string; token: string };
  function loadSeat(): SavedSeat | null {
    try {
      const v = JSON.parse(localStorage.getItem('cp:seat') ?? 'null');
      return v && typeof v.code === 'string' && typeof v.token === 'string' ? v : null;
    } catch {
      return null;
    }
  }
  function saveSeat(v: SavedSeat | null) {
    if (v) localStorage.setItem('cp:seat', JSON.stringify(v));
    else localStorage.removeItem('cp:seat');
  }

  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('code') ?? '').toUpperCase();
  // The TV's claim QR opens /claim?tv=ABC123: this phone wants to open a room, not join one.
  const claimLink = location.pathname.startsWith('/claim');
  let claiming = $state(claimLink);
  let pairing = $state((params.get('tv') ?? '').toUpperCase());
  let claimError = $state('');
  let claimBusy = $state(false);
  let claimScreen = $state<ReturnType<typeof Claim>>();
  let seatInfo = loadSeat();
  const savedName = localStorage.getItem('cp:name') ?? '';
  let name = $state(savedName);
  let code = $state(urlCode || seatInfo?.code || '');
  // Same room as last time (or no room in the link) and we know who we are: sit straight back down.
  let rejoining = $state(!claimLink && !!seatInfo && !!savedName && (!urlCode || urlCode === seatInfo.code));
  let joined = $state(false);
  let online = $state(false);
  let count = $state(0);
  let error = $state('');
  let playerId = $state<string | null>(null);
  let me = $state<Player | null>(null);
  const COLOURS: { value: CushionColour; label: string }[] = [
    { value: 0, label: 'Gold' },
    { value: 1, label: 'Teal' },
    { value: 2, label: 'Cream' },
    { value: 3, label: 'Rust' },
  ];
  const savedColour = Number(localStorage.getItem('cp:colour'));
  let colour = $state<CushionColour>(([0, 1, 2, 3] as const).find((c) => c === savedColour) ?? 0);
  let potato = $state<PotatoKind>(loadPotato() ?? 'boiled');
  let players = $state<Player[]>([]);
  let swapping = $state(false);
  /** Potatoes other people on the couch already have, with their names. Once all eight are in use they can repeat. */
  const taken = $derived.by(() => {
    const others = new Map(players.filter((p) => p.id !== playerId).map((p) => [p.potato, p.name] as const));
    return others.size >= POTATOES.length ? new Map<PotatoKind, string>() : others;
  });

  function hello() {
    const token = seatInfo && seatInfo.code === code ? seatInfo.token : undefined;
    socket.emit('hello', { screen: 'phone', code, name, colour, potato, token });
  }

  const socket = connect();
  socket.on('connect', () => {
    online = true;
    if (joined || rejoining) hello(); // after a refresh or a Wi-Fi blip
  });
  socket.on('disconnect', () => (online = false));
  socket.on('room:joined', (p) => {
    code = p.code;
    joined = true;
    if (claiming) {
      // From here on this is an ordinary seat: a refresh should rejoin the room, not try to claim again.
      claiming = false;
      claimBusy = false;
      history.replaceState(null, '', `/?code=${p.code}`);
    }
    rejoining = false;
    error = '';
    playerId = p.playerId ?? null;
    if (p.token) {
      seatInfo = { code: p.code, token: p.token };
      saveSeat(seatInfo);
    }
  });
  socket.on('room:error', (p) => {
    const wasRejoining = rejoining;
    joined = false;
    rejoining = false;
    if (seatInfo?.code === p.code || p.reason === 'not-found') {
      seatInfo = null;
      saveSeat(null);
    }
    // A room that ended since last time isn't the player's fault: just show the form.
    if (wasRejoining && p.reason === 'not-found') {
      code = urlCode;
      error = '';
      return;
    }
    error =
      p.reason === 'not-found' ? `No room called ${p.code}. Check the code on the TV.`
      : p.reason === 'full' ? 'The couch is full — all 12 seats are taken.'
      : 'Enter the code shown on the TV.';
  });
  socket.on('room:claim-error', (p) => {
    claimBusy = false;
    if (p.reason === 'sign-in') {
      claimError = '';
      void claimScreen?.refresh(); // signed out or revoked meanwhile: show the sign-in form
      return;
    }
    claimError =
      p.reason === 'expired' ? 'That code has changed or was used. Type the one on the TV now, or scan it again.'
      : 'Too many wrong codes. Wait a minute and try again.';
  });
  socket.on('room:players', (p) => {
    players = p.players;
    me = p.players.find((pl) => pl.id === playerId) ?? null;
    // The server has the last word: if our potato was taken it handed us another.
    if (me && me.potato !== potato) {
      potato = me.potato;
      savePotato(potato);
    }
  });
  socket.on('tap:count', (p) => (count = p.count));
  // Tile colours must match the TV exactly, so phones always wear the room's mood.
  let mood = $state<Mood>('lamp');
  socket.on('room:mood', (p) => {
    mood = p.mood;
    applyMood(p.mood, false);
  });

  let game = $state<GameView | null>(null);
  let offset = $state(0);
  socket.on('game:state', (view) => {
    game = view;
    if (view) offset = Date.now() - view.serverNow;
  });

  // The Head Spud runs the night from here: settings, mood, start, and the end-of-game buttons.
  const isHost = $derived(me?.role === 'head-spud');
  const headSpud = $derived(players.find((p) => p.role === 'head-spud'));
  let settings = $state<GameSettings>(loadSettings());
  let setupStep = $state<'pick' | 'setup'>('pick');
  let notice = $state('');
  socket.on('game:error', (p) => {
    notice = p.reason === 'no-players' ? 'Nobody on the couch yet.' : 'No questions match these settings. Try another language or age.';
  });
  // Share the choices as they are made so the TV can show what's coming.
  $effect(() => {
    if (!isHost || game || !online) return;
    const snap = $state.snapshot(settings);
    saveSettings(snap);
    socket.emit('lobby:setup', snap);
  });
  function startGame() {
    notice = '';
    socket.emit('game:start', $state.snapshot(settings));
  }
  const endGame = () => socket.emit('game:end');
  const changeMood = (m: Mood) => socket.emit('room:mood', { mood: m });
  onDestroy(() => socket.disconnect());

  function join(e: SubmitEvent) {
    e.preventDefault();
    name = name.trim() || 'Potato';
    code = code.trim().toUpperCase();
    localStorage.setItem('cp:name', name);
    localStorage.setItem('cp:colour', String(colour));
    savePotato(potato);
    // A fresh connection per attempt, so a wrong code can be retried cleanly.
    socket.disconnect().connect();
    socket.once('connect', hello);
  }

  function claim() {
    claimError = '';
    claimBusy = true;
    name = name.trim() || 'Head Spud';
    localStorage.setItem('cp:name', name);
    savePotato(potato);
    // A fresh connection so the handshake carries the sign-in cookie we may have just been given.
    socket.disconnect().connect();
    socket.once('connect', () => socket.emit('room:claim', { pairing, name, colour, potato }));
  }

  function switchTo(claim: boolean) {
    claiming = claim;
    error = '';
    claimError = '';
    history.replaceState(null, '', claim ? '/claim' : '/');
  }

  function leave() {
    socket.emit('leave');
    seatInfo = null;
    saveSeat(null);
    joined = false;
    me = null;
    playerId = null;
    game = null;
  }

  function swap(kind: PotatoKind) {
    potato = kind;
    savePotato(kind);
    socket.emit('potato:pick', { potato: kind });
    swapping = false;
  }

  function tap() {
    navigator.vibrate?.(10);
    socket.emit('tap');
  }
</script>

<!-- The host's docked Start button sits over the bottom of the page: leave room to scroll past it. -->
<main class:docked={joined && isHost && !game && !swapping && setupStep === 'setup'}>
  <div class="brand"><Logo iconOnly size={34} /><span>couch potato</span></div>

  {#if rejoining}
    <div class="me" role="status">
      <h1>Finding your seat…</h1>
      <p class="hint">Room {code}</p>
    </div>
  {:else if !joined && claiming}
    <Claim
      bind:this={claimScreen}
      bind:pairing
      bind:name
      bind:potato
      error={claimError}
      busy={claimBusy}
      onClaim={claim}
      onJoinInstead={() => switchTo(false)}
    />
  {:else if !joined}
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
      <PotatoPicker value={potato} onPick={(k) => (potato = k)} />
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
      <button class="leave" type="button" onclick={() => switchTo(true)}>Hosting tonight? Open a room on the TV</button>
    </form>
  {:else if game}
    <PhoneGame view={game} {offset} {playerId} onAnswer={(choice) => socket.emit('game:answer', { choice })} />
    {#if isHost}
      <div class="remote" aria-label="Head Spud remote">
        {#if game.phase === 'podium'}
          <button class="ghost" onclick={endGame}>Back to lobby</button>
          <button class="primary" onclick={startGame}>Play again</button>
        {:else}
          <button class="leave" onclick={endGame}>End game for everyone</button>
        {/if}
      </div>
    {/if}
  {:else if isHost}
    <!-- The Head Spud's lobby is a remote first: a slim "who am I" row, then the setup steps. -->
    <div class="who">
      {#if me}
        {@const c = seatColour(me.colour)}
        {#key me.potato}
          <div class="avatar small" style:background={c.bg}><Potato kind={me.potato} size={60} /></div>
        {/key}
      {/if}
      <div class="who-text">
        <span class="crown">HEAD SPUD</span>
        <strong>{online ? `You run tonight, ${name}.` : 'Lost the couch for a sec…'}</strong>
        <span class="mono">Room {code}</span>
      </div>
    </div>
    {#if swapping}
      <PotatoPicker value={potato} {taken} legend="SWAP YOUR POTATO" onPick={swap} />
      <button class="leave" onclick={() => (swapping = false)}>Keep this potato</button>
    {:else}
      <HostSetup bind:settings bind:step={setupStep} {players} {mood} {notice} onMood={changeMood} onStart={startGame} />
      <div class="extras">
        <button class="leave" onclick={tap} disabled={!online}>Bounce your potato</button>
        <button class="leave" onclick={() => (swapping = true)} disabled={!online}>Swap potato</button>
        <button class="leave" onclick={leave}>Leave the couch</button>
      </div>
    {/if}
  {:else}
    <div class="me">
      {#if me}
        {@const c = seatColour(me.colour)}
        {#key me.potato}
          <div class="avatar" style:background={c.bg}><Potato kind={me.potato} size={150} /></div>
        {/key}
      {/if}
      <h1>{online ? `You're in, ${name}.` : 'Lost the couch for a sec…'}</h1>
      <p class="hint">
        {#if !online}Reconnecting…
        {:else if headSpud}{headSpud.name} is the Head Spud and starts the game.
        {:else}Look at the TV.{/if}
      </p>
    </div>
    {#if swapping}
      <PotatoPicker value={potato} {taken} legend="SWAP YOUR POTATO" onPick={swap} />
    {:else}
      <button class="tap" onclick={tap} disabled={!online}>Bounce your potato</button>
    {/if}
    <button class="leave" onclick={() => (swapping = !swapping)} disabled={!online}>{swapping ? 'Keep this potato' : 'Swap potato'}</button>
    <p class="mono">Room {code} · {count} waves</p>
    <button class="leave" onclick={leave}>Leave the couch</button>
  {/if}
</main>

<style>
  main {
    min-height: 100dvh; padding: 48px var(--space-2) 32px; max-width: 480px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 24px;
  }
  main.docked { padding-bottom: 136px; }
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
    width: 168px; height: 168px; border-radius: 50%; display: grid; place-items: center;
    box-shadow: var(--morph-raised); animation: land 520ms var(--ease-out);
  }
  /* A tiny preview of the sofa landing to come: drop, squash, settle. */
  @keyframes land {
    0% { transform: translateY(-40px) scale(0.9, 1.1); opacity: 0; }
    55% { transform: translateY(0) scale(1.12, 0.86); opacity: 1; }
    75% { transform: scale(0.96, 1.04); }
  }
  .tap {
    min-height: 120px; border-radius: 40px; background: var(--tile-b); color: var(--tile-b-ink);
    font-family: var(--font-display); font-size: 28px; box-shadow: var(--morph-raised);
  }
  .tap:disabled { opacity: 0.4; }
  .leave {
    min-height: 56px; border-radius: var(--radius-pill); background: transparent; color: var(--ink-muted);
    font-size: 15px; box-shadow: none;
  }
  .crown {
    padding: 6px 14px; border-radius: var(--radius-pill); background: var(--spud); color: var(--ink-on-spud);
    font: 700 13px var(--font-display); letter-spacing: 0.08em; box-shadow: 0 0 24px var(--glow);
  }
  .who { display: flex; align-items: center; gap: 16px; }
  .avatar.small { width: 72px; height: 72px; flex-shrink: 0; box-shadow: var(--morph-raised); }
  .who-text { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
  .who-text strong { font: 600 20px var(--font-display); }
  .who-text .mono { font-size: 14px; }
  .extras { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 8px; }
  .remote { display: flex; gap: 12px; }
  .remote button { flex: 1; min-height: 56px; border-radius: var(--radius-pill); }
  .ghost { background: var(--surface-1); color: var(--ink); box-shadow: var(--morph-raised); }
  .remote .primary { margin-top: 0; }
  .mono { margin: 0; text-align: center; font-family: var(--font-mono); color: var(--ink-muted); }
</style>
