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
- 2026-10-26 · Game languages: English, European Portuguese (pt-PT), Spanish of Spain (es-ES); not Danish · the players' languages
- 2026-10-26 · One pack holds all translations of a question; a game is played in one language · packs stay shareable and the same questions work for every group
- 2026-10-26 · Audience filters are youngest age (`minAge`) and countries (`regions`); global questions always count · simple for the host, enough to make games fit the group
- 2026-10-26 · AI-written questions (`source: "ai"`) are never played until a person marks them reviewed · AI makes mistakes; a wrong answer on the TV spoils the game
- 2026-10-26 · Shared packs need a license · other hosts must know what they may do with them
- 2026-10-26 · The mood belongs to the room: the TV sets it, phones follow · answer tiles must be the same colours on every screen
- 2026-10-26 · TV screens are laid out on a fixed 1280×720 stage scaled to fit the display · identical layout on any TV, projector or laptop, nothing cropped
- 2026-10-28 · Late joiners sit out until the next question starts, whether they arrive during a question, reveal or leaderboard; nobody joins at the podium; players who leave stay on the leaderboard greyed out · a fair start from the average score, and the final podium only shows people who played
