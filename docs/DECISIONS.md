# Decisions

One line per decision: date · what · why. Add new ones at the bottom; never edit old ones —
write a new line that supersedes it instead.

- 2026-10-25 · Name **Couch Potato**, logo direction **A (spud on the sofa)** · warmest, reads at 16 px
- 2026-10-25 · Four colour moods (Lamp Light default, Velvet Couch, Midnight Snack, Sunday Afternoon) · host picks per game night
- 2026-10-25 · TV is the board, phone is the controller; question text never on phones · eyes stay on the shared screen
- 2026-10-25 · Players need no account; only hosts sign in (invite-only, admin-controlled) · controlled number of lobby creators at the start
- 2026-10-25 · TypeScript everywhere, npm workspaces monorepo (`apps/server`, `apps/web`, `packages/shared`) · one language, shared event types
- 2026-10-25 · Server: Fastify + Socket.IO · built-in reconnects and rooms; WebSockets work through Cloudflare Tunnel
- 2026-10-25 · Web: Svelte 5 + Vite · small bundles for weak smart-TV browsers, easy animation
- 2026-10-25 · Server is authoritative for timers, scores and hidden information · fairness; phones only send intents
- 2026-10-25 · One Docker image published to GHCR, run on TrueNAS SCALE · matches the self-hosted setup
- 2026-10-25 · Socket.IO ping every 20 s · stays well inside Cloudflare's ~100 s idle timeout
- 2026-10-25 · Game names are our own; mechanics are borrowed, trademarks are not · avoid IP trouble
- 2026-10-26 · Compose uses `pull_policy: always`; updating = Stop → Start in TrueNAS · TrueNAS reused the cached `:latest` image and needed a full reinstall
- 2026-10-26 · A dropped phone keeps its seat for 2 minutes; the server issues a private rejoin token, players are shown by a separate public id · refresh or Wi-Fi blips should not cost a seat, and tokens must never leak to other screens
