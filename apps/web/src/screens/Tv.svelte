<script lang="ts">
  import { onDestroy } from 'svelte';
  import { connect } from '../lib/socket';
  import Logo from '../lib/Logo.svelte';
  import Ambient from '../lib/Ambient.svelte';

  let count = $state(0);
  let lastBy = $state<string | null>(null);
  let phones = $state(0);
  let online = $state(false);
  let bump = $state(0);
  // Remember the room for this tab so a reconnect lands in the same room.
  let code = $state(sessionStorage.getItem('cp:tv-room') ?? '');

  const socket = connect();
  socket.on('connect', () => {
    online = true;
    socket.emit('hello', { screen: 'tv', code: code || undefined });
  });
  socket.on('room:joined', (p) => {
    code = p.code;
    sessionStorage.setItem('cp:tv-room', p.code);
  });
  socket.on('disconnect', () => (online = false));
  socket.on('presence', (p) => (phones = p.phones));
  socket.on('tap:count', (p) => {
    count = p.count;
    lastBy = p.lastBy;
    bump++;
  });
  onDestroy(() => socket.disconnect());

  const host = location.host;
</script>

<Ambient />
<main>
  <header>
    <div class="brand"><Logo size={64} /><span>couch<br />potato</span></div>
    <div class="status" class:offline={!online}>{online ? `${phones} phone${phones === 1 ? '' : 's'} connected` : 'Reconnecting…'}</div>
  </header>

  <section>
    <p class="eyebrow">Phase 0 · tunnel smoke test</p>
    {#key bump}
      <div class="count">{count}</div>
    {/key}
    <p class="who">{lastBy ? `Last tap by ${lastBy}` : 'Tap the button on your phone'}</p>
  </section>

  <footer>
    <span>Go to <span class="mono">{host}</span> and enter</span>
    <span class="code" aria-label="Room code {code.split('').join(' ')}">{code || '····'}</span>
  </footer>
</main>

<style>
  main {
    position: relative; z-index: 1; min-height: 100vh; padding: var(--space-4);
    display: flex; flex-direction: column; gap: var(--space-3);
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand span { font-family: var(--font-display); font-weight: 600; font-size: 26px; line-height: 26px; letter-spacing: -0.03em; }
  .status { font-size: 32px; font-weight: 600; color: var(--ink-muted); }
  .status.offline { color: var(--spud); }
  section { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .eyebrow { margin: 0; font-family: var(--font-mono); font-size: 32px; color: var(--ink-muted); letter-spacing: 0.08em; text-transform: uppercase; }
  .count {
    font-family: var(--font-display); font-weight: 700; font-size: 220px; line-height: 1; color: var(--spud);
    animation: pop 320ms var(--ease-out);
  }
  .who { margin: 0; font-size: 32px; font-weight: 600; }
  footer { display: flex; align-items: center; justify-content: center; gap: 24px; font-size: 32px; color: var(--ink-muted); font-weight: 600; }
  .code {
    font-family: var(--font-mono); font-weight: 700; font-size: 72px; line-height: 1; letter-spacing: 0.18em;
    color: var(--ink-on-spud); background: var(--spud); padding: 18px 32px; border-radius: var(--radius-pill);
    box-shadow: 0 0 50px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .mono { font-family: var(--font-mono); color: var(--ink); }
  @keyframes pop { from { transform: scale(0.9); } 60% { transform: scale(1.06); } }
</style>
