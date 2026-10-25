# Notes for Claude

- Monorepo with npm workspaces: `apps/server` (Fastify + Socket.IO), `apps/web` (Svelte 5 + Vite), `packages/shared` (types only — keep it free of runtime code).
- The server is authoritative for timers, scores and hidden information. Phones send intents, never results.
- Socket events are typed in `packages/shared/src/index.d.ts`. Add new events there first.
- Styling uses CSS custom properties from `apps/web/src/styles/tokens.css` (mirrors the Couch Potato design system). Never hard-code colours in components; moods switch via `<html data-mood>`.
- TV text is never below 32px; phone tap targets are at least 88px tall for answers, 56px for buttons.
- Check `docs/ROADMAP.md` for the current phase and `docs/DECISIONS.md` before changing direction; append a line when a decision changes.
- Verify with `npm run typecheck && npm run build`.
