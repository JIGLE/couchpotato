<script lang="ts">
  import { onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import type { GameSettings, GameView, Player } from '@couchpotato/shared';
  import type { Mood } from '@couchpotato/shared';
  import { LANGUAGE_NAMES, applyMood, currentMood, loadSettings, saveSettings } from '../lib/game';
  import TvSetup from './tv/TvSetup.svelte';
  import TvGame from './tv/TvGame.svelte';
  import { connect } from '../lib/socket';
  import { seatColour } from '../lib/seats';
  import Potato from '../lib/Potato.svelte';
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

  // Seat list: real players in their seats, the rest shown as pressed-in open cushions.
  const seatList = $derived(
    Array.from({ length: seats }, (_, seat) => players.find((p) => p.seat === seat) ?? null),
  );
</script>

<Ambient />
<Stage>
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

      <section class="couch">
        <div class="couch-head">
          <h2>On the couch</h2>
          <span class="count">{players.length} / {seats}</span>
        </div>
        <ul class="seats">
          {#each seatList as player, seat (player?.id ?? `empty-${seat}`)}
            <li>
              {#if player}
                {@const c = seatColour(player.colour)}
                {#key wiggle?.id === player.id ? wiggle?.n : 0}
                  <div
                    class="avatar"
                    class:wiggle={wiggle?.id === player.id}
                    class:away={player.away}
                    style:background={c.bg}
                  >
                    <Potato kind={player.potato} size={100} asleep={player.away} delay={seat * 0.37} />
                  </div>
                {/key}
                <span class="name" class:muted={player.away}>{player.name}</span>
                {#if player.away}<span class="sr">is reconnecting</span>{/if}
              {:else}
                <div class="avatar empty" aria-hidden="true">+</div>
                <span class="name muted">Open seat</span>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="couch-foot">
          <span class="muted">{players.length ? 'Everyone in? Start when ready.' : 'Grab the snacks…'}</span>
          <button class="start" disabled={players.length === 0} onclick={() => (setup = true)}>Start game</button>
        </div>
      </section>
    </div>
  {/if}
</main>
</Stage>

<style>
  main {
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

  .lobby { flex: 1; min-height: 0; display: flex; gap: 32px; }

  .join {
    width: 400px; flex-shrink: 0; box-sizing: border-box; padding: 24px 28px; border-radius: 32px;
    background: var(--surface-1); box-shadow: var(--morph-raised);
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  }
  .qr {
    width: 236px; height: 236px; padding: 16px; box-sizing: border-box; border-radius: var(--radius-md);
    background: #f2ede4; /* fixed light ground for the QR, see script */
    box-shadow: 0 0 60px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .qr :global(svg) { width: 100%; height: 100%; display: block; }
  .or { font-size: 32px; font-weight: 600; color: var(--ink-muted); text-align: center; overflow-wrap: anywhere; }
  .code {
    font-family: var(--font-mono); font-weight: 700; font-size: 64px; line-height: 1; letter-spacing: 0.18em;
    color: var(--ink-on-spud); background: var(--spud); padding: 16px 28px 16px 40px;
    border-radius: var(--radius-pill); box-shadow: 0 0 50px var(--glow), 6px 8px 18px var(--edge-dark);
  }

  .couch {
    flex: 1; min-width: 0; box-sizing: border-box; padding: 24px 32px; border-radius: 32px;
    background: var(--surface-1); box-shadow: var(--morph-raised);
    display: flex; flex-direction: column; gap: 20px;
  }
  .couch-head { display: flex; justify-content: space-between; align-items: baseline; }
  h2 { margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 32px; }
  .count { font-family: var(--font-mono); font-size: 32px; font-weight: 700; color: var(--spud); }
  .seats { flex: 1; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-content: center; gap: 20px 16px; }
  .seats li { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; }
  .avatar {
    width: 104px; height: 104px; border-radius: 50%; display: grid; place-items: center;
    box-shadow: 6px 8px 18px var(--edge-dark);
    animation: land 560ms var(--ease-out);
  }
  .avatar.empty { background: var(--surface-2); color: var(--ink-muted); box-shadow: var(--morph-inset); animation: none; }
  .avatar.wiggle { animation: wiggle 420ms var(--ease-out); }
  .avatar.away { opacity: 0.55; box-shadow: none; animation: none; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .name { font-size: 32px; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .couch-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; font-size: 32px; font-weight: 600; }
  .start {
    flex-shrink: 0; border: 0; cursor: pointer; font: 700 32px var(--font-sans); padding: 18px 40px; border-radius: var(--radius-pill);
    background: var(--spud); color: var(--ink-on-spud); box-shadow: 0 0 50px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .start:disabled { opacity: 0.45; cursor: default; box-shadow: none; }

  /* Drop in from above, squash on the cushion, settle. The full sofa physics comes with the living room. */
  @keyframes land {
    0% { transform: translateY(-120px) scale(0.9, 1.12); opacity: 0; }
    50% { transform: translateY(0) scale(1.14, 0.84); opacity: 1; }
    70% { transform: translateY(-8px) scale(0.96, 1.05); }
    85% { transform: translateY(0) scale(1.03, 0.97); }
  }
  @keyframes wiggle { 25% { transform: rotate(-8deg) scale(1.08); } 75% { transform: rotate(8deg) scale(1.08); } }
</style>
