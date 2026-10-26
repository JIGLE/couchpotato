# Roadmap

Each phase ends with something you can actually play. Make one GitHub **milestone** per phase
and keep at most **2 cards in "Doing"** at a time. Ideas that don't belong to the current phase go
to the **Later** milestone.

Design reference for every screen: the *Couch Potato — Lobby & Join* canvas.

## Phase 0 · Foundations — *1 weekend*
- [x] Repo scaffold, CI and image publishing
- [x] `package-lock.json` committed, CI uses `npm ci`
- [x] Run the container on TrueNAS (see `docs/DEPLOY.md`)
- [x] Cloudflare tunnel route → `http://<truenas-ip>:3000`
- [x] **Done when:** the TV at `/tv` counts taps live from two phones over the tunnel, and survives a phone going to sleep and waking up

## Phase 1 · Join & lobby — *1–2 weeks*
- [x] Rooms: create, 4-letter codes (no 0/O, 1/I), expire when empty for 30 min
- [x] TV lobby screen (QR + code + avatars + open seats)
- [x] Phone join: code (pre-filled from QR), name, cushion colour
- [x] Silent rejoin after refresh or network blip (session token in localStorage)
- [x] Edge states: wrong code, room full (joined mid-game moves to Phase 2)
- [x] **Done when:** 4 phones join in under 10 s each; refreshing a phone rejoins without retyping

## Phase 2 · First game: Trivia — *2–3 weeks*
- [x] Question pack format (JSON, en / pt-PT / es-ES, age + region tags) + starter pack — see `docs/PACKS.md`
- [x] Server-authoritative timer and scoring (speed bonus, streaks, early end when everyone answered)
- [ ] TV question → reveal → leaderboard → podium
- [ ] Phone answer grid, lock-in, round result
- [ ] **Done when:** a full 10-round game with friends, no restarts

## Phase 3 · Host & admin — *1–2 weeks*
- [ ] Persistent storage in `/data` (SQLite)
- [ ] Host accounts: hashed passwords, rate-limited login, 30-day remember-me
- [ ] TV "ready to host" screen + screen-code unlock
- [ ] Host remote: pause, +10 s, skip, kick, hand over, end
- [ ] Admin page: invite codes, revoke hosts, live rooms
- [ ] **Done when:** only invited hosts can open a lobby; players still need no account

## Phase 4 · Game modules + Liar's Dice — *2–3 weeks*
- [ ] Extract the module contract (manifest, settings schema, rules, per-player view, 3 views)
- [ ] Port Trivia onto it
- [ ] Build Liar's Dice on it (private hand + turns)
- [ ] Game picker + setup screen rendered from the settings schema
- [ ] **Done when:** adding Liar's Dice touched no platform code

## Phase 5 · Polish — *ongoing*
- [ ] Moods selectable per game, ambient layer, motion spec
- [ ] Sound (TV) + haptics (phones), mute on host remote
- [ ] Low-power mode for old smart-TV browsers
- [ ] More games: Bingo, a dial game, a team word game
