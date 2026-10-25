# couch potato

Self-hosted, Kahoot-style board-game nights. **The TV is the board, every phone is a controller,
and nobody has to get up.**

Runs as one Docker container (built for TrueNAS SCALE) behind a Cloudflare tunnel. Players join by
scanning a QR code — no accounts, no app install. Only invited hosts can start a lobby.

> Status: **Phase 0 · Foundations** — a live tap counter that proves TV ↔ phone sync over the tunnel.
> See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Quick start (development)

```bash
nvm use            # Node 22
npm install
npm run dev        # server on :3000, web on :5173
```

- TV: <http://localhost:5173/tv>
- Phone: `http://<your-computer-ip>:5173/` on the same Wi-Fi
- Try a mood: `/tv?mood=velvet` · `midnight` · `sunday`

## Project layout

```
apps/
  server/     Fastify + Socket.IO — rooms, timers, scores (authoritative)
  web/        Svelte 5 + Vite — TV, phone, host and admin screens
packages/
  shared/     Event and game contracts shared by both sides (types only)
docs/
  ROADMAP.md     phases, milestones, "done when"
  DECISIONS.md   one line per decision, with the why
  DEPLOY.md      TrueNAS + Cloudflare Tunnel
```

## Deploy

Push to `main` → GitHub Actions publishes `ghcr.io/jigle/couchpotato:latest` → pull it on TrueNAS.
Full steps in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## How we work

- Every task is a GitHub issue with a **Done when**, sized for one sitting.
- Board: *Backlog → Next → Doing (max 2) → Done*. One milestone per phase.
- 15-minute review every Sunday: close what's done, pick 2–4 cards for the week.
- New ideas go to the **Later** milestone, not into the current phase.

## License

Apache-2.0
