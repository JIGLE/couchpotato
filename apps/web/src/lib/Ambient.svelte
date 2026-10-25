<!-- Lamp glow, a drifting blob and fine grain: the cosy background layer for TV screens. -->
<div class="ambient" aria-hidden="true">
  <div class="glow"></div>
  <div class="blob"></div>
  <svg class="grain" width="100%" height="100%">
    <filter id="cp-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /></filter>
    <rect width="100%" height="100%" filter="url(#cp-grain)" />
  </svg>
</div>

<style>
  .ambient { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
  .glow {
    position: absolute; width: 55vw; height: 55vw; left: -15vw; top: -30vw;
    border-radius: 50%; background: var(--glow); filter: blur(90px);
    animation: breathe 8s ease-in-out infinite;
  }
  .blob {
    position: absolute; width: 36vw; height: 26vw; right: -10vw; bottom: -14vw;
    border-radius: 60% 40% 55% 45%; background: var(--blob); filter: blur(80px);
    animation: drift 30s ease-in-out infinite alternate;
  }
  .grain { position: absolute; inset: 0; opacity: 0.07; }
  @keyframes breathe { 50% { opacity: 0.85; } }
  @keyframes drift { to { transform: translate(-20px, -20px) rotate(6deg); } }
  @media (prefers-reduced-motion: reduce) { .glow, .blob { animation: none; } }
</style>
