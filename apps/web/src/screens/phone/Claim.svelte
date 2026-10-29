<!-- Opening a room: the phone that scanned the TV's claim QR signs in as a host (or signs up with an invite),
     then claims the TV and sits down as the Head Spud. Guests who scanned it by mistake get pointed to the join form. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { HostAuthError, HostStatus, PotatoKind } from '@couchpotato/shared';
  import PotatoPicker from '../../lib/PotatoPicker.svelte';
  import GodPotato from './GodPotato.svelte';

  let {
    pairing = $bindable(),
    name = $bindable(),
    potato = $bindable(),
    error = '',
    busy = false,
    onClaim,
    onJoinInstead,
  }: {
    pairing: string;
    name: string;
    potato: PotatoKind;
    /** What went wrong with the last claim, from the server. */
    error?: string;
    busy?: boolean;
    onClaim: () => void;
    onJoinInstead: () => void;
  } = $props();

  let status = $state<HostStatus | null>(null);
  let offline = $state(false);
  // An invite link (/claim?invite=SPUD-…) opens straight on the sign-up form with the code filled in.
  const linkedInvite = new URLSearchParams(location.search).get('invite') ?? '';
  let mode = $state<'sign-in' | 'invite'>(linkedInvite ? 'invite' : 'sign-in');
  let hostName = $state(localStorage.getItem('cp:host-name') ?? '');
  let password = $state('');
  let invite = $state(linkedInvite);
  let tools = $state(false);
  let remember = $state(true);
  let authError = $state('');
  let working = $state(false);

  const AUTH_ERRORS: Record<HostAuthError, string> = {
    wrong: "That name and password don't match.",
    'slow-down': 'Too many tries. Have a snack and try again in a few minutes.',
    'bad-invite': "That invite code doesn't work. It may be used or out of date.",
    'name-taken': 'Another host already has that name.',
    'bad-name': 'Pick a host name.',
    'weak-password': 'Use at least 8 characters for the password.',
    unavailable: "Sign-in isn't working on the server right now.",
  };

  export async function refresh() {
    try {
      const res = await fetch('/api/host', { credentials: 'same-origin' });
      status = (await res.json()) as HostStatus;
      offline = false;
      if (status.host && !name) name = status.host.name;
    } catch {
      offline = true;
    }
  }
  onMount(refresh);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    authError = '';
    working = true;
    const body = mode === 'invite' ? { invite, name: hostName, password, remember } : { name: hostName, password, remember };
    try {
      const res = await fetch(mode === 'invite' ? '/api/host/signup' : '/api/host/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as HostStatus | { error: HostAuthError };
      if ('error' in data) {
        authError = AUTH_ERRORS[data.error] ?? AUTH_ERRORS.unavailable;
      } else {
        status = data;
        password = '';
        localStorage.setItem('cp:host-name', hostName.trim());
        if (data.host && !name) name = data.host.name;
      }
    } catch {
      authError = "Couldn't reach the server. Check the Wi-Fi and try again.";
    } finally {
      working = false;
    }
  }

  async function signOut() {
    await fetch('/api/host/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    await refresh();
  }

  function claim(e: SubmitEvent) {
    e.preventDefault();
    pairing = pairing.trim().toUpperCase();
    onClaim();
  }

  const canHost = $derived(!!status && (!status.required || !!status.host));
</script>

{#if !status}
  <div class="center" role="status">
    <h1>{offline ? "Can't reach the couch." : 'One sec…'}</h1>
    {#if offline}<button class="ghost" onclick={refresh}>Try again</button>{/if}
  </div>
{:else if !canHost}
  <form onsubmit={submit}>
    <span class="crown">HEAD SPUDS ONLY</span>
    <h1>{mode === 'invite' ? 'Become a Head Spud.' : 'Open a room.'}</h1>
    <p class="hint">
      {#if mode === 'invite'}Use the invite code you were given. You'll sign in with this name and password next time.
      {:else}This code turns the TV into a room. Sign in with your host account, or ask whoever runs this couch for an invite.{/if}
    </p>
    {#if mode === 'invite'}
      <label for="invite">INVITE CODE</label>
      <input id="invite" class="mono" bind:value={invite} autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="SPUD-XXXX-XXXX" required />
    {/if}
    <label for="host-name">HOST NAME</label>
    <input id="host-name" bind:value={hostName} maxlength="20" autocomplete="username" required />
    <label for="password">PASSWORD</label>
    <input
      id="password"
      type="password"
      bind:value={password}
      minlength={mode === 'invite' ? 8 : undefined}
      autocomplete={mode === 'invite' ? 'new-password' : 'current-password'}
      required
    />
    <label class="check"><input type="checkbox" bind:checked={remember} /> Remember this phone for 30 days</label>
    {#if authError}<p class="error" role="alert">{authError}</p>{/if}
    <button class="primary" type="submit" disabled={working}>{mode === 'invite' ? 'Create host account' : 'Sign in'}</button>
    <button class="ghost" type="button" onclick={() => ((mode = mode === 'invite' ? 'sign-in' : 'invite'), (authError = ''))}>
      {mode === 'invite' ? 'I already have an account' : 'I have an invite'}
    </button>
    <button class="link" type="button" onclick={onJoinInstead}>Just playing? Join with the room code</button>
  </form>
{:else if tools && status.host?.role === 'god'}
  <GodPotato onBack={() => (tools = false)} />
{:else}
  <form onsubmit={claim}>
    <span class="crown">{status.host?.role === 'god' ? 'GOD POTATO' : 'HEAD SPUD'}</span>
    <h1>{status.host ? `Ready to host, ${status.host.name}?` : 'Ready to host?'}</h1>
    <p class="hint">Opening the room puts you on the sofa with the remote: you pick the game and press Start.</p>
    <label for="pairing">CODE ON THE TV</label>
    <input
      id="pairing"
      class="code"
      bind:value={pairing}
      maxlength="6"
      autocapitalize="characters"
      autocomplete="off"
      spellcheck="false"
      placeholder="ABC123"
      aria-describedby="claim-error"
      required
    />
    {#if error}<p id="claim-error" class="error" role="alert">{error}</p>{/if}
    <label for="seat-name">YOUR NAME ON THE SOFA</label>
    <input id="seat-name" bind:value={name} maxlength="20" autocomplete="nickname" placeholder="Nickname" />
    <PotatoPicker value={potato} onPick={(k) => (potato = k)} />
    <button class="primary" type="submit" disabled={busy || pairing.trim().length < 6}>{busy ? 'Opening…' : 'Open the room'}</button>
    {#if status.host?.role === 'god'}<button class="ghost" type="button" onclick={() => (tools = true)}>Invites and hosts</button>{/if}
    {#if status.host}<button class="link" type="button" onclick={signOut}>Not {status.host.name}? Sign out</button>{/if}
  </form>
{/if}

<style>
  form { display: flex; flex-direction: column; gap: 10px; flex: 1; }
  .center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; }
  h1 { font-family: var(--font-display); font-weight: 600; font-size: 28px; margin: 4px 0 0; }
  .hint { margin: 0 0 12px; font-weight: 600; color: var(--ink-muted); }
  label { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-muted); }
  input {
    appearance: none; border: 0; height: 56px; padding: 0 20px; border-radius: 16px;
    background: var(--surface-1); color: var(--ink); font: 600 18px var(--font-sans); box-shadow: var(--morph-inset);
  }
  input.code { font: 700 28px var(--font-mono); letter-spacing: 0.2em; color: var(--spud); text-transform: uppercase; height: 64px; }
  input.mono { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; }
  .check { display: flex; align-items: center; gap: 12px; min-height: 56px; font-size: 15px; letter-spacing: 0; color: var(--ink); cursor: pointer; }
  .check input { width: 28px; height: 28px; padding: 0; border-radius: 8px; flex-shrink: 0; cursor: pointer; }
  .check input:checked { background: var(--spud); box-shadow: inset 0 0 0 6px var(--surface-1); }
  .error { margin: 0; font-size: 15px; font-weight: 600; color: var(--wrong); }
  .crown {
    align-self: flex-start; padding: 6px 14px; border-radius: var(--radius-pill); background: var(--spud); color: var(--ink-on-spud);
    font: 700 13px var(--font-display); letter-spacing: 0.08em; box-shadow: 0 0 24px var(--glow);
  }
  button { border: 0; cursor: pointer; font: 700 18px var(--font-sans); transition: transform var(--dur-press), box-shadow var(--dur-press); }
  button:active { transform: scale(0.96); box-shadow: var(--morph-inset); }
  button:disabled { opacity: 0.5; cursor: default; }
  .primary {
    margin-top: auto; min-height: 60px; border-radius: var(--radius-pill); background: var(--spud); color: var(--ink-on-spud);
    box-shadow: 0 0 40px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .ghost { min-height: 56px; border-radius: var(--radius-pill); background: var(--surface-1); color: var(--ink); box-shadow: var(--morph-raised); }
  .link { min-height: 56px; border-radius: var(--radius-pill); background: transparent; color: var(--ink-muted); font-size: 15px; }
</style>
