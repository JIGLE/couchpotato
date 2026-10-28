<!-- The waiting room: a living room seen front-on, like a sitcom set, with one long sofa facing the players.
     The room is SVG coloured from the mood tokens; the cushions and potatoes are a soft-body simulation drawn on
     a canvas on top (see room/physics.ts). Potatoes fall in when players join, squash, wobble, ripple the cushions,
     bump their neighbours, hop when their phone waves and get flicked off when they leave. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Player, PotatoKind } from '@couchpotato/shared';
  import type { PotatoFace } from './potatoes';
  import { SOFA, STEP, World, seatX, type Body } from './room/physics';
  import { SPRITE, buildSprites, outline, spriteKey, type Sprites } from './room/sprites';

  let {
    players,
    seats = 8,
    wiggle = null,
  }: { players: Player[]; seats?: number; wiggle?: { id: string; n: number } | null } = $props();

  let canvas: HTMLCanvasElement;
  let room: HTMLDivElement;
  const world = new World();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** What the canvas needs to know about each potato beyond its physics. */
  type Extra = { player: Player; ouchUntil: number; blinkAt: number; hopAt: number; leaving: boolean };
  const extras = new Map<Body, Extra>();
  const byId = new Map<string, Body>();
  const outlines = new Map<PotatoKind, [number, number][]>();
  type Dust = { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; star: boolean };
  let dust: Dust[] = [];
  let now = 0;

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const hull = (kind: PotatoKind) => {
    if (!outlines.has(kind)) outlines.set(kind, outline(kind));
    return outlines.get(kind)!;
  };

  function spawn(p: Player) {
    const x = seatX(p.seat) + (reduced ? 0 : rand(-24, 24));
    const y = reduced ? SOFA.frontEdge - SOFA.sit - 60 : rand(-260, -120);
    const b = world.add(p.id, p.potato, p.seat, hull(p.potato), x, y, reduced ? 0 : rand(-0.35, 0.35));
    if (!reduced) world.kick(b, rand(-60, 60), rand(0, 300), rand(-3, 3));
    extras.set(b, { player: p, ouchUntil: 0, blinkAt: now + rand(1, 5), hopAt: now + rand(6, 14), leaving: false });
    byId.set(p.id, b);
  }

  /** Off the sofa: a flick up and sideways, then gravity takes it out of the room. */
  function flick(b: Body) {
    const e = extras.get(b);
    if (!e || e.leaving) return;
    e.leaving = true;
    byId.delete(b.id);
    b.ghost = true;
    world.kick(b, b.seat < seats / 2 ? -700 : 700, -900, b.seat < seats / 2 ? -9 : 9);
  }

  // Keep the simulation in step with who is on the couch.
  $effect(() => {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.seat >= seats) continue;
      seen.add(p.id);
      const b = byId.get(p.id);
      if (!b) spawn(p);
      else if (b.kind !== p.potato) {
        // Swapped potato: the old one is flicked away and the new one drops in.
        flick(b);
        spawn(p);
      } else extras.get(b)!.player = p;
    }
    for (const [id, b] of byId) if (!seen.has(id)) flick(b);
  });

  // A wave from the phone makes that potato hop.
  $effect(() => {
    const b = wiggle && byId.get(wiggle.id);
    if (b && !reduced) world.kick(b, rand(-80, 80), -1050, rand(-6, 6));
  });

  // Colours come from the mood; read them once per mood.
  let colours = readColours();
  function readColours() {
    const css = getComputedStyle(document.documentElement);
    const get = (name: string) => css.getPropertyValue(name).trim();
    return {
      sofa: get('--sofa'),
      tiles: ['a', 'b', 'c', 'd'].map((k) => ({ bg: get(`--tile-${k}`), ink: get(`--tile-${k}-ink`) })),
      outline: get('--potato-outline'),
      spud: get('--spud'),
      salt: get('--potato-salt'),
      shadow: get('--edge-dark'),
    };
  }

  /** Mix two #rrggbb colours; anything else falls back to the first. */
  function mix(a: string, b: string, t: number): string {
    const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
    const x = hex(a);
    const y = hex(b);
    if (!x || !y) return a;
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
  }

  let sprites: Sprites = new Map();
  onMount(() => {
    let alive = true;
    const refresh = () =>
      buildSprites().then((s) => {
        if (alive) sprites = s;
      });
    void refresh();
    const moodWatch = new MutationObserver(() => {
      colours = readColours();
      void refresh();
    });
    moodWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mood'] });

    const ctx = canvas.getContext('2d')!;
    let last = performance.now();
    let acc = 0;
    let frame = 0;
    const loop = (t: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 16) {
        now += STEP;
        for (const thud of world.step()) land(thud.body, thud.x, thud.y, thud.force);
        acc -= STEP;
        steps++;
      }
      if (steps === 16) acc = 0;
      life(dt);
      draw(ctx);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      moodWatch.disconnect();
    };
  });

  /** A hard landing: dust, a squeezed face, and for the heavy ones the whole room shakes. */
  function land(b: Body, x: number, y: number, force: number) {
    const e = extras.get(b);
    if (!e || force < 900) return;
    if (force > 1800) e.ouchUntil = now + 0.45;
    const puffs = Math.min(18, Math.round(force / 250));
    for (let i = 0; i < puffs; i++) {
      const dir = i % 2 ? 1 : -1;
      dust.push({
        x: x + rand(-10, 10), y, vx: dir * rand(60, 260), vy: rand(-260, -60),
        r: rand(4, 9), life: 0, max: rand(0.35, 0.6), star: force > 3200 && i < 4,
      });
    }
    if (force > 3200 && !reduced) {
      room.animate(
        [
          { transform: 'translate(0,0)' }, { transform: 'translate(-6px,4px)' }, { transform: 'translate(5px,-3px)' },
          { transform: 'translate(-2px,2px)' }, { transform: 'translate(0,0)' },
        ],
        { duration: 260, easing: 'ease-out' },
      );
    }
  }

  /** Blinks, idle hops, dust ageing, and clearing potatoes that have left the room. */
  function life(dt: number) {
    for (const [b, e] of extras) {
      if (e.leaving && (b.minY > 800 || b.maxX < -200 || b.minX > 1480)) {
        world.remove(b);
        extras.delete(b);
        continue;
      }
      if (now > e.blinkAt + 0.14) e.blinkAt = now + rand(2.5, 6);
      if (!reduced && !e.leaving && !e.player.away && b.grounded && now > e.hopAt) {
        world.kick(b, rand(-40, 40), rand(-520, -300), rand(-2.5, 2.5));
        e.hopAt = now + rand(7, 16);
      }
    }
    for (const d of dust) {
      d.life += dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 500 * dt;
      d.vx *= 0.96;
    }
    dust = dust.filter((d) => d.life < d.max);
  }

  function faceOf(e: Extra): PotatoFace {
    if (e.player.away) return 'sleep';
    if (now < e.ouchUntil) return 'ouch';
    if (now > e.blinkAt && now < e.blinkAt + 0.14) return 'blink';
    return 'happy';
  }

  function draw(ctx: CanvasRenderingContext2D) {
    const rect = canvas.getBoundingClientRect();
    const k = Math.min(2.5, Math.max(1, (rect.width / 1280) * devicePixelRatio));
    if (canvas.width !== Math.round(1280 * k)) {
      canvas.width = Math.round(1280 * k);
      canvas.height = Math.round(720 * k);
    }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, 1280, 720);
    drawCushions(ctx);

    const bodies = [...extras.keys()].sort((a, b) => Number(b.grounded) - Number(a.grounded) || a.cy - b.cy);
    // Shadows first so no potato is drawn under another's shadow.
    for (const b of bodies) {
      if (b.ghost || b.cx < SOFA.left || b.cx > SOFA.right) continue;
      const floor = world.surface(b.cx) - SOFA.sit;
      const lift = Math.max(0, floor - b.maxY);
      const a = Math.max(0, 0.45 - lift / 500);
      if (a <= 0) continue;
      ctx.fillStyle = colours.shadow;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.ellipse(b.cx, floor + 2, ((b.maxX - b.minX) / 2) * (1 - Math.min(lift, 300) / 600), 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const b of bodies) drawPotato(ctx, b, k);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawDust(ctx);
    drawNames(ctx);
  }

  function drawCushions(ctx: CanvasRenderingContext2D) {
    const width = (SOFA.right - SOFA.left) / SOFA.seats;
    ctx.lineJoin = 'round';
    for (let s = 0; s < SOFA.seats; s++) {
      const p = players.find((x) => x.seat === s);
      const base = p ? colours.tiles[p.colour % 4].bg : colours.sofa;
      const x0 = SOFA.left + s * width + 2;
      const x1 = x0 + width - 4;
      const edge: [number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const x = x0 + ((x1 - x0) * i) / 10;
        edge.push([x, world.surface(x)]);
      }
      // Top of the cushion: from the fixed back edge to the moving front edge, which dents under a potato.
      ctx.beginPath();
      ctx.moveTo(x0 + 6, SOFA.backEdge);
      ctx.lineTo(x1 - 6, SOFA.backEdge);
      for (let i = edge.length - 1; i >= 0; i--) ctx.lineTo(edge[i][0], edge[i][1]);
      ctx.closePath();
      ctx.fillStyle = mix(base, '#ffffff', 0.22);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = mix(base, '#000000', 0.55);
      ctx.stroke();
      // Front face, following the dent.
      ctx.beginPath();
      edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(x1, SOFA.faceBottom);
      ctx.lineTo(x0, SOFA.faceBottom);
      ctx.closePath();
      ctx.fillStyle = base;
      ctx.fill();
      ctx.stroke();
      // Piping along the front edge.
      ctx.beginPath();
      edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + 7) : ctx.moveTo(x, y + 7)));
      ctx.strokeStyle = mix(base, '#ffffff', 0.35);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawPotato(ctx: CanvasRenderingContext2D, b: Body, k: number) {
    const e = extras.get(b);
    const img = e && sprites.get(spriteKey(b.kind, faceOf(e)));
    if (!e || !img || !img.complete) return;
    const breathe = b.grounded ? Math.sin(now * 2.6 + b.seat * 1.3) * 0.025 : 0;
    const [ma, mb, mc, md] = b.m;
    const sx = 1 + breathe;
    const sy = 1 - breathe;
    // Breathing squash about the potato's base, on top of the physics deformation about its centre.
    ctx.setTransform(k * ma * sx, k * mc * sx, k * mb * sy, k * md * sy, k * b.cx, k * (b.cy + (b.maxY - b.cy) * breathe));
    ctx.globalAlpha = e.player.away ? 0.75 : 1;
    ctx.drawImage(img, -b.spriteCx, -b.spriteCy, SPRITE, SPRITE);
    ctx.globalAlpha = 1;
    if (e.player.role === 'head-spud' && !e.leaving) drawCrown(ctx, b);
  }

  /** The Head Spud wears a crown, riding the potato's wobble. */
  function drawCrown(ctx: CanvasRenderingContext2D, b: Body) {
    const top = -(b.cy - b.minY) - 2;
    ctx.beginPath();
    ctx.moveTo(-15, top);
    ctx.lineTo(-17, top - 18);
    ctx.lineTo(-8, top - 9);
    ctx.lineTo(0, top - 22);
    ctx.lineTo(8, top - 9);
    ctx.lineTo(17, top - 18);
    ctx.lineTo(15, top);
    ctx.closePath();
    ctx.fillStyle = colours.spud;
    ctx.strokeStyle = colours.outline;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colours.salt;
    ctx.beginPath();
    ctx.arc(0, top - 7, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDust(ctx: CanvasRenderingContext2D) {
    for (const d of dust) {
      const t = d.life / d.max;
      ctx.globalAlpha = (1 - t) * 0.7;
      if (d.star) {
        ctx.fillStyle = colours.spud;
        ctx.font = `700 ${Math.round(20 + 10 * t)}px sans-serif`;
        ctx.fillText('✦', d.x, d.y);
      } else {
        ctx.fillStyle = colours.salt;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * (0.6 + t), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Name tags under the sofa in the player's cushion colour, alternating rows so long names have room. */
  function drawNames(ctx: CanvasRenderingContext2D) {
    ctx.font = '800 32px Manrope, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of players) {
      if (p.seat >= seats) continue;
      const x = seatX(p.seat);
      const y = p.seat % 2 ? 640 : 592;
      let name = (p.role === 'head-spud' ? '♛ ' : '') + p.name;
      while (ctx.measureText(name).width > 156 && name.length > 2) name = name.slice(0, -2) + '…';
      const w = ctx.measureText(name).width + 28;
      const tile = colours.tiles[p.colour % 4];
      ctx.globalAlpha = p.away ? 0.55 : 1;
      ctx.strokeStyle = colours.outline;
      ctx.lineWidth = 3;
      // The lower row gets a little stalk up to its seat.
      if (p.seat % 2) {
        ctx.beginPath();
        ctx.moveTo(x, 574);
        ctx.lineTo(x, y - 22);
        ctx.stroke();
      }
      ctx.fillStyle = tile.bg;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 22, w, 44, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = tile.ink;
      ctx.fillText(name, x, y + 2);
      ctx.globalAlpha = 1;
    }
  }

  // The clock on the wall tells the real time. Nobody asked for this.
  let time = $state(new Date());
  onMount(() => {
    const t = setInterval(() => (time = new Date()), 1000);
    return () => clearInterval(t);
  });
  const hourAngle = $derived(((time.getHours() % 12) + time.getMinutes() / 60) * 30);
  const minuteAngle = $derived((time.getMinutes() + time.getSeconds() / 60) * 6);
  const secondAngle = $derived(time.getSeconds() * 6);

  // Floorboards converge on a vanishing point above the sofa.
  const boards = Array.from({ length: 17 }, (_, i) => 120 + i * 80);
  const stripes = Array.from({ length: 33 }, (_, i) => i * 40);
  const backs = Array.from({ length: SOFA.seats }, (_, i) => SOFA.left + (i * (SOFA.right - SOFA.left)) / SOFA.seats);
  const backW = (SOFA.right - SOFA.left) / SOFA.seats;
</script>

<div class="room" bind:this={room} aria-hidden="true">
  <svg viewBox="0 0 1280 720">
    <defs>
      <radialGradient id="lamp-glow">
        <stop offset="0" class="glow-in" />
        <stop offset="1" class="glow-out" />
      </radialGradient>
      <filter id="neon" x="-20%" y="-80%" width="140%" height="260%">
        <feGaussianBlur stdDeviation="5" result="soft" />
        <feGaussianBlur stdDeviation="16" in="SourceGraphic" result="wide" />
        <feMerge><feMergeNode in="wide" /><feMergeNode in="soft" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    <!-- Wall with a faint stripe, skirting, and the floor. -->
    <rect class="wall" x="0" y="0" width="1280" height="560" />
    {#each stripes as x (x)}
      <rect class="stripe" {x} y="0" width="16" height="548" />
    {/each}
    <rect class="skirting" x="0" y="540" width="1280" height="20" />
    <rect class="floor" x="0" y="560" width="1280" height="160" />
    {#each boards as x (x)}
      <line class="board" x1={820 + (x - 820) * 0.55} y1="560" x2={x} y2="720" />
    {/each}
    <polygon class="rug" points="520,578 1120,578 1190,716 450,716" />
    <polygon class="rug-trim" points="540,588 1100,588 1162,706 478,706" />

    <!-- The logo, in neon, because a sticker would have been reasonable. -->
    <g class="neon-sign" transform="translate(772 196)">
      <rect class="clip" x="-232" y="-52" width="8" height="14" rx="2" />
      <rect class="clip" x="224" y="-52" width="8" height="14" rx="2" />
      <g filter="url(#neon)">
        <path class="tube" d="M-292 14 C-296 -14 -276 -34 -254 -32 C-230 -30 -218 -12 -222 10 C-225 28 -244 36 -258 35 C-274 34 -289 28 -292 14 Z" />
        <path class="tube" d="M-276 2 q4 4 8 0 M-254 2 q4 4 8 0" />
        <text class="tube word" x="-200" y="20">couch p<tspan class="flicker">o</tspan>tato</text>
      </g>
    </g>

    <!-- Wall clock, real time. -->
    <g transform="translate(1150 186)">
      <circle r="38" class="clock-face" />
      {#each Array.from({ length: 12 }, (_, i) => i * 30) as a (a)}
        <line class="tick" x1="0" y1="-29" x2="0" y2="-33" transform="rotate({a})" />
      {/each}
      <line class="hand" x1="0" y1="4" x2="0" y2="-17" transform="rotate({hourAngle})" />
      <line class="hand" x1="0" y1="6" x2="0" y2="-26" transform="rotate({minuteAngle})" />
      <line class="second" x1="0" y1="8" x2="0" y2="-29" transform="rotate({secondAngle})" />
      <circle r="3.5" class="pin" />
    </g>

    <!-- Floor lamp behind the right arm. -->
    <circle cx="1252" cy="250" r="280" fill="url(#lamp-glow)" />
    <line class="pole" x1="1252" y1="262" x2="1252" y2="556" />
    <path class="lamp-shade" d="M1218 266 L1286 266 L1272 214 L1232 214 Z" />

    <!-- The sofa's frame: backrest, back cushions, base and arms. Seat cushions live on the canvas. -->
    <g class="sofa">
      <rect class="back" x="436" y="312" width="768" height="128" rx="18" />
      <rect class="back-top" x="428" y="296" width="784" height="32" rx="16" />
      {#each backs as x (x)}
        <rect class="back-cushion" x={x + 4} y="334" width={backW - 8} height="98" rx="16" />
        <circle class="tuft" cx={x + backW / 2} cy="372" r="4" />
      {/each}
      <rect class="base" x="410" y="508" width="820" height="54" rx="10" />
      <rect class="leg" x="428" y="560" width="16" height="14" rx="3" />
      <rect class="leg" x="812" y="560" width="16" height="14" rx="3" />
      <rect class="leg" x="1196" y="560" width="16" height="14" rx="3" />
      <rect class="arm" x="408" y="398" width="52" height="156" rx="14" />
      <rect class="arm-top" x="404" y="388" width="60" height="30" rx="15" />
      <rect class="arm" x="1180" y="398" width="52" height="156" rx="14" />
      <rect class="arm-top" x="1176" y="388" width="60" height="30" rx="15" />
    </g>
  </svg>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .room { position: absolute; inset: 0; overflow: hidden; }
  svg, canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

  .wall { fill: color-mix(in srgb, var(--surface-1) 86%, var(--spud)); }
  .stripe { fill: var(--ink); opacity: 0.025; }
  .skirting { fill: color-mix(in srgb, var(--surface-0) 70%, var(--spud)); }
  .floor { fill: color-mix(in srgb, var(--surface-2) 78%, var(--spud)); }
  .board { stroke: var(--edge-dark); stroke-width: 2; opacity: 0.5; }
  .rug { fill: var(--tile-d); opacity: 0.6; }
  .rug-trim { fill: none; stroke: var(--tile-a); stroke-width: 4; stroke-dasharray: 16 10; opacity: 0.7; }

  .clip { fill: var(--ink-muted); opacity: 0.5; }
  .tube { fill: none; stroke: var(--spud); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
  .word { font: 600 60px var(--font-display); letter-spacing: -0.02em; stroke-width: 3; }
  .neon-sign { animation: buzz 6s steps(1) infinite; }
  .flicker { animation: flicker 3.7s steps(1) infinite; }

  .clock-face { fill: var(--potato-mash); stroke: var(--potato-outline); stroke-width: 5; }
  .tick { stroke: var(--potato-outline); stroke-width: 3; stroke-linecap: round; }
  .hand { stroke: var(--potato-outline); stroke-width: 5; stroke-linecap: round; }
  .second { stroke: var(--tile-d); stroke-width: 2; stroke-linecap: round; }
  .pin { fill: var(--potato-outline); }

  .glow-in { stop-color: var(--spud); stop-opacity: 0.4; }
  .glow-out { stop-color: var(--spud); stop-opacity: 0; }
  .pole { stroke: var(--potato-outline); stroke-width: 6; stroke-linecap: round; }
  .lamp-shade { fill: var(--potato-mash); stroke: var(--potato-outline); stroke-width: 4; stroke-linejoin: round; }

  .sofa rect { stroke: color-mix(in srgb, var(--sofa) 40%, black); stroke-width: 3; }
  .back-top { fill: color-mix(in srgb, var(--sofa) 78%, white); }
  .back { fill: var(--sofa); }
  .back-cushion { fill: color-mix(in srgb, var(--sofa) 90%, white); }
  .tuft { fill: color-mix(in srgb, var(--sofa) 55%, black); }
  .base { fill: color-mix(in srgb, var(--sofa) 70%, black); }
  .leg { fill: var(--potato-outline); }
  .arm { fill: color-mix(in srgb, var(--sofa) 92%, black); }
  .arm-top { fill: color-mix(in srgb, var(--sofa) 80%, white); }

  @keyframes flicker { 0%, 100% { opacity: 1; } 62% { opacity: 0.25; } 64% { opacity: 1; } 66% { opacity: 0.3; } 68% { opacity: 1; } }
  @keyframes buzz { 0%, 100% { opacity: 1; } 91% { opacity: 0.86; } 92% { opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .neon-sign, .flicker { animation: none; }
  }
</style>
