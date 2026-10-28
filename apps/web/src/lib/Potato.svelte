<!-- One potato character, drawn in SVG with far more care than a potato deserves:
     chunky outline, a shaded belly, a shine, blinking eyes and an idle wobble. Colours come from the --potato-* tokens. -->
<script lang="ts">
  import type { PotatoKind } from '@couchpotato/shared';
  import { potatoName } from './potatoes';

  let {
    kind,
    size = 96,
    asleep = false,
    still = false,
    delay = 0,
  }: {
    kind: PotatoKind;
    size?: number;
    /** Dozing: eyes shut and a few Zs. Used for players whose phone dropped. */
    asleep?: boolean;
    /** No idle wobble or blinking, e.g. in tight lists. */
    still?: boolean;
    /** Seconds to offset the idle loop, so a sofa of potatoes doesn't breathe in unison. */
    delay?: number;
  } = $props();

  const uid = $props.id();

  type Look = { body: string; fill: string; shade: string; face: { x: number; y: number; s: number }; tilt?: number };
  const LOOKS: Record<PotatoKind, Look> = {
    boiled: {
      body: 'M20 60 C20 40 34 30 50 30 C68 30 82 42 80 60 C79 76 65 86 50 86 C34 86 21 76 20 60 Z',
      fill: 'var(--potato-boiled)', shade: 'var(--potato-boiled-shade)', face: { x: 50, y: 60, s: 1.2 },
    },
    grilled: {
      body: 'M20 60 C17 39 33 26 52 27 C72 28 85 42 81 61 C78 78 63 86 48 85 C32 84 22 75 20 60 Z',
      fill: 'var(--potato-skin)', shade: 'var(--potato-skin-shade)', face: { x: 51, y: 59, s: 1.2 },
    },
    chip: {
      body: 'M15 60 Q17 41 33 37 Q42 33 50 36 Q58 33 67 37 Q83 41 85 58 Q87 74 69 80 Q59 85 50 82 Q41 85 31 80 Q13 74 15 60 Z',
      fill: 'var(--potato-gold)', shade: 'var(--potato-gold-shade)', face: { x: 50, y: 60, s: 1.14 }, tilt: -6,
    },
    fry: {
      body: 'M41 12 H59 Q64 12 64 17 V85 Q64 90 59 90 H41 Q36 90 36 85 V17 Q36 12 41 12 Z',
      fill: 'var(--potato-gold)', shade: 'var(--potato-gold-shade)', face: { x: 50, y: 46, s: 0.9 }, tilt: 8,
    },
    mashed: {
      body: 'M16 80 C13 64 22 53 32 49 C33 38 44 33 51 37 C59 31 71 37 71 47 C82 51 88 64 84 80 C70 87 30 87 16 80 Z',
      fill: 'var(--potato-mash)', shade: 'var(--potato-mash-shade)', face: { x: 50, y: 66, s: 1.14 },
    },
    jacket: {
      body: 'M18 62 C15 40 32 25 51 26 C71 27 86 41 82 62 C80 79 65 88 49 87 C32 86 20 77 18 62 Z',
      fill: 'var(--potato-skin)', shade: 'var(--potato-skin-shade)', face: { x: 50, y: 52, s: 1.08 },
    },
    hashbrown: {
      body: 'M22 36 Q22 26 32 26 H69 Q79 26 79 36 V74 Q79 84 69 84 H32 Q22 84 22 74 Z',
      fill: 'var(--potato-hash)', shade: 'var(--potato-hash-shade)', face: { x: 50, y: 57, s: 1.14 }, tilt: -4,
    },
    sweet: {
      body: 'M12 66 C12 50 28 37 50 35 C71 33 89 40 89 53 C89 67 73 80 50 82 C29 84 12 79 12 66 Z',
      fill: 'var(--potato-sweet)', shade: 'var(--potato-sweet-shade)', face: { x: 49, y: 60, s: 1.14 }, tilt: -10,
    },
  };

  const look = $derived(LOOKS[kind] ?? LOOKS.boiled);
  const f = $derived(look.face);
</script>

<svg
  class="potato"
  class:still
  viewBox="0 0 100 100"
  width={size}
  height={size}
  role="img"
  aria-label="{potatoName(kind)} potato{asleep ? ', dozing' : ''}"
  style:--delay="{delay}s"
>
  <defs>
    <clipPath id="{uid}-clip"><path d={look.body} /></clipPath>
  </defs>

  <!-- Ground shadow stays put while the potato wobbles above it. -->
  <ellipse class="shadow" cx="50" cy="92" rx="30" ry="5" />

  <g class="wobble">
    <g transform="rotate({look.tilt ?? 0} 50 56)">
      {#if kind === 'boiled' && !asleep}
        <g class="steam" fill="none" stroke="var(--potato-steam)" stroke-width="3" stroke-linecap="round">
          <path d="M38 22 q-4 -5 0 -10 q4 -5 0 -10" />
          <path d="M58 22 q-4 -5 0 -10 q4 -5 0 -10" style:animation-delay="-1.1s" />
        </g>
      {/if}

      <!-- Body, shaded from the bottom right, with a shine top left. -->
      <path d={look.body} fill={look.shade} />
      <g clip-path="url(#{uid}-clip)">
        <ellipse cx="44" cy="50" rx="42" ry="34" fill={look.fill} />
        {#if kind === 'grilled'}
          <g stroke="var(--potato-char)" stroke-width="5" stroke-linecap="round" opacity="0.85">
            <path d="M20 52 L48 30" /><path d="M26 70 L66 36" /><path d="M42 82 L80 50" />
          </g>
        {:else if kind === 'chip'}
          <g fill="none" stroke={look.shade} stroke-width="2" opacity="0.7">
            <path d="M24 50 q26 -10 52 0" /><path d="M22 70 q28 8 56 0" />
          </g>
        {:else if kind === 'fry'}
          <g fill="var(--potato-salt)">
            <circle cx="42" cy="26" r="1.6" /><circle cx="57" cy="22" r="1.4" /><circle cx="44" cy="70" r="1.5" />
            <circle cx="58" cy="78" r="1.6" /><circle cx="54" cy="64" r="1.2" /><circle cx="41" cy="84" r="1.3" />
          </g>
        {:else if kind === 'mashed'}
          <path d="M34 54 q8 -8 16 -2 q8 6 16 -2" fill="none" stroke={look.shade} stroke-width="2.5" stroke-linecap="round" />
        {:else if kind === 'jacket'}
          <path
            d="M10 64 L20 68 L28 63 L36 69 L44 63 L52 69 L60 63 L68 69 L76 63 L84 68 L92 64 V100 H10 Z"
            fill="var(--potato-foil)"
          />
          <g fill="none" stroke="var(--potato-foil-shade)" stroke-width="1.6" stroke-linecap="round">
            <path d="M24 76 l6 4" /><path d="M46 80 l5 -4" /><path d="M66 78 l6 3" /><path d="M36 88 l4 -3" />
          </g>
        {:else if kind === 'hashbrown'}
          <g stroke={look.shade} stroke-width="2" stroke-linecap="round" opacity="0.75">
            <path d="M30 40 l8 -2" /><path d="M62 36 l7 3" /><path d="M28 72 l7 3" /><path d="M66 74 l6 -4" />
            <path d="M44 34 l6 1" /><path d="M58 80 l6 -1" />
          </g>
        {/if}
        <ellipse cx="34" cy="42" rx="10" ry="5" transform="rotate(-30 34 42)" fill="var(--potato-shine)" />
      </g>
      <path d={look.body} fill="none" stroke="var(--potato-outline)" stroke-width="3.5" stroke-linejoin="round" />

      {#if kind === 'jacket'}
        <!-- The obligatory knob of butter in the cross cut. -->
        <path d="M44 30 l12 -6 M44 24 l12 6" stroke="var(--potato-outline)" stroke-width="2.5" stroke-linecap="round" />
        <rect x="45" y="18" width="11" height="8" rx="2" fill="var(--potato-butter)" stroke="var(--potato-outline)" stroke-width="2" />
      {:else if kind === 'mashed'}
        <rect x="42" y="25" width="16" height="10" rx="2.5" transform="rotate(-8 50 30)" fill="var(--potato-butter)" stroke="var(--potato-outline)" stroke-width="2.5" />
      {:else if kind === 'sweet'}
        <path d="M89 52 q6 -2 8 -8" fill="none" stroke="var(--potato-outline)" stroke-width="2.5" stroke-linecap="round" />
      {:else if kind === 'grilled'}
        <path d="M70 22 q3 -4 0 -8" fill="none" stroke="var(--potato-steam)" stroke-width="2.5" stroke-linecap="round" />
      {/if}

      <!-- The face. -->
      <g transform="translate({f.x} {f.y}) scale({f.s})">
        <ellipse cx="-15" cy="7" rx="6" ry="3.5" fill="var(--potato-blush)" />
        <ellipse cx="15" cy="7" rx="6" ry="3.5" fill="var(--potato-blush)" />
        {#if asleep}
          <g fill="none" stroke="var(--potato-eye)" stroke-width="2.6" stroke-linecap="round">
            <path d="M-12 -1 q4 3 8 0" /><path d="M4 -1 q4 3 8 0" />
          </g>
          <path d="M-3 9 q3 1.5 6 0" fill="none" stroke="var(--potato-eye)" stroke-width="2.2" stroke-linecap="round" />
        {:else}
          <g class="eyes">
            <ellipse cx="-8" cy="-2" rx="4" ry="5" fill="var(--potato-eye)" />
            <ellipse cx="8" cy="-2" rx="4" ry="5" fill="var(--potato-eye)" />
            <circle cx="-6.6" cy="-4" r="1.5" fill="var(--potato-shine)" />
            <circle cx="9.4" cy="-4" r="1.5" fill="var(--potato-shine)" />
          </g>
          <path d="M-6 7 q6 6 12 0" fill="none" stroke="var(--potato-eye)" stroke-width="2.6" stroke-linecap="round" />
        {/if}
      </g>
    </g>
  </g>

  {#if asleep}
    <g class="zzz" fill="var(--ink)" font-family="var(--font-display)" font-weight="700">
      <text x="72" y="26" font-size="14">z</text>
      <text x="82" y="14" font-size="10">z</text>
    </g>
  {/if}
</svg>

<style>
  .potato { display: block; overflow: visible; }
  .shadow { fill: var(--edge-dark); opacity: 0.6; }
  .wobble { transform-origin: 50px 90px; animation: idle 2.6s ease-in-out infinite; animation-delay: calc(var(--delay) * -1); }
  .eyes { transform-box: fill-box; transform-origin: center; animation: blink 4.8s infinite; animation-delay: calc(var(--delay) * -1.7); }
  .steam path { animation: steam 2.2s ease-in-out infinite; }
  .zzz { animation: doze 2.4s ease-in-out infinite; }
  .still .wobble, .still .eyes, .still .steam path { animation: none; }

  /* Breathing squash: wider as it squats, taller as it rises. Arcade-snappy, not floaty. */
  @keyframes idle {
    0%, 100% { transform: scale(1, 1); }
    45% { transform: scale(1.035, 0.955); }
    60% { transform: scale(0.985, 1.02); }
  }
  @keyframes blink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
  @keyframes steam { 0% { opacity: 0; transform: translateY(4px); } 40% { opacity: 1; } 100% { opacity: 0; transform: translateY(-8px); } }
  @keyframes doze { 50% { opacity: 0.35; transform: translateY(-3px); } }

  @media (prefers-reduced-motion: reduce) {
    .wobble, .eyes, .steam path, .zzz { animation: none; }
  }
</style>
