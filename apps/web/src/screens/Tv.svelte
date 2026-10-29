<script lang="ts">
  import { onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import type { GameSettings, GameView, Player } from '@couchpotato/shared';
  import type { Mood } from '@couchpotato/shared';
  import { LANGUAGE_NAMES, applyMood, currentMood } from '../lib/game';
  import TvGame from './tv/TvGame.svelte';
  import { connect } from '../lib/socket';
  import LivingRoom from '../lib/LivingRoom.svelte';
  import { potatoName } from '../lib/potatoes';
  import Logo from '../lib/Logo.svelte';
  import Ambient from '../lib/Ambient.svelte';
  import Stage from '../lib/Stage.svelte';

  let online = $state(false);
  // Remember the room (and the TV's private token for it) so a refresh lands back in the same room.
  let code = $state(sessionStorage.getItem('cp:tv-room') ?? '');
  let tvToken = sessionStorage.getItem('cp:tv-token') ?? '';
  /** No room yet: the claim code a host scans to open one. */
  let pairing = $state<{ code: string; renewsAt: number; hostsRequired: boolean } | null>(null);
  let pairingOffset = 0;
  let claimSvg = $state('');
  /** Who just claimed the TV, for a few seconds of welcome. */
  let claimedBy = $state('');
  let claimedTimer: ReturnType<typeof setTimeout> | undefined;
  let players = $state<Player[]>([]);
  let seats = $state(8);
  let wiggle = $state<{ id: string; n: number } | null>(null);
  let qrSvg = $state('');
  let game = $state<GameView | null>(null);
  let offset = $state(0);
  /** What the Head Spud is choosing on their phone, shown as a preview chip. */
  let setup = $state<GameSettings | null>(null);
  let mood = $state<Mood>(currentMood());

  const socket = connect();
  socket.on('connect', () => {
    online = true;
    socket.emit('hello', { screen: 'tv', code: code || undefined, token: tvToken || undefined, mood });
  });
  socket.on('disconnect', () => (online = false));
  socket.on('tv:pairing', (p) => {
    pairing = { code: p.code, renewsAt: p.renewsAt, hostsRequired: p.hostsRequired };
    pairingOffset = Date.now() - p.serverNow;
    // Whatever room this tab had is gone.
    code = '';
    tvToken = '';
    players = [];
    game = null;
    setup = null;
    sessionStorage.removeItem('cp:tv-room');
    sessionStorage.removeItem('cp:tv-token');
  });
  socket.on('room:claimed', (p) => {
    claimedBy = p.by;
    clearTimeout(claimedTimer);
    claimedTimer = setTimeout(() => (claimedBy = ''), 6000);
  });
  socket.on('room:joined', (p) => {
    pairing = null;
    code = p.code;
    tvToken = p.token ?? tvToken;
    sessionStorage.setItem('cp:tv-room', p.code);
    sessionStorage.setItem('cp:tv-token', tvToken);
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
  onDestroy(() => {
    clearTimeout(claimedTimer);
    socket.disconnect();
  });

  // The claim code renews every minute; a thin bar shows how long this one has left.
  let now = $state(Date.now());
  const ticker = setInterval(() => (now = Date.now()), 250);
  onDestroy(() => clearInterval(ticker));
  const pairingLeft = $derived(pairing ? Math.max(0, Math.min(1, (pairing.renewsAt - (now - pairingOffset)) / 60_000)) : 0);

  const headSpud = $derived(players.find((p) => p.role === 'head-spud'));

  const host = location.host;
  const joinUrl = $derived(code ? `${location.origin}/?code=${code}` : '');
  const claimUrl = $derived(pairing ? `${location.origin}/claim?tv=${pairing.code}` : '');

  // The one deliberate exception to "no hard-coded colours": a QR must stay dark-on-light in every
  // mood (including the light Sunday one) or some phone cameras won't read it.
  const qr = (url: string) =>
    QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1c1916', light: '#00000000' } });
  $effect(() => {
    if (!joinUrl) return;
    qr(joinUrl).then((svg) => (qrSvg = svg)).catch(() => (qrSvg = ''));
  });
  $effect(() => {
    if (!claimUrl) return;
    qr(claimUrl).then((svg) => (claimSvg = svg)).catch(() => (claimSvg = ''));
  });
</script>

<Ambient />
<Stage>
{#if !game}
  <!-- Lights off until a host claims the TV; they come up as the room opens. -->
  <div class="lights" class:off={!!pairing || !code}><LivingRoom {players} {seats} {wiggle} /></div>
{/if}
<main>
  <header>
    {#if game}<div class="brand"><Logo size={56} /><span>couch<br />potato</span></div>{:else}<span></span>{/if}
    {#if !online}
      <div class="status" role="status">Reconnecting…</div>
    {:else if pairing}
      <div class="chip">Waiting for a Head Spud…</div>
    {:else if claimedBy}
      <div class="chip live welcome">{claimedBy} is the Head Spud!</div>
    {:else if !game}
      <div class="chip" class:live={!!setup}>
        {#if setup}Trivia · {LANGUAGE_NAMES[setup.language]} · {setup.rounds} questions
        {:else if headSpud}{headSpud.name} is picking a game…
        {:else}Scan in, potatoes{/if}
      </div>
    {/if}
  </header>

  {#if pairing}
    <section class="claim" aria-label="Open a room">
      <div class="qr big" role="img" aria-label="QR code for the Head Spud to open this room">
        {#key pairing.code}<div class="fade">{#if claimSvg}{@html claimSvg}{/if}</div>{/key}
      </div>
      <div class="pitch">
        <span class="label">READY TO HOST</span>
        <h1>Head Spud, scan to open the room.</h1>
        <p class="or">
          {#if pairing.hostsRequired}Hosts sign in on their phone. No account? Ask for an invite.
          {:else}Whoever scans first runs the night.{/if}
        </p>
        <p class="or">or go to <span class="mono">{host}/claim</span></p>
        <div class="code small" aria-label="Claim code {pairing.code.split('').join(' ')}">{pairing.code}</div>
        <div class="renew" aria-hidden="true"><span style:transform="scaleX({pairingLeft})"></span></div>
      </div>
    </section>
  {:else if game}
    <TvGame view={game} {offset} {players} />
  {:else}
    <div class="lobby">
      <section class="join" aria-label="How to join">
        <span class="label">SCAN TO JOIN</span>
        <div class="qr" role="img" aria-label="QR code to join this room">
          {#if qrSvg}{@html qrSvg}{/if}
        </div>
        <span class="or">or go to <span class="mono">{host}</span></span>
        <div class="code" aria-label="Room code {code.split('').join(' ')}">{code || '····'}</div>
        <span class="count" role="status">{players.length}/{seats} on the sofa</span>
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

  .count { font-size: 32px; font-weight: 700; color: var(--spud); }

  /* Before a host claims the TV the room sits in the dark; the lights come up when it opens. */
  .lights { position: absolute; inset: 0; transition: filter 1400ms var(--ease-out), opacity 1400ms var(--ease-out); }
  .lights.off { filter: brightness(0.32) saturate(0.6) blur(2px); opacity: 0.85; }

  .claim {
    flex: 1; min-height: 0; align-self: center; display: flex; align-items: center; gap: 56px;
    padding: 40px 56px; border-radius: 40px; box-sizing: border-box; max-width: 1080px;
    background: color-mix(in srgb, var(--surface-1) 90%, transparent); box-shadow: var(--morph-raised);
    animation: pop 600ms var(--ease-out);
  }
  .qr.big { width: 340px; height: 340px; padding: 20px; flex-shrink: 0; }
  .fade { width: 100%; height: 100%; animation: fade 500ms var(--ease-out); }
  .fade :global(svg) { width: 100%; height: 100%; display: block; }
  .pitch { display: flex; flex-direction: column; align-items: flex-start; gap: 18px; }
  .pitch h1 { margin: 0; font: 600 48px/1.1 var(--font-display); letter-spacing: -0.02em; }
  .pitch .or { margin: 0; text-align: left; }
  .code.small { font-size: 48px; padding: 12px 20px 12px 28px; }
  .renew { width: 100%; height: 8px; border-radius: var(--radius-pill); background: var(--surface-2); overflow: hidden; }
  .renew span { display: block; height: 100%; background: var(--spud); transform-origin: left; transition: transform 250ms linear; }
  .welcome { animation: pop 600ms var(--ease-out); }
  @keyframes pop {
    0% { transform: scale(0.9); opacity: 0; }
    60% { transform: scale(1.03); opacity: 1; }
  }
  @keyframes fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .claim, .welcome, .fade { animation: none; }
    .lights { transition: none; }
  }
  .chip.live { color: var(--ink); }
</style>
