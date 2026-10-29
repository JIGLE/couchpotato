<!-- The waiting room in 3D: a cosy living room with an L-shaped chesterfield, drawn full-bleed behind the TV stage.
     three.js and the room are loaded on demand, so phones never download them. The room renders itself (see
     room3d/room.js); this wrapper feeds it the lobby, owns the name-tag layer, the "sat down" toast and the dip to
     dark when the mood changes. If WebGL2 is missing or the room fails to start, `onfail` asks for the 2D sofa. -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Mood, Player } from '@couchpotato/shared';
  import type { Room, RoomPlayer } from './room3d/room';
  import { seatColour } from './seats';

  let {
    players,
    mood,
    wiggle = null,
    dim = false,
    onfail,
  }: { players: Player[]; mood: Mood; wiggle?: { id: string; n: number } | null; dim?: boolean; onfail: () => void } = $props();

  let canvas: HTMLCanvasElement;
  let tags: HTMLDivElement;
  let room = $state<Room | null>(null);
  let ready = $state(false);
  let dark = $state(false);
  let toast = $state<{ name: string; colour: number; n: number } | null>(null);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function toRoom(list: Player[]): RoomPlayer[] {
    return list.map((p) => ({ id: p.id, name: p.name, seat: p.seat, colour: p.colour, kind: p.potato, head: p.role === 'head-spud', away: p.away }));
  }

  // One arrival at a time, so a burst of joins reads as a queue rather than a flicker.
  const landed: string[] = [];
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function nextToast() {
    const id = landed.shift();
    const p = id && players.find((q) => q.id === id);
    if (!p) {
      toast = null;
      if (landed.length) nextToast();
      return;
    }
    toast = { name: p.name, colour: p.colour, n: (toast?.n ?? 0) + 1 };
    toastTimer = setTimeout(() => {
      toast = null;
      toastTimer = setTimeout(nextToast, 350);
    }, landed.length ? 1100 : 2000);
  }
  function onLand(id: string) {
    // The Head Spud's crown already says who they are.
    if (players.find((p) => p.id === id)?.role === 'head-spud') return;
    landed.push(id);
    if (!toastTimer && !toast) nextToast();
  }

  onMount(() => {
    let cancelled = false;
    let made: Room | null = null;
    const probe = document.createElement('canvas').getContext('webgl2');
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    if (!probe || new URLSearchParams(location.search).get('room') === '2d') {
      onfail();
      return;
    }
    import('./room3d/room.js')
      .then(({ createRoom }) => {
        if (cancelled) return;
        made = createRoom(canvas, tags, { mood, onLand, onReady: () => (ready = true) });
        made.setPlayers(toRoom(players));
        room = made;
      })
      .catch((err) => {
        console.error('3D living room failed, using the 2D sofa', err);
        if (!cancelled) onfail();
      });
    return () => {
      cancelled = true;
      clearTimeout(toastTimer);
      made?.dispose();
    };
  });

  $effect(() => {
    const list = toRoom(players);
    room?.setPlayers(list);
  });

  // A mood change flicks the lights: dip to dark, re-light and re-bake, then fade back up.
  let shownMood: Mood | null = null;
  $effect(() => {
    const m = mood;
    if (!room) return;
    if (shownMood === null || reduced) {
      shownMood = m;
      room.setMood(m);
      return;
    }
    if (m === shownMood) return;
    shownMood = m;
    dark = true;
    const r = room;
    const t = setTimeout(() => {
      r.setMood(m);
      requestAnimationFrame(() => requestAnimationFrame(() => (dark = false)));
    }, 210);
    return () => clearTimeout(t);
  });

  // A wave from a phone makes that potato hop (only new waves, not the one that was current on mount).
  let hopped = untrack(() => wiggle?.n);
  $effect(() => {
    if (!wiggle || !room || wiggle.n === hopped) return;
    hopped = wiggle.n;
    room.hop(wiggle.id);
  });
</script>

<div class="room" class:ready class:dim aria-hidden="true">
  <canvas bind:this={canvas}></canvas>
  <div class="vignette"></div>
  <div class="tags" bind:this={tags}></div>
  <div class="blink" class:on={dark}></div>
</div>
{#if toast}
  {#key toast.n}
    <div class="toast" role="status" style:--c={seatColour(toast.colour).bg}><b>{toast.name}</b> sat down</div>
  {/key}
{/if}

<style>
  /* The room fills the viewport; overlays are sized in 1280×720 stage units, like the stage itself. */
  .room, .toast { --u: min(calc(100vw / 1280), calc(100vh / 720)); }
  .room { position: fixed; inset: 0; z-index: 0; opacity: 0; }
  .room.ready { opacity: 1; }
  /* Lights off until a host claims the TV (no blur: it would cost a full-screen pass every frame). */
  .room { transition: opacity 0.6s var(--ease-out), filter 1400ms var(--ease-out); }
  .room.dim { filter: brightness(0.32) saturate(0.6); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .vignette {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(120% 95% at 62% 50%, transparent 52%, color-mix(in srgb, var(--surface-0) 62%, transparent) 100%);
  }
  .blink { position: absolute; inset: 0; background: var(--surface-0); opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
  .blink.on { opacity: 1; }

  .tags { position: absolute; inset: 0; pointer-events: none; }
  /* Tags are made by the room; every player keeps a quiet name at rest (still 32px on the TV) that grows into a
     coloured pill when they arrive, hop or take the crown. A thin stem shows when a tag was lifted clear of another. */
  .tags :global(.tag) { position: absolute; left: 0; top: 0; will-change: transform; transition: opacity 0.4s ease; }
  .tags :global(.tag.away) { opacity: 0.55; }
  .tags :global(.tag > span) {
    display: block; position: relative; transform-origin: 0 0; transform: scale(1) translate(-50%, -100%); opacity: 0;
    font-family: var(--font-sans); font-size: calc(32 * var(--u)); font-weight: 700; line-height: 1.25; color: var(--ink);
    padding: calc(2 * var(--u)) calc(14 * var(--u)) calc(2 * var(--u)) calc(12 * var(--u));
    border-radius: var(--radius-pill); white-space: nowrap; border: calc(2 * var(--u)) solid var(--c, var(--spud));
    background: color-mix(in srgb, var(--surface-1) 86%, transparent);
    box-shadow: 0 calc(4 * var(--u)) calc(12 * var(--u)) var(--edge-dark);
    transition: opacity 0.25s ease, transform 0.35s cubic-bezier(0.2, 1.6, 0.4, 1), background-color 0.25s ease, color 0.25s ease;
  }
  .tags :global(.tag.in > span) { opacity: 1; }
  .tags :global(.tag.on > span) { transform: scale(1.18) translate(-50%, -100%); background: var(--c, var(--spud)); color: var(--ci, var(--ink-on-spud)); }
  .tags :global(.tag > i) {
    position: absolute; left: calc(-1 * var(--u)); top: 0; width: calc(2 * var(--u)); height: var(--lift, 0px);
    background: var(--c, var(--spud)); opacity: 0.7; transition: opacity 0.25s ease;
  }
  .tags :global(.tag:not(.in) > i) { opacity: 0; }
  :global(.stats) {
    position: fixed; right: 16px; top: calc(110 * min(calc(100vw / 1280), calc(100vh / 720))); margin: 0; z-index: 5;
    font: 600 13px/1.45 var(--font-mono); color: var(--ink); background: var(--surface-1); padding: 8px 12px;
    border-radius: var(--radius-sm); white-space: pre; pointer-events: none;
  }

  /* Under the header chip, lined up with the stage's right edge. */
  .toast {
    position: fixed; z-index: 2; pointer-events: none;
    top: calc(50vh - 360 * var(--u) + 108 * var(--u)); right: calc(50vw - 640 * var(--u) + 56 * var(--u));
    font-size: calc(32 * var(--u)); font-weight: 700; color: var(--ink);
    padding: calc(6 * var(--u)) calc(22 * var(--u)) calc(6 * var(--u)) calc(16 * var(--u)); border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--surface-1) 86%, transparent); border: calc(2 * var(--u)) solid var(--c);
    animation: toast-in 0.4s cubic-bezier(0.3, 1.6, 0.5, 1);
  }
  .toast b { color: var(--c); }
  @keyframes toast-in { from { opacity: 0; transform: translateY(calc(-12 * var(--u))); } }
  @media (prefers-reduced-motion: reduce) { .toast { animation: none; } .room { transition: none; } }
</style>
