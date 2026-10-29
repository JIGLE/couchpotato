<script lang="ts">
  import { onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import type { GameSettings, GameView, Player } from '@couchpotato/shared';
  import type { Mood } from '@couchpotato/shared';
  import { LANGUAGE_NAMES, applyMood, currentMood } from '../lib/game';
  import TvGame from './tv/TvGame.svelte';
  import { connect } from '../lib/socket';
  import LivingRoom from '../lib/LivingRoom.svelte';
  import LivingRoom3D from '../lib/LivingRoom3D.svelte';
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
  /** What the Head Spud is choosing on their phone, shown as a preview chip. */
  let setup = $state<GameSettings | null>(null);
  let mood = $state<Mood>(currentMood());
  /** The 3D living room, until it reports it can't run here (no WebGL2); then the 2D sofa. */
  let room3d = $state(true);

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
  socket.on('game:state', (view) => {
    game = view;
    if (view) offset = Date.now() - view.serverNow;
  });
  socket.on('lobby:setup', (p) => (setup = p.settings));
  onDestroy(() => socket.disconnect());

  const headSpud = $derived(players.find((p) => p.role === 'head-spud'));

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
{#if !game && room3d}<LivingRoom3D {players} {mood} {wiggle} onfail={() => (room3d = false)} />{/if}
<Stage>
{#if !game && !room3d}<LivingRoom {players} {seats} {wiggle} />{/if}
<main>
  <header>
    {#if game}<div class="brand"><Logo size={56} /><span>couch<br />potato</span></div>{:else}<span></span>{/if}
    {#if !online}
      <div class="status" role="status">Reconnecting…</div>
    {:else if !game}
      <div class="chip" class:live={!!setup}>
        {#if setup}Trivia · {LANGUAGE_NAMES[setup.language]} · {setup.rounds} questions
        {:else if headSpud}{headSpud.name} is picking a game…
        {:else}Scan in, potatoes{/if}
      </div>
    {/if}
  </header>

  {#if game}
    <TvGame view={game} {offset} {players} />
  {:else}
    <div class="lobby">
      <!-- Low in the bottom-left corner, over the empty floor, so the sofa is never covered. -->
      <section class="join" class:full={players.length >= seats} aria-label="How to join">
        <div class="qr" role="img" aria-label="QR code to join this room">
          {#if qrSvg}{@html qrSvg}{/if}
        </div>
        <span class="or">Join at <span class="mono">{host}</span></span>
        <div class="code" aria-label="Room code {code.split('').join(' ')}">{code || '····'}</div>
        <span class="count" role="status">{players.length >= seats ? 'The sofa’s full!' : `${players.length}/${seats} on the sofa`}</span>
      </section>

      <ul class="sr" aria-label="On the sofa">
        {#each players as player (player.id)}
          <li>{player.name}, {potatoName(player.potato)}{player.role === 'head-spud' ? ', Head Spud' : ''}{player.away ? ', reconnecting' : ''}</li>
        {/each}
      </ul>

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
  .mono { font-family: var(--font-mono); font-weight: 500; color: var(--ink); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  .lobby { flex: 1; min-height: 0; position: relative; }

  .join {
    position: absolute; left: 8px; bottom: 24px; box-sizing: border-box; padding: 16px 28px 16px 16px; border-radius: 28px;
    background: color-mix(in srgb, var(--surface-1) 88%, transparent); box-shadow: var(--morph-raised);
    display: grid; grid-template-columns: auto auto; column-gap: 22px; row-gap: 6px; align-items: center; justify-items: start;
  }
  .join > .qr { grid-row: 1 / span 3; }
  .join > :not(.qr) { grid-column: 2; }
  /* Once the sofa is full there is nothing to scan: just the cheer. */
  .join.full .qr, .join.full .or { display: none; }
  .join.full > :not(.qr) { grid-column: 1; }
  .qr {
    width: 156px; height: 156px; padding: 10px; box-sizing: border-box; border-radius: var(--radius-md);
    background: #f2ede4; /* fixed light ground for the QR, see script */
    box-shadow: 0 0 60px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .qr :global(svg) { width: 100%; height: 100%; display: block; }
  .or { font-size: 32px; font-weight: 700; color: var(--ink-muted); white-space: nowrap; line-height: 1.15; }
  .code {
    font-family: var(--font-mono); font-weight: 700; font-size: 48px; line-height: 1; letter-spacing: 0.16em;
    color: var(--ink-on-spud); background: var(--spud); padding: 8px 16px 8px 24px;
    border-radius: var(--radius-pill); box-shadow: 0 0 50px var(--glow), 6px 8px 18px var(--edge-dark);
  }

  .count { font-size: 32px; font-weight: 700; color: var(--spud); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .chip.live { color: var(--ink); }
</style>
