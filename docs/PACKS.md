# Question packs

A pack is one JSON file of trivia questions. The bundled ones live in `apps/server/packs/`;
from Phase 3 hosts can add their own, and later share them with other hosts.

The exact types are `TriviaPack` and `TriviaQuestion` in `packages/shared/src/index.d.ts`.
`apps/server/packs/starter.json` is a complete example.

## A pack

```json
{
  "format": "couchpotato.trivia/1",
  "id": "board-game-night",
  "title": { "en": "Board game night", "pt-PT": "Noite de jogos", "es-ES": "Noche de juegos" },
  "description": { "en": "All about classic board games." },
  "author": "Jose",
  "license": "CC-BY-4.0",
  "visibility": "private",
  "tags": ["board-games"],
  "questions": [ ... ]
}
```

- **id** — lowercase letters, digits and dashes. Unique across all packs.
- **visibility** — `private` (default) or `shared`. Shared packs must have a **license** so other
  hosts know what they may do with them.

## A question

```json
{
  "id": "porto-river",
  "category": "geography",
  "minAge": 12,
  "regions": ["PT"],
  "text":    { "en": "Which river flows through Porto?", "pt-PT": "Que rio passa pelo Porto?" },
  "answers": { "en": ["Tagus", "Douro", "Mondego", "Guadiana"], "pt-PT": ["Tejo", "Douro", "Mondego", "Guadiana"] },
  "correct": 1,
  "fact":    { "en": "It begins in Spain, where it is called the Duero.", "pt-PT": "Nasce em Espanha, onde se chama Duero." },
  "source": "manual"
}
```

| Field | Meaning |
| --- | --- |
| `text`, `answers` | The question and 2–4 answers in each language. Answers are in the **same order in every language**. |
| `correct` | Which answer is right, counting from 0. Answers are shuffled when the game plays them. |
| `minAge` | Youngest player this suits. Leave it out for "everyone". |
| `regions` | Two-letter country codes the question is about (`PT`, `ES`, `DK` …). Leave it out for global questions. |
| `fact` | Optional one-liner shown when the answer is revealed. |
| `source` | `manual` or `ai`. AI-written questions are only played once `reviewed` is `true`. |

## How a game picks questions

The host sets three things for the evening:

1. **Language** — `en`, `pt-PT` or `es-ES`. Only questions written in that language are used.
2. **Youngest player** — questions with a higher `minAge` are left out.
3. **Countries** — global questions are always in; regional ones only for the countries picked.

Questions played recently are skipped, so a second game the same night feels fresh.

A question with a mistake (wrong answer, missing translation, duplicate answers) is left out with
a warning in the server log; the rest of the pack still loads. A pack with a broken header is
skipped entirely, never crashing the server.

## Writing good questions

- One clear fact, no trick wording. Four answers that are all believable.
- Keep the TV in mind: a question should fit in two lines at 56 px (roughly 70 characters).
- Translate meaning, not words: use the names people actually say in that country
  (Douro / Duero, Gata Borralheira / Cenicienta).
- Prefer facts that don't go out of date ("who holds the record…" ages badly).

## Coming later

- **Your own packs** (Phase 3): upload or edit packs in the admin page; stored in `/data/packs`.
- **AI-generated packs**: describe a theme, audience and language; the app drafts a pack with
  `source: "ai"`, you edit and approve questions one by one before they can be played.
- **Shared library**: publish a pack as `shared`; other hosts search by language, age, region and
  tags, preview it, and import a copy they can edit.
