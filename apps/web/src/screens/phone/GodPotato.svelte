<!-- The God Potato's tools, on their phone: make one-use Head Spud invites, see who hosts, revoke a host.
     Only the server's one God Potato gets here; the server checks the role on every request. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { AdminInvite, AdminView } from '@couchpotato/shared';

  let { onBack }: { onBack: () => void } = $props();

  let view = $state<AdminView | null>(null);
  let fresh = $state<AdminInvite | null>(null);
  let days = $state(7);
  let error = $state('');
  let working = $state(false);
  let copied = $state(false);
  let confirming = $state('');

  const until = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const link = (code: string) => `${location.origin}/claim?invite=${code}`;

  async function call<T>(path: string, body?: unknown): Promise<T | undefined> {
    error = '';
    try {
      const res = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 403) {
        error = 'Only the God Potato can do that. Sign in again?';
        return undefined;
      }
      if (!res.ok) {
        error = "That didn't work. Try again.";
        return undefined;
      }
      return (await res.json()) as T;
    } catch {
      error = "Couldn't reach the server. Check the Wi-Fi and try again.";
      return undefined;
    }
  }

  async function load() {
    view = (await call<AdminView>('/api/admin')) ?? view;
  }
  onMount(load);

  async function makeInvite() {
    working = true;
    copied = false;
    const invite = await call<AdminInvite>('/api/admin/invite', { days });
    if (invite) {
      fresh = invite;
      await load();
    }
    working = false;
  }

  async function share(code: string) {
    const text = `Your Couch Potato Head Spud invite: ${code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Couch Potato invite', text, url: link(code) });
      else {
        await navigator.clipboard.writeText(`${text}\n${link(code)}`);
        copied = true;
      }
    } catch {
      // Cancelled the share sheet; nothing to do.
    }
  }

  async function revoke(name: string) {
    if (confirming !== name) {
      confirming = name;
      return;
    }
    confirming = '';
    view = (await call<AdminView>('/api/admin/revoke', { name })) ?? view;
  }
</script>

<section>
  <span class="crown">GOD POTATO</span>
  <h1>Run the couch.</h1>
  <p class="hint">Invites work once. Send one to a friend and they become a Head Spud who can open rooms on any TV.</p>

  <label for="days">INVITE VALID FOR</label>
  <div class="days" id="days" role="radiogroup">
    {#each [1, 7, 30] as d (d)}
      <button class="chip" class:on={days === d} role="radio" aria-checked={days === d} onclick={() => (days = d)}>
        {d === 1 ? '1 day' : `${d} days`}
      </button>
    {/each}
  </div>
  <button class="primary" onclick={makeInvite} disabled={working}>{working ? 'Making…' : 'Make a Head Spud invite'}</button>

  {#if fresh}
    <div class="fresh" aria-live="polite">
      <span class="code">{fresh.code}</span>
      <span class="small">Works once, until {until(fresh.expiresAt)}</span>
      <button class="ghost" onclick={() => share(fresh!.code)}>{copied ? 'Copied' : 'Share invite'}</button>
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if view}
    <h2>Unused invites</h2>
    {#if view.invites.length}
      <ul>
        {#each view.invites as i (i.code)}
          <li><span class="mono">{i.code}</span><span class="small">until {until(i.expiresAt)}</span></li>
        {/each}
      </ul>
    {:else}
      <p class="small">None right now.</p>
    {/if}

    <h2>Hosts</h2>
    <ul>
      {#each view.hosts as h (h.name)}
        <li class:revoked={h.revoked}>
          <span>{h.name}{h.role === 'god' ? ' · God Potato' : ''}{h.revoked ? ' · revoked' : ''}</span>
          {#if !h.revoked && h.role !== 'god'}
            <button class="revoke" onclick={() => revoke(h.name)}>{confirming === h.name ? 'Sure? Revoke' : 'Revoke'}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <button class="link" onclick={onBack}>Back to opening a room</button>
</section>

<style>
  section { display: flex; flex-direction: column; gap: 10px; flex: 1; }
  h1 { font-family: var(--font-display); font-weight: 600; font-size: 28px; margin: 4px 0 0; }
  h2 { font: 700 13px var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-muted); margin: 16px 0 0; }
  .hint { margin: 0 0 12px; font-weight: 600; color: var(--ink-muted); }
  label { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-muted); }
  .small { font-size: 14px; font-weight: 600; color: var(--ink-muted); }
  .mono { font-family: var(--font-mono); letter-spacing: 0.06em; }
  .error { margin: 0; font-size: 15px; font-weight: 600; color: var(--wrong); }
  .crown {
    align-self: flex-start; padding: 6px 14px; border-radius: var(--radius-pill); background: var(--spud); color: var(--ink-on-spud);
    font: 700 13px var(--font-display); letter-spacing: 0.08em; box-shadow: 0 0 24px var(--glow);
  }
  .days { display: flex; gap: 8px; }
  .fresh {
    display: flex; flex-direction: column; gap: 8px; align-items: center; padding: 20px; border-radius: var(--radius-md);
    background: var(--surface-1); box-shadow: var(--morph-inset);
  }
  .fresh .code { font: 700 26px var(--font-mono); letter-spacing: 0.08em; color: var(--spud); }
  .fresh .ghost { align-self: stretch; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 0 8px 0 16px;
    border-radius: var(--radius-md); background: var(--surface-1); font-weight: 600;
  }
  li.revoked { opacity: 0.5; }
  button { border: 0; cursor: pointer; font: 700 18px var(--font-sans); transition: transform var(--dur-press), box-shadow var(--dur-press); }
  button:active { transform: scale(0.96); box-shadow: var(--morph-inset); }
  button:disabled { opacity: 0.5; cursor: default; }
  .primary {
    min-height: 60px; border-radius: var(--radius-pill); background: var(--spud); color: var(--ink-on-spud);
    box-shadow: 0 0 40px var(--glow), 6px 8px 18px var(--edge-dark);
  }
  .ghost, .chip { min-height: 56px; border-radius: var(--radius-pill); background: var(--surface-2); color: var(--ink); box-shadow: var(--morph-raised); }
  .chip { flex: 1; font-size: 16px; }
  .chip.on { background: var(--spud); color: var(--ink-on-spud); }
  .revoke { min-height: 56px; padding: 0 16px; border-radius: var(--radius-pill); background: transparent; color: var(--wrong); font-size: 15px; }
  .link { margin-top: auto; min-height: 56px; border-radius: var(--radius-pill); background: transparent; color: var(--ink-muted); font-size: 15px; }
</style>
