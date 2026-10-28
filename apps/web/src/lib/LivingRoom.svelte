<!-- The waiting room: a living room seen from its corner, two sofas facing the players, and a potato per seat.
     Drawn on the TV's 1280×720 stage in 2:1 isometric. Everything is SVG, coloured from the mood tokens, so each mood
     relights the room. Physics comes later; for now potatoes drop in, squash and puff some dust. -->
<script lang="ts">
  import type { Player } from '@couchpotato/shared';
  import Potato from './Potato.svelte';
  import { seatColour } from './seats';

  let {
    players,
    seats = 8,
    wiggle = null,
  }: { players: Player[]; seats?: number; wiggle?: { id: string; n: number } | null } = $props();

  // Room corner on the floor, in stage pixels. u runs down-right along the right wall, v down-left along the left one.
  const OX = 800;
  const OY = 215;
  const P = (u: number, v: number, h = 0) => [OX + u - v, OY + (u + v) / 2 - h] as const;
  const pts = (...ps: (readonly [number, number])[]) => ps.map((p) => p.join(',')).join(' ');

  /** An axis-aligned block. Only three faces can face the camera: the top, the +u side and the +v side. */
  function box(u0: number, u1: number, v0: number, v1: number, h0: number, h1: number) {
    return {
      top: pts(P(u0, v0, h1), P(u1, v0, h1), P(u1, v1, h1), P(u0, v1, h1)),
      uFace: pts(P(u1, v0, h0), P(u1, v1, h0), P(u1, v1, h1), P(u1, v0, h1)),
      vFace: pts(P(u0, v1, h0), P(u1, v1, h0), P(u1, v1, h1), P(u0, v1, h1)),
    };
  }
  /** Same block with u and v swapped: the left sofa is the right one, mirrored onto the other wall. */
  const mirror = (u0: number, u1: number, v0: number, v1: number, h0: number, h1: number) => box(v0, v1, u0, u1, h0, h1);

  // A sofa is four seats of 85 units with arms either side, backed against a wall.
  const SEAT = 85;
  const START = 160;
  const END = START + 4 * SEAT;
  function sofa(b: typeof box) {
    return {
      back: b(START, END, 8, 40, 0, 118),
      farArm: b(START - 20, START, 8, 128, 0, 78),
      base: b(START, END, 40, 128, 0, 28),
      cushions: [0, 1, 2, 3].map((i) => b(START + SEAT * i + 3, START + SEAT * (i + 1) - 3, 42, 128, 28, 50)),
      backCushions: [0, 1, 2, 3].map((i) => b(START + SEAT * i + 5, START + SEAT * (i + 1) - 5, 32, 52, 50, 104)),
      nearArm: b(END, END + 20, 8, 128, 0, 78),
    };
  }
  const sofas = [sofa(mirror), sofa(box)];

  /** Where seat n sits, left to right on screen: 0–3 on the left sofa (far end first), 4–7 on the right one. */
  function seatSpot(seat: number) {
    const along = START + SEAT * ((seat < 4 ? 3 - seat : seat - 4) + 0.5);
    const [u, v] = seat < 4 ? [88, along] : [along, 88];
    const [x, y] = P(u, v, 50);
    const [lx, ly] = seat < 4 ? P(132, along, 22) : P(along, 132, 22);
    return { x, y, lx, ly, depth: u + v };
  }

  const SIZE = 124;
  const seated = $derived(
    players
      .filter((p) => p.seat < seats)
      .map((p) => ({ player: p, ...seatSpot(p.seat) }))
      .sort((a, b) => a.depth - b.depth),
  );
  /** A taken seat's cushion wears its player's colour. */
  const tintFor = (seat: number) => {
    const p = players.find((x) => x.seat === seat);
    return p ? seatColour(p.colour).bg : undefined;
  };
  const short = (name: string) => ([...name].length > 9 ? [...name].slice(0, 8).join('') + '…' : name);

  const lamp = P(60, 60, 0);
  const shade = P(60, 60, 205);
  const table = box(250, 370, 250, 370, 0, 36);
  const bowl = P(300, 300, 36);
  const remote = box(335, 355, 270, 280, 36, 41);
</script>

{#snippet block(b: ReturnType<typeof box>, kind: string, tint?: string)}
  <g class="block {kind}" class:tinted={!!tint} style:--tint={tint}>
    <polygon class="u" points={b.uFace} /><polygon class="v" points={b.vFace} /><polygon class="t" points={b.top} />
  </g>
{/snippet}

<svg class="room" viewBox="0 0 1280 720" aria-hidden="true">
  <defs>
    <radialGradient id="lamp-glow">
      <stop offset="0" class="glow-in" />
      <stop offset="1" class="glow-out" />
    </radialGradient>
    <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="sky-top" />
      <stop offset="1" class="sky-bottom" />
    </linearGradient>
  </defs>

  <!-- Walls and floor. -->
  <polygon class="wall-left" points={pts(P(0, 0, 600), P(0, 0, 0), P(0, 900, 0), P(0, 900, 600))} />
  <polygon class="wall-right" points={pts(P(0, 0, 600), P(0, 0, 0), P(900, 0, 0), P(900, 0, 600))} />
  <polygon class="floor" points={pts(P(0, 0), P(900, 0), P(900, 900), P(0, 900))} />
  <g transform="matrix(1 0.5 -1 0.5 {OX} {OY})">
    {#each [60, 120, 180, 240, 300, 360, 420, 480, 540, 600] as v (v)}
      <line class="board" x1="0" y1={v} x2="900" y2={v} />
    {/each}
    <rect class="rug" x="175" y="175" width="270" height="270" rx="28" />
    <rect class="rug-trim" x="195" y="195" width="230" height="230" rx="18" />
  </g>
  <polyline class="skirting" points={pts(P(0, 900, 0), P(0, 0, 0), P(900, 0, 0))} />

  <!-- A window on the right wall, a picture on the left. Both drawn flat, then sheared onto their wall. -->
  <g transform="matrix(1 0.5 0 -1 {OX} {OY})">
    <rect class="sky" x="250" y="160" width="170" height="140" rx="6" />
    <circle class="moon" cx="380" cy="268" r="16" />
    <circle class="star" cx="290" cy="280" r="2.5" /><circle class="star" cx="330" cy="200" r="2" />
    <circle class="star" cx="270" cy="220" r="1.8" /><circle class="star" cx="405" cy="215" r="2.2" />
    <rect class="frame" x="250" y="160" width="170" height="140" rx="6" />
    <line class="frame" x1="335" y1="160" x2="335" y2="300" />
  </g>
  <g transform="matrix(-1 0.5 0 -1 {OX} {OY})">
    <rect class="picture" x="260" y="170" width="120" height="90" rx="4" />
    <path class="picture-spud" d="M296 205 C292 228 306 240 320 238 C338 236 346 222 342 206 C338 192 324 188 314 189 C302 190 298 196 296 205 Z" />
    <rect class="frame" x="260" y="170" width="120" height="90" rx="4" />
  </g>

  <!-- The lamp in the corner throws the mood's glow over everything. -->
  <circle class="lamp-light" cx={shade[0]} cy={shade[1] + 40} r="300" fill="url(#lamp-glow)" />
  <line class="pole" x1={lamp[0]} y1={lamp[1]} x2={shade[0]} y2={shade[1]} />
  <ellipse class="lamp-foot" cx={lamp[0]} cy={lamp[1]} rx="22" ry="11" />
  <path class="lamp-shade" d="M{shade[0] - 34} {shade[1] + 6} L{shade[0] + 34} {shade[1] + 6} L{shade[0] + 20} {shade[1] - 38} L{shade[0] - 20} {shade[1] - 38} Z" />

  <!-- Two sofas, each drawn back to front so nearer parts cover farther ones. -->
  {#each sofas as s, i (i)}
    {@render block(s.back, 'frame')}
    {@render block(s.farArm, 'frame')}
    {@render block(s.base, 'frame')}
    {#each s.cushions as c, j (j)}{@render block(c, 'cushion', tintFor(i === 0 ? 3 - j : 4 + j))}{/each}
    {#each s.backCushions as c, j (j)}{@render block(c, 'cushion')}{/each}
    {@render block(s.nearArm, 'frame')}
  {/each}

  <!-- Coffee table with the essentials: popcorn and the remote nobody can find. -->
  {@render block(table, 'table')}
  <ellipse class="bowl" cx={bowl[0]} cy={bowl[1] - 6} rx="34" ry="16" />
  {#each [[-14, -14], [0, -18], [14, -13], [-6, -8], [8, -6], [-20, -6], [20, -5]] as [dx, dy], k (k)}
    <circle class="popcorn" cx={bowl[0] + dx} cy={bowl[1] + dy - 6} r="7" />
  {/each}
  {@render block(remote, 'remote')}

  <!-- The potatoes, back to front. -->
  {#each seated as s (s.player.id)}
    <g transform="translate({s.x} {s.y})" class:away={s.player.away}>
      <ellipse class="dent" cx="0" cy="2" rx="46" ry="14" />
      {#key wiggle?.id === s.player.id ? wiggle?.n : 0}
        <g class="drop" class:wiggle={wiggle?.id === s.player.id}>
          <g transform="translate({-SIZE / 2} {-SIZE * 0.9})">
            <Potato kind={s.player.potato} size={SIZE} asleep={s.player.away} delay={s.player.seat * 0.37} />
          </g>
        </g>
      {/key}
      <g class="puff">
        <circle cx="-34" cy="0" r="9" /><circle cx="34" cy="0" r="9" /><circle cx="-18" cy="6" r="7" /><circle cx="20" cy="6" r="7" />
      </g>
    </g>
  {/each}

  <!-- Names on the seat fronts, last so nothing covers them. -->
  {#each seated as s (s.player.id)}
    <text class="name" class:away={s.player.away} x={s.lx} y={s.ly + 11}>{short(s.player.name)}</text>
  {/each}
</svg>

<style>
  .room { position: absolute; inset: 0; width: 100%; height: 100%; overflow: hidden; }

  .wall-left { fill: color-mix(in srgb, var(--surface-1) 88%, var(--spud)); }
  .wall-right { fill: color-mix(in srgb, var(--surface-1) 92%, black); }
  .floor { fill: color-mix(in srgb, var(--surface-2) 82%, var(--spud)); }
  .board { stroke: var(--edge-dark); stroke-width: 1.5; opacity: 0.35; }
  .rug { fill: var(--tile-d); opacity: 0.55; }
  .rug-trim { fill: none; stroke: var(--tile-a); stroke-width: 4; stroke-dasharray: 14 10; opacity: 0.6; }
  .skirting { fill: none; stroke: var(--edge-dark); stroke-width: 6; }

  .sky { fill: url(#night); }
  .sky-top { stop-color: var(--surface-0); }
  .sky-bottom { stop-color: var(--sofa); }
  .moon { fill: var(--potato-mash); }
  .star { fill: var(--ink); opacity: 0.8; animation: twinkle 3s ease-in-out infinite; }
  .star:nth-of-type(2n) { animation-delay: -1.4s; }
  .frame { fill: none; stroke: var(--potato-outline); stroke-width: 6; }
  .picture { fill: var(--surface-2); }
  .picture-spud { fill: var(--spud); }

  .glow-in { stop-color: var(--spud); stop-opacity: 0.35; }
  .glow-out { stop-color: var(--spud); stop-opacity: 0; }
  .lamp-light { mix-blend-mode: screen; animation: flicker 7s ease-in-out infinite; }
  .pole { stroke: var(--potato-outline); stroke-width: 5; stroke-linecap: round; }
  .lamp-foot { fill: var(--potato-outline); }
  .lamp-shade { fill: var(--potato-mash); stroke: var(--potato-outline); stroke-width: 4; stroke-linejoin: round; }

  .block polygon { stroke: color-mix(in srgb, var(--sofa) 35%, black); stroke-width: 3; stroke-linejoin: round; }
  .frame .t { fill: color-mix(in srgb, var(--sofa) 80%, white); }
  .frame .u { fill: var(--sofa); }
  .frame .v { fill: color-mix(in srgb, var(--sofa) 72%, black); }
  .cushion .t { fill: color-mix(in srgb, var(--sofa) 70%, white); }
  .cushion .u { fill: color-mix(in srgb, var(--sofa) 92%, white); }
  .cushion .v { fill: color-mix(in srgb, var(--sofa) 85%, black); }
  .cushion.tinted .t { fill: color-mix(in srgb, var(--tint) 88%, white); }
  .cushion.tinted .u { fill: var(--tint); }
  .cushion.tinted .v { fill: color-mix(in srgb, var(--tint) 75%, black); }
  .table polygon, .remote polygon { stroke: var(--potato-outline); }
  .table .t { fill: color-mix(in srgb, var(--potato-skin) 80%, white); }
  .table .u { fill: var(--potato-skin); }
  .table .v { fill: var(--potato-skin-shade); }
  .remote .t, .remote .u, .remote .v { fill: var(--potato-outline); }
  .bowl { fill: var(--tile-d); stroke: var(--potato-outline); stroke-width: 3; }
  .popcorn { fill: var(--potato-mash); stroke: var(--potato-outline); stroke-width: 2; }

  .dent { fill: var(--edge-dark); opacity: 0.5; animation: dent 600ms var(--ease-out) both; transform-box: fill-box; transform-origin: center; }
  .drop { transform-box: fill-box; transform-origin: 50% 92%; animation: drop 620ms cubic-bezier(0.5, 0, 0.6, 1) both; }
  .drop.wiggle { animation: hop 420ms var(--ease-out); }
  .away .drop { opacity: 0.6; }
  .puff circle { fill: var(--ink); opacity: 0; transform-box: fill-box; transform-origin: center; animation: puff 520ms ease-out 260ms both; }
  .puff circle:nth-child(odd) { --dx: -14px; }
  .puff circle:nth-child(even) { --dx: 14px; }

  .name {
    font: 800 32px var(--font-sans); text-anchor: middle; fill: var(--potato-salt);
    paint-order: stroke; stroke: var(--potato-outline); stroke-width: 8px; stroke-linejoin: round;
  }
  .name.away { opacity: 0.55; }

  /* Fall from above the stage, slam, squash, rebound once, settle. */
  @keyframes drop {
    0% { transform: translateY(-560px) scale(0.92, 1.12); }
    42% { transform: translateY(0) scale(0.92, 1.12); }
    52% { transform: translateY(0) scale(1.24, 0.72); }
    66% { transform: translateY(-16px) scale(0.94, 1.08); }
    80% { transform: translateY(0) scale(1.06, 0.94); }
    100% { transform: none; }
  }
  @keyframes dent { 0%, 40% { transform: scale(0.4); opacity: 0; } 52% { transform: scale(1.25, 1.4); opacity: 0.7; } 100% { transform: scale(1); } }
  @keyframes puff { 0% { opacity: 0.55; transform: translate(0, 0) scale(0.4); } 100% { opacity: 0; transform: translate(var(--dx), -18px) scale(1.6); } }
  @keyframes hop { 30% { transform: translateY(-34px) scale(0.92, 1.1); } 60% { transform: translateY(0) scale(1.14, 0.84); } 80% { transform: scale(0.97, 1.03); } }
  @keyframes twinkle { 50% { opacity: 0.25; } }
  @keyframes flicker { 0%, 100% { opacity: 1; } 47% { opacity: 1; } 48% { opacity: 0.86; } 50% { opacity: 1; } 72% { opacity: 0.94; } }

  @media (prefers-reduced-motion: reduce) {
    .drop, .dent, .puff circle, .star, .lamp-light { animation: none; }
  }
</style>
