<script lang="ts">
  import { onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import type { GameSettings, GameView, Player } from '@couchpotato/shared';
  import type { Mood } from '@couchpotato/shared';
  import { LANGUAGE_NAMES, applyMood, currentMood, loadSettings, saveSettings } from '../lib/game';
  import TvSetup from './tv/TvSetup.svelte';
  import TvGame from './tv/TvGame.svelte';
  import { connect } from '../lib/socket';
  import LivingRoom from '../lib/LivingRoom.svelte';
  import { potatoName } from '../lib/potatoes';
  import Logo from '../lib/Logo.svelte';
  import Ambient from '../lib/Ambient.svelte';
  import Stage from '../lib/Stage.svelte';

  let online = $state(false);
  // Remember the room for this tab so a reconnect lands in the same room.
  let code = $state(sessionStorage.getItem('cp:tv-room') ?? '');
  let players = $state<Player[]>([]);
  let seats = $state(8);
  let wiggle = $state<{ id: string; n: number } | null>(null);
  let qrSvg = $state('');
  let game = $state<GameView | null>(null);
  let offset = $state(0);
  let setup = $state(false);
  let settings = $state<GameSettings>(loadSettings());
  let notice = $state('');
  let mood = $state<Mood>(currentMood());

  const socket = connect();
  socket.on('connect', () => {
    online = true;
    socket.emit('hello', { screen: 'tv', code: code || undefined, mood });
  });
  socket.on('disconnect', () => (online = false));
  socket.on('room:joined', (p) => {
    code = p.code;
    sessionStorage.setItem('cp:tv-room', p.code);
  });
  socket.on('room:players', (p) => {
    players = p.players;
    seats = p.seats;
  });
  socket.on('tap:count', (p) => {
    if (p.lastById) wiggle = { id: p.lastById, n: (wiggle?.n ?? 0) + 1 };
  });
  socket.on('room:mood', (p) => {
    mood = p.mood;
    applyMood(p.mood);
  });
  function changeMood(m: Mood) {
    mood = m;
    applyMood(m);
    socket.emit('room:mood', { mood: m });
  }
  socket.on('game:state', (view) => {
    game = view;
    if (view) {
      offset = Date.now() - view.serverNow;
      setup = false;
    }
  });
  socket.on('game:error', (p) => {
    notice = p.reason === 'no-players' ? 'Nobody on the couch yet.' : 'No questions match these settings. Try another language or age.';
    setup = true;
  });
  onDestroy(() => socket.disconnect());

  function startGame() {
    saveSettings(settings);
    notice = '';
    socket.emit('game:start', $state.snapshot(settings));
  }
  const endGame = () => socket.emit('game:end');

  const host = location.host;
  const joinUrl = $derived(code ? `${location.origin}/?code=${code}` : '');

  // The one deliberate exception to "no hard-coded colours": a QR must stay dark-on-light in every
  // mood (including the light Sunday one) or some phone cameras won't read it.
  $effect(() => {
    if (!joinUrl) return;
    QRCode.toString(joinUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1c1916', light: '#00000000' } })
      .then((svg) => (qrSvg = svg))
      .catch(() => (qrSvg = ''));
  });
</script>

<Ambient />
<Stage>
{#if !game && !setup}<LivingRoom {players} {seats} {wiggle} />{/if}
<main>
  <header>
    <div class="brand"><Logo size={56} /><span>couch<br />potato</span></div>
    {#if !online}
      <div class="status" role="status">Reconnecting…</div>
    {:else if !game}
      <div class="chip">Trivia · {LANGUAGE_NAMES[settings.language]} · {settings.rounds} questions</div>
    {/if}
  </header>

  {#if game}
    <TvGame view={game} {offset} {players} onPlayAgain={startGame} onEnd={endGame} />
  {:else if setup}
    <TvSetup bind:settings players={players.length} {mood} onMood={changeMood} onStart={startGame} onBack={() => (setup = false)} />
    {#if notice}<p class="notice" role="alert">{notice}</p>{/if}
  {:else}
    <div class="lobby">
      <section class="join" aria-label="How to join">
        <span class="label">SCAN TO JOIN</span>
        <div class="qr" role="img" aria-label="QR code to join this room">
          {#if qrSvg}{@html qrSvg}{/if}
        </div>
        <span class="or">or go to <span class="mono">{host}</span></span>
        <div class="code" aria-label="Room code {code.split('').join(' ')}">{code || '····'}</div>
      </section>

      <ul class="sr" aria-label="On the sofa">
        {#each players as player (player.id)}
          <li>{player.name}, {potatoName(player.potato)}{player.away ? ', reconnecting' : ''}</li>
        {/each}
      </ul>

      <div class="foot">
        <div class="tally">
          <span class="count">{players.length} / {seats}</span>
          <span class="muted">{players.length ? 'Everyone in? Start when ready.' : 'Grab the snacks…'}</span>
        </div>
        <button class="start" disabled={players.length === 0} onclick={() => (setup = true)}>Start game</button>
      </div>
    </div>
  {/if}
</main>
</Stage>

<style>
  main {
    position: relative; z-index: 1;
    height: 100%; box-sizing: border-box; padding: 36px 56px 40px;
    display: flex; flex-direction: column; gap: 28px;
  }
  header { height: 56px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand span { font-family: var(--font-display); font-weight: 600; font-size: 24px; line-height: 24px; letter-spacing: -0.03em; }
  .status { font-size: 32px; font-weight: 600; color: var(--spud); }
  .chip {
    font-size: 32px; font-weight: 600; color: var(--ink-muted); padding: 6px 22px; border-radius: var(--radius-pill);
    background: var(--surface-1); box-shadow: var(--morph-inset);
  }
  .notice { margin: 0; font-size: 32px; font-weight: 600; color: var(--wrong); }
  .muted { color: var(--ink-muted); }
  .mono { font-family: var(--font-mono); font-weight: 500; color: var(--ink); }
  .label { font-size: 32px; font-weight: 700; letter-spacing: 0.08em; color: var(--ink-muted); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  .lobby { flex: 1; min-height: 0; position: relative; }

  .join {
    position: absolute; left: 0; top: 0; bottom: 0; width: 320px; box-sizing: border-box; padding: 22px 24px; border-radius: 32px;
    background: color-mix(in srgb, var(--surface-1) 92%, transparent); box-shadow: var(--morph-raised);
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  }
  .qr {
    width: 216px; height: 216px; padding: 14px; box-sizing: border-box; border-radius: var(--radius-md);
    background: #f2ede4; /* fixed light ground for the QR, see script */
    box-shadow: 0 0 60px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .qr :global(svg) { width: 100%; height: 100%; display: block; }
  .or { font-size: 32px; font-weight: 600; color: var(--ink-muted); text-align: center; overflow-wrap: anywhere; line-height: 1.15; }
  .code {
    font-family: var(--font-mono); font-weight: 700; font-size: 56px; line-height: 1; letter-spacing: 0.16em;
    color: var(--ink-on-spud); background: var(--spud); padding: 14px 22px 14px 32px;
    border-radius: var(--radius-pill); box-shadow: 0 0 50px var(--glow), 6px 8px 18px var(--edge-dark);
  }

  .foot {
    position: absolute; right: 0; bottom: 0; display: flex; align-items: center; gap: 24px;
    padding: 12px 12px 12px 28px; border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--surface-1) 88%, transparent); box-shadow: var(--morph-raised);
  }
  .tally { display: flex; flex-direction: column; font-size: 32px; font-weight: 600; line-height: 1.1; }
  .count { font-family: var(--font-mono); font-weight: 700; color: var(--spud); }
  .start {
    flex-shrink: 0; border: 0; cursor: pointer; font: 700 32px var(--font-sans); padding: 18px 40px; border-radius: var(--radius-pill);
    background: var(--spud); color: var(--ink-on-spud); box-shadow: 0 0 50px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .start:disabled { opacity: 0.45; cursor: default; box-shadow: none; }
</style>
