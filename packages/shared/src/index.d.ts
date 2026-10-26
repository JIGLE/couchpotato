// Shared contracts between the server, the TV and the phones.
// Keep this file types-only (no runtime code) so both sides can `import type` it.

export type Screen = 'tv' | 'phone';

export type RoomError = 'not-found' | 'full' | 'bad-request';

/** Number of cushion colours a player can pick (the four tile colours of the mood). */
export type CushionColour = 0 | 1 | 2 | 3;

/** A phone sitting on the couch. `seat` is 0-based; `colour` is the cushion they picked. */
export interface Player {
  /** Public id, safe to show to everyone. Never the rejoin token. */
  id: string;
  name: string;
  seat: number;
  colour: CushionColour;
  /** Connection dropped; the seat is held for a couple of minutes in case they come back. */
  away: boolean;
}

/** Events the server sends to clients. */
export interface ServerToClient {
  /** A TV asked for a room; this is its code. */
  'room:created': (payload: { code: string }) => void;
  /**
   * A phone (or a reconnecting TV) is now in the room.
   * Phones also get their public `playerId` and a private `token` to reclaim the seat after a refresh.
   */
  'room:joined': (payload: { code: string; playerId?: string; token?: string }) => void;
  /** Joining failed, e.g. a mistyped code. */
  'room:error': (payload: { reason: RoomError; code: string }) => void;
  /** Everyone on the couch, in seat order, plus how many seats the room has. */
  'room:players': (payload: { players: Player[]; seats: number }) => void;
  /** Phase 0 smoke test: taps in this room. `lastById` lets the TV wiggle that player's avatar. */
  'tap:count': (payload: { count: number; lastBy: string | null; lastById: string | null }) => void;
  /** How many phones and TVs are in this room right now. */
  'presence': (payload: { tvs: number; phones: number }) => void;
}

/** Events clients send to the server. */
export interface ClientToServer {
  /**
   * A client announces itself right after connecting.
   * - TV without `code`: create a new room.
   * - TV with `code`: reconnect to its room (a new room is made if it expired).
   * - Phone: must send the `code` it wants to join.
   */
  'hello': (payload: { screen: Screen; code?: string; name?: string; colour?: CushionColour; token?: string }) => void;
  /** A phone gets up from the couch on purpose; its seat frees straight away. */
  'leave': () => void;
  /** Phase 0 smoke test: a phone taps the big button. */
  'tap': () => void;
}

/** The WebSocket path both sides use. Mirror of the literal '/ws' in server and web. */
export type SocketPath = '/ws';

// ---------------------------------------------------------------------------
// Trivia packs. Documented for people (and future AI generation) in docs/PACKS.md.
// ---------------------------------------------------------------------------

/** Languages a pack can be written in. BCP 47 tags; European variants on purpose. */
export type Language = 'en' | 'pt-PT' | 'es-ES';

/** Text in one or more languages. A question is playable in a language only if all its texts have it. */
export type Localized<T = string> = Partial<Record<Language, T>>;

/** Who wrote a question. AI-written questions stay out of games until a person marks them reviewed. */
export type QuestionSource = 'manual' | 'ai';

export interface TriviaQuestion {
  /** Stable within the pack, e.g. "chess-squares". Used to avoid repeats and to report mistakes. */
  id: string;
  category: string;
  /** Youngest age this question suits. Omitted = everyone. */
  minAge?: number;
  /** ISO 3166-1 alpha-2 countries the question is about, e.g. ["PT"]. Omitted or empty = global. */
  regions?: string[];
  text: Localized;
  /** 2–4 answers per language, in the same order in every language. */
  answers: Localized<string[]>;
  /** Index into `answers` of the right one. Answers are shuffled when played. */
  correct: number;
  /** Optional one-liner shown on the reveal screen. */
  fact?: Localized;
  source?: QuestionSource;
  /** Required for `source: "ai"` before the question is used in a game. */
  reviewed?: boolean;
}

export interface TriviaPack {
  /** Format marker and version, so old packs keep working when the format grows. */
  format: 'couchpotato.trivia/1';
  /** Unique, lowercase, e.g. "starter". */
  id: string;
  title: Localized;
  description?: Localized;
  author: string;
  /** e.g. "CC-BY-4.0". Shared packs need one so other hosts know what they may do with them. */
  license?: string;
  /** Whether other hosts can find and use this pack once the shared library exists. */
  visibility?: 'private' | 'shared';
  tags?: string[];
  questions: TriviaQuestion[];
}

/** What the server lists about a pack (GET /api/packs). */
export interface PackSummary {
  id: string;
  title: Localized;
  description?: Localized;
  author: string;
  languages: Language[];
  questions: number;
  categories: string[];
  regions: string[];
  visibility: 'private' | 'shared';
}
