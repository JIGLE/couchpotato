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
  import { POTATO_LOOKS, potatoName } from '../lib/potatoes';
  import { seatColour } from '../lib/seats';
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
  /** The 3D living room, until it reports it can't run here (no WebGL2); then the 2D sofa. */
  let room3d = $state(true);

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
<!-- Lights off until a host claims the TV; they come up as the room opens. -->
{#if !game && room3d}<LivingRoom3D {players} {mood} {wiggle} dim={!!pairing || !code} onfail={() => (room3d = false)} />{/if}
<Stage>
{#if !game && !room3d}
  <div class="lights" class:off={!!pairing || !code}><LivingRoom {players} {seats} {wiggle} /></div>
{/if}
<main>
  <header>
    <!-- Left: brand (during game/claim) or lobby info card -->
    {#if game || pairing}
      <div class="brand"><Logo size={64} /><span>couch<br />potato</span></div>
    {:else}
      <div class="info-card">
        {#if setup}
          <svg class="info-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5S14.67 12 15.5 12s1.5.67 1.5 1.5S16.33 15 15.5 15zm3-3c-.83 0-1.5-.67-1.5-1.5S17.67 10 18.5 10s1.5.67 1.5 1.5S19.33 12 18.5 12z"/></svg>
          <div class="info-text">
            <span class="info-title">Trivia</span>
            <span class="info-sub">{LANGUAGE_NAMES[setup.language]} · {setup.rounds} questions</span>
          </div>
        {:else if headSpud}
          <div class="info-text"><span class="info-title">{headSpud.name} is picking a game…</span></div>
        {:else}
          <div class="brand-sm"><Logo size={48} /><span>couch<br />potato</span></div>
        {/if}
      </div>
    {/if}
    <!-- Right: status / player count -->
    {#if !online}
      <div class="status" role="status">Reconnecting…</div>
    {:else if pairing}
      <div class="chip">Waiting for a Head Spud…</div>
    {:else if claimedBy}
      <div class="chip live welcome">{claimedBy} is the Head Spud!</div>
    {:else if !game}
      <div class="player-pill">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        <span>{players.length} players</span>
      </div>
    {/if}
  </header>

  {#if pairing}
    <section class="claim" aria-label="Open a room">
      <div class="qr big" role="img" aria-label="QR code for the Head Spud to open this room">
        {#key pairing.code}<div class="fade">{#if claimSvg}{@html claimSvg}{/if}</div>{/key}
      </div>
      <div class="pitch">
        <h1>Who's Head Spud tonight?</h1>
        <p class="or">
          {#if pairing.hostsRequired}Sign in on your phone. No account? Ask for an invite.
          {:else}Whoever scans first runs the night.{/if}
        </p>
        <div class="alt">
          <div class="code small" aria-label="Claim code {pairing.code.split('').join(' ')}">{pairing.code}</div>
          <span class="hint">or visit <span class="mono">{host}/claim</span></span>
        </div>
        <div class="renew" aria-hidden="true"><span style:transform="scaleX({pairingLeft})"></span></div>
      </div>
    </section>
  {:else if game}
    <TvGame view={game} {offset} {players} />
  {:else}
    <div class="lobby">
      <ul class="sr" aria-label="On the sofa">
        {#each players as player (player.id)}
          <li>{player.name}, {potatoName(player.potato)}{player.role === 'head-spud' ? ', Head Spud' : ''}{player.away ? ', reconnecting' : ''}</li>
        {/each}
      </ul>

      <!-- Bottom-left: join card -->
      <section class="join" class:full={players.length >= seats} aria-label="How to join">
        <div class="join-label">
          <svg class="join-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>
          Scan to join
        </div>
        <div class="join-body">
          <div class="qr" role="img" aria-label="QR code to join this room">
            {#if qrSvg}{@html qrSvg}{/if}
          </div>
          <div class="code-block">
            <div class="code" aria-label="Room code {code.split('').join(' ')}">{code || '····'}</div>
            <span class="join-url"><span class="mono">{host}</span></span>
          </div>
        </div>
        {#if players.length >= seats}
          <span class="full-msg" role="status">The sofa's full! 🛋️</span>
        {/if}
      </section>

      <!-- Bottom-centre: avatar strip -->
      {#if players.length > 0}
        <div class="avatar-strip" aria-label="Players on the sofa">
          {#each players as player (player.id)}
            <div class="avatar" class:head={player.role === 'head-spud'} class:away={player.away}
                 style="--seat-c: {seatColour(player.colour).bg}" title="{player.name}">
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <path d="{POTATO_LOOKS[player.potato].body}" fill="{POTATO_LOOKS[player.potato].fill}" />
              </svg>
              {#if player.role === 'head-spud'}<span class="crown" aria-label="Head Spud">👑</span>{/if}
            </div>
          {/each}
        </div>
      {/if}

      <!-- Bottom-right: start zone (visible once a head spud is present) -->
      {#if headSpud}
        <div class="start-zone">
          <div class="start-count">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            <div class="start-count-text">
              <span class="start-n">{players.length} players</span>
              <span class="start-status">{players.every(p => !p.away) ? 'All ready!' : 'Waiting…'}</span>
            </div>
          </div>
          <div class="start-btn">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
            <div class="start-btn-text">
              <span class="start-label">Start game</span>
              <span class="start-hint">Head Spud only</span>
            </div>
          </div>
        </div>
      {/if}
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
  .brand span { font-family: var(--font-display); font-weight: 600; font-size: 32px; line-height: 30px; letter-spacing: -0.03em; }
  .status { font-size: 32px; font-weight: 600; color: var(--spud); }
  .chip {
    font-size: 32px; font-weight: 600; color: var(--ink-muted); padding: 6px 22px; border-radius: var(--radius-pill);
    background: var(--surface-1); box-shadow: var(--morph-inset);
  }
  .mono { font-family: var(--font-mono); font-weight: 500; color: var(--ink); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  .lobby { flex: 1; min-height: 0; position: relative; }

  /* ── Join card (bottom-left) ── */
  .join {
    position: absolute; left: 16px; bottom: 20px; border-radius: 24px;
    background: color-mix(in srgb, #000 76%, transparent);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box;
  }
  .join-label {
    display: flex; align-items: center; gap: 8px;
    font-size: 24px; font-weight: 600; color: var(--ink-muted);
  }
  .join-icon { width: 22px; height: 22px; flex-shrink: 0; }
  .join-body { display: flex; align-items: center; gap: 14px; }
  .join.full .join-body { display: none; }
  .qr {
    width: 120px; height: 120px; padding: 8px; box-sizing: border-box; border-radius: var(--radius-md);
    background: #f2ede4; flex-shrink: 0;
  }
  .qr :global(svg) { width: 100%; height: 100%; display: block; }
  .code-block { display: flex; flex-direction: column; gap: 8px; }
  .code {
    font-family: var(--font-mono); font-weight: 800; font-size: 44px; line-height: 1; letter-spacing: 0.14em;
    color: var(--ink-on-spud); background: var(--spud); padding: 8px 20px;
    border-radius: var(--radius-pill);
  }
  .join-url { font-size: 24px; font-weight: 600; color: var(--ink-muted); }
  .join-url .mono { font-family: var(--font-mono); font-weight: 500; }
  .full-msg { font-size: 32px; font-weight: 700; color: var(--spud); }

  /* ── Avatar strip (bottom-centre) ── */
  .avatar-strip {
    position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 6px; padding: 10px 16px;
    background: color-mix(in srgb, #000 72%, transparent);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border-radius: 48px;
  }
  .avatar {
    width: 64px; height: 64px; border-radius: 50%; position: relative;
    background: var(--seat-c, var(--surface-2));
    border: 3px solid color-mix(in srgb, #fff 18%, transparent);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    transition: opacity 0.3s ease;
  }
  .avatar.away { opacity: 0.45; }
  .avatar.head { border-color: var(--spud); border-width: 3px; }
  .avatar svg { width: 78%; height: 78%; display: block; }
  .crown {
    position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
    font-size: 18px; line-height: 1; pointer-events: none;
  }

  /* ── Start zone (bottom-right) ── */
  .start-zone {
    position: absolute; right: 16px; bottom: 20px; display: flex; gap: 10px; align-items: center;
    background: color-mix(in srgb, #000 76%, transparent);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border-radius: 24px; padding: 14px 18px;
  }
  .start-count {
    display: flex; align-items: center; gap: 10px; color: var(--ink-muted);
  }
  .start-count > svg { width: 32px; height: 32px; flex-shrink: 0; }
  .start-count-text { display: flex; flex-direction: column; }
  .start-n { font-size: 28px; font-weight: 700; color: var(--ink); }
  .start-status { font-size: 22px; font-weight: 600; color: var(--spud); }
  .start-btn {
    display: flex; align-items: center; gap: 10px;
    background: var(--spud); color: var(--ink-on-spud);
    padding: 12px 20px; border-radius: var(--radius-pill);
  }
  .start-btn > svg { width: 28px; height: 28px; flex-shrink: 0; }
  .start-btn-text { display: flex; flex-direction: column; }
  .start-label { font-size: 28px; font-weight: 800; line-height: 1.1; }
  .start-hint { font-size: 20px; font-weight: 600; opacity: 0.7; }

  /* ── Info card (top-left, lobby) ── */
  .info-card {
    display: flex; align-items: center; gap: 14px;
    background: color-mix(in srgb, #000 72%, transparent);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    padding: 10px 20px 10px 14px; border-radius: var(--radius-pill);
  }
  .info-icon { width: 40px; height: 40px; flex-shrink: 0; color: var(--spud); }
  .info-text { display: flex; flex-direction: column; }
  .info-title { font-size: 32px; font-weight: 800; color: var(--ink); line-height: 1.1; }
  .info-sub { font-size: 24px; font-weight: 600; color: var(--ink-muted); }
  .brand-sm { display: flex; align-items: center; gap: 10px; }
  .brand-sm span { font-family: var(--font-display); font-weight: 600; font-size: 28px; line-height: 28px; letter-spacing: -0.03em; color: var(--ink); }

  /* ── Player count pill (top-right, lobby) ── */
  .player-pill {
    display: flex; align-items: center; gap: 10px;
    background: color-mix(in srgb, #000 72%, transparent);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    padding: 10px 20px; border-radius: var(--radius-pill);
    font-size: 32px; font-weight: 700; color: var(--ink);
  }
  .player-pill > svg { width: 32px; height: 32px; flex-shrink: 0; color: var(--ink-muted); }

  .or { font-size: 32px; font-weight: 700; color: var(--ink-muted); line-height: 1.15; overflow-wrap: anywhere; }

  /* Before a host claims the TV the room sits in the dark; the lights come up when it opens. */
  .lights { position: absolute; inset: 0; transition: filter 1400ms var(--ease-out), opacity 1400ms var(--ease-out); }
  .lights.off { filter: brightness(0.32) saturate(0.6) blur(2px); opacity: 0.85; }

  /* Sized to its content and centred in the space under the header, so the dimmed room shows around it. */
  .claim {
    margin: auto 0; align-self: center; display: flex; align-items: center; gap: 28px;
    padding: 20px 32px 20px 20px; border-radius: 28px; box-sizing: border-box; max-width: 720px;
    background: color-mix(in srgb, var(--surface-1) 90%, transparent); box-shadow: var(--morph-raised);
    animation: pop 600ms var(--ease-out);
  }
  .qr.big { width: 196px; height: 196px; padding: 12px; flex-shrink: 0; animation: qr-pulse 2.8s ease-in-out infinite; }
  .fade { width: 100%; height: 100%; animation: fade 500ms var(--ease-out); }
  .fade :global(svg) { width: 100%; height: 100%; display: block; }
  .pitch { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; min-width: 0; }
  /* One scale for the card: a 48px title, the 40px code, and 32px (the TV minimum) for everything else. */
  .pitch h1 { margin: 0; font: 600 40px/1.08 var(--font-display); letter-spacing: -0.02em; text-wrap: balance; }
  .pitch .or { margin: 0; text-align: left; font-weight: 600; }
  .alt { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; min-width: 0; }
  .code.small { font-size: 40px; padding: 8px 16px 8px 24px; }
  .renew { width: 100%; height: 6px; border-radius: var(--radius-pill); background: var(--surface-2); overflow: hidden; }
  .renew span { display: block; height: 100%; background: var(--spud); transform-origin: left; transition: transform 250ms linear; }
  .hint { font-size: 24px; font-weight: 600; color: var(--ink-muted); opacity: 0.7; }
  .hint .mono { font-family: var(--font-mono); font-weight: 500; color: var(--ink-muted); }
  .welcome { animation: pop 600ms var(--ease-out); }
  @keyframes qr-pulse {
    0%, 100% { box-shadow: 0 0 60px var(--glow), 6px 8px 18px var(--edge-dark); }
    50% { box-shadow: 0 0 100px var(--glow), 6px 8px 18px var(--edge-dark), 0 0 36px color-mix(in srgb, var(--spud) 40%, transparent); }
  }
  @keyframes pop {
    0% { transform: scale(0.9); opacity: 0; }
    60% { transform: scale(1.03); opacity: 1; }
  }
  @keyframes fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .claim, .welcome, .fade, .qr.big { animation: none; }
    .lights { transition: none; }
  }
  .chip.live { color: var(--ink); }
</style>
