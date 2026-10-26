<script lang="ts">
  import { onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import type { Player } from '@couchpotato/shared';
  import { connect } from '../lib/socket';
  import { seatColour, initial } from '../lib/seats';
  import Logo from '../lib/Logo.svelte';
  import Ambient from '../lib/Ambient.svelte';

  let online = $state(false);
  // Remember the room for this tab so a reconnect lands in the same room.
  let code = $state(sessionStorage.getItem('cp:tv-room') ?? '');
  let players = $state<Player[]>([]);
  let seats = $state(8);
  let wiggle = $state<{ id: string; n: number } | null>(null);
  let qrSvg = $state('');

  const socket = connect();
  socket.on('connect', () => {
    online = true;
    socket.emit('hello', { screen: 'tv', code: code || undefined });
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
  onDestroy(() => socket.disconnect());

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

  // Seat list: real players in their seats, the rest shown as pressed-in open cushions.
  const seatList = $derived(
    Array.from({ length: seats }, (_, seat) => players.find((p) => p.seat === seat) ?? null),
  );
</script>

<Ambient />
<main>
  <header>
    <div class="brand"><Logo size={64} /><span>couch<br />potato</span></div>
    {#if !online}<div class="status">Reconnecting…</div>{/if}
  </header>

  <div class="body">
    <section class="join">
      <h1>Grab the snacks.<br />Join on your phone.</h1>
      <div class="qr-row">
        <div class="qr" role="img" aria-label="QR code to join this room">
          {#if qrSvg}{@html qrSvg}{/if}
        </div>
        <div class="how">
          <span class="muted">or go to</span>
          <span class="mono">{host}</span>
          <span class="muted">room code</span>
        </div>
      </div>
      <div class="code" aria-label="Room code {code.split('').join(' ')}">{code || '····'}</div>
    </section>

    <section class="couch">
      <div class="couch-head">
        <h2>On the couch</h2>
        <span class="count">{players.length} / {seats}</span>
      </div>
      <ul class="seats">
        {#each seatList as player, seat (player?.id ?? `empty-${seat}`)}
          <li>
            {#if player}
              {@const c = seatColour(seat)}
              {#key wiggle?.id === player.id ? wiggle?.n : 0}
                <div class="avatar" class:wiggle={wiggle?.id === player.id} style:background={c.bg} style:color={c.fg}>
                  {initial(player.name)}
                </div>
              {/key}
              <span class="name">{player.name}</span>
            {:else}
              <div class="avatar empty" aria-hidden="true">+</div>
              <span class="name muted">Open seat</span>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="couch-foot">
        <span class="muted">{players.length ? 'Tap your phone to wave' : 'Waiting for players…'}</span>
        <button class="start" disabled={players.length === 0} title="Games arrive in Phase 2">Start game</button>
      </div>
    </section>
  </div>
</main>

<style>
  main {
    position: relative; z-index: 1; min-height: 100vh; padding: 48px var(--space-4);
    display: flex; flex-direction: column; gap: 36px;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand span { font-family: var(--font-display); font-weight: 600; font-size: 26px; line-height: 26px; letter-spacing: -0.03em; }
  .status { font-size: 32px; font-weight: 600; color: var(--spud); }
  .muted { color: var(--ink-muted); }
  .mono { font-family: var(--font-mono); font-size: 32px; font-weight: 500; }

  .body { flex: 1; display: flex; gap: 48px; }
  .join { width: 34%; min-width: 420px; display: flex; flex-direction: column; gap: 28px; }
  h1 { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 44px; line-height: 52px; letter-spacing: -0.02em; }
  .qr-row { display: flex; gap: 24px; align-items: center; }
  .qr {
    width: 180px; height: 180px; padding: 18px; flex-shrink: 0; border-radius: var(--radius-md);
    background: #f2ede4; /* fixed light ground for the QR, see script */ box-shadow: var(--morph-raised);
  }
  .qr :global(svg) { width: 100%; height: 100%; display: block; }
  .how { display: flex; flex-direction: column; gap: 10px; font-size: 32px; font-weight: 600; }
  .code {
    align-self: flex-start; font-family: var(--font-mono); font-weight: 700; font-size: 72px; line-height: 1;
    letter-spacing: 0.18em; color: var(--ink-on-spud); background: var(--spud); padding: 22px 36px;
    border-radius: var(--radius-pill); box-shadow: 0 0 50px var(--glow), 6px 8px 18px var(--edge-dark);
  }

  .couch {
    flex: 1; background: var(--surface-1); border-radius: 32px; padding: 36px; box-shadow: var(--morph-raised);
    display: flex; flex-direction: column; gap: 28px;
  }
  .couch-head { display: flex; justify-content: space-between; align-items: baseline; }
  h2 { margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 32px; }
  .count { font-family: var(--font-mono); font-size: 32px; font-weight: 700; color: var(--spud); }
  .seats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; }
  .seats li { display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 0; }
  .avatar {
    width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center;
    font-family: var(--font-display); font-size: 36px; font-weight: 700; box-shadow: 6px 8px 18px var(--edge-dark);
    animation: pop 320ms var(--ease-out);
  }
  .avatar.empty { background: var(--surface-2); color: var(--ink-muted); box-shadow: var(--morph-inset); animation: none; }
  .avatar.wiggle { animation: wiggle 420ms var(--ease-out); }
  .name { font-size: 32px; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .couch-foot { margin-top: auto; display: flex; justify-content: space-between; align-items: center; font-size: 32px; font-weight: 600; }
  .start {
    border: 0; cursor: pointer; font: 700 32px var(--font-sans); padding: 24px 48px; border-radius: var(--radius-pill);
    background: var(--spud); color: var(--ink-on-spud); box-shadow: 0 0 50px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .start:disabled { opacity: 0.45; cursor: default; box-shadow: none; }

  @keyframes pop { from { transform: scale(0.6); } 60% { transform: scale(1.06); } }
  @keyframes wiggle { 25% { transform: rotate(-8deg) scale(1.08); } 75% { transform: rotate(8deg) scale(1.08); } }
</style>
