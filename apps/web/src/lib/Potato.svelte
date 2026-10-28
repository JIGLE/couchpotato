<!-- One potato character, drawn in SVG with far more care than a potato deserves:
     chunky outline, a shaded belly, a shine, blinking eyes and an idle wobble. Colours come from the --potato-* tokens. -->
<script lang="ts">
  import type { PotatoKind } from '@couchpotato/shared';
  import { POTATO_LOOKS, potatoName, type PotatoFace } from './potatoes';

  let {
    kind,
    size = 96,
    asleep = false,
    face: faceProp = 'happy',
    shadow = true,
    still = false,
    delay = 0,
  }: {
    kind: PotatoKind;
    size?: number;
    /** Dozing: eyes shut and a few Zs. Used for players whose phone dropped. */
    asleep?: boolean;
    /** Expression; `asleep` wins. The sofa scene swaps faces for blinks and hard landings. */
    face?: PotatoFace;
    /** The ground shadow under the potato. The sofa scene draws its own. */
    shadow?: boolean;
    /** No idle wobble or blinking, e.g. in tight lists. */
    still?: boolean;
    /** Seconds to offset the idle loop, so a sofa of potatoes doesn't breathe in unison. */
    delay?: number;
  } = $props();

  const uid = $props.id();

  const look = $derived(POTATO_LOOKS[kind] ?? POTATO_LOOKS.boiled);
  const f = $derived(look.face);
  const face = $derived<PotatoFace>(asleep ? 'sleep' : faceProp);
</script>

<svg
  class="potato"
  class:still
  viewBox="0 0 100 100"
  width={size}
  height={size}
  role="img"
  aria-label="{potatoName(kind)} potato{face === 'sleep' ? ', dozing' : ''}"
  style:--delay="{delay}s"
>
  <defs>
    <clipPath id="{uid}-clip"><path d={look.body} /></clipPath>
  </defs>

  <!-- Ground shadow stays put while the potato wobbles above it. -->
  {#if shadow}<ellipse class="shadow" cx="50" cy="92" rx="30" ry="5" />{/if}

  <g class="wobble">
    <g transform="rotate({look.tilt ?? 0} 50 56)">
      {#if kind === 'boiled' && face !== 'sleep'}
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
        {#if face === 'sleep'}
          <g fill="none" stroke="var(--potato-eye)" stroke-width="2.6" stroke-linecap="round">
            <path d="M-12 -1 q4 3 8 0" /><path d="M4 -1 q4 3 8 0" />
          </g>
          <path d="M-3 9 q3 1.5 6 0" fill="none" stroke="var(--potato-eye)" stroke-width="2.2" stroke-linecap="round" />
        {:else if face === 'ouch'}
          <!-- Squeezed shut, mouth wide open: the face of a potato meeting a cushion at speed. -->
          <g fill="none" stroke="var(--potato-eye)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M-13 -6 l6 4 l-6 4" /><path d="M13 -6 l-6 4 l6 4" />
          </g>
          <ellipse cx="0" cy="9" rx="4.5" ry="5.5" fill="var(--potato-eye)" />
        {:else if face === 'blink'}
          <g fill="none" stroke="var(--potato-eye)" stroke-width="2.6" stroke-linecap="round">
            <path d="M-12 -2 q4 -3 8 0" /><path d="M4 -2 q4 -3 8 0" />
          </g>
          <path d="M-6 7 q6 6 12 0" fill="none" stroke="var(--potato-eye)" stroke-width="2.6" stroke-linecap="round" />
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

  {#if face === 'sleep'}
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
