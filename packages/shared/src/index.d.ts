// Shared contracts between the server, the TV and the phones.
// Keep this file types-only (no runtime code) so both sides can `import type` it.

export type Screen = 'tv' | 'phone';

export type RoomError = 'not-found' | 'full' | 'bad-request';

/** The room's colour mood. Set on the TV; every phone in the room follows it so tile colours always match. */
export type Mood = 'lamp' | 'velvet' | 'midnight' | 'sunday';

/** Number of cushion colours a player can pick (the four tile colours of the mood). */
export type CushionColour = 0 | 1 | 2 | 3;

/** The potato characters. Each room uses every kind once before any repeats (rooms seat up to twelve). */
export type PotatoKind = 'boiled' | 'grilled' | 'chip' | 'fry' | 'mashed' | 'jacket' | 'hashbrown' | 'sweet';

/**
 * Who runs the night. The Head Spud picks the game and starts it from their phone; everyone else is a potato.
 * Until host accounts exist, the first phone on the couch is the Head Spud and the role passes on when they leave.
 */
export type Role = 'head-spud' | 'potato';

/** A phone sitting on the couch. `seat` is 0-based; `colour` is the cushion they picked; `potato` is who they play as. */
export interface Player {
  /** Public id, safe to show to everyone. Never the rejoin token. */
  id: string;
  name: string;
  seat: number;
  colour: CushionColour;
  potato: PotatoKind;
  role: Role;
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
  /** The room's mood changed (or you just joined). Phones restyle to match the TV. */
  'room:mood': (payload: { mood: Mood }) => void;
  /** Everyone on the couch, in seat order, plus how many seats the room has. */
  'room:players': (payload: { players: Player[]; seats: number }) => void;
  /** Phase 0 smoke test: taps in this room. `lastById` lets the TV wiggle that player's avatar. */
  'tap:count': (payload: { count: number; lastBy: string | null; lastById: string | null }) => void;
  /** How many phones and TVs are in this room right now. */
  'presence': (payload: { tvs: number; phones: number }) => void;
  /** The game as this screen should see it. `null` = no game, show the lobby. Each phone gets its own view. */
  'game:state': (view: GameView | null) => void;
  /** What the Head Spud is setting up, so the TV can show it while they choose. `null` = nothing yet. */
  'lobby:setup': (payload: { settings: GameSettings | null }) => void;
  /** Starting a game failed. */
  'game:error': (payload: { reason: 'no-questions' | 'no-players' }) => void;
}

/** Events clients send to the server. */
export interface ClientToServer {
  /**
   * A client announces itself right after connecting.
   * - TV without `code`: create a new room.
   * - TV with `code`: reconnect to its room (a new room is made if it expired).
   * - Phone: must send the `code` it wants to join. A `potato` that is taken is swapped for a free one.
   */
  'hello': (payload: { screen: Screen; code?: string; name?: string; colour?: CushionColour; potato?: PotatoKind; token?: string; mood?: Mood }) => void;
  /** The TV or the Head Spud changes the room's mood. */
  'room:mood': (payload: { mood: Mood }) => void;
  /** A phone swaps to another potato. Only in the lobby, and only to one nobody else is playing. */
  'potato:pick': (payload: { potato: PotatoKind }) => void;
  /** A phone gets up from the couch on purpose; its seat frees straight away. */
  'leave': () => void;
  /** Phase 0 smoke test: a phone taps the big button. */
  'tap': () => void;
  /** The Head Spud shares the settings they are choosing, before starting. */
  'lobby:setup': (settings: Partial<GameSettings>) => void;
  /** The Head Spud starts a game with these settings; missing ones use defaults. */
  'game:start': (settings: Partial<GameSettings>) => void;
  /** A phone picks an answer (index into the question's answers). Only the first pick counts. */
  'game:answer': (payload: { choice: number }) => void;
  /** The Head Spud sends everyone back to the lobby. */
  'game:end': () => void;
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

// ---------------------------------------------------------------------------
// Trivia game. The server decides everything; screens only render these views.
// ---------------------------------------------------------------------------

export interface GameSettings {
  language: Language;
  /** Number of questions. 1–30, default 10. */
  rounds: number;
  /** Seconds to answer: 10, 20 or 30; 0 = no limit (ends when everyone has answered). */
  seconds: number;
  /** Youngest player's age; questions for older players are left out. */
  youngest?: number;
  /** Countries for regional questions, e.g. ["PT", "ES"]. */
  regions?: string[];
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  /** 1 = first. Players with the same score share a rank. */
  rank: number;
  /** Places gained (+) or lost (−) since the previous leaderboard. */
  moved: number;
  /** Right answers in a row. */
  streak: number;
  /** Points from the last question (0 if wrong or no answer). */
  lastPoints: number;
  /** Not connected right now (dropped or left). They keep their score; the TV greys them out. */
  away: boolean;
}

/** Timing: `endsAt` and `serverNow` are server clock milliseconds; screens use the difference. */
interface Timed {
  endsAt: number | null;
  serverNow: number;
}

export type GameView =
  | (Timed & {
      phase: 'question';
      round: number;
      rounds: number;
      category: string;
      /** TV only: phones never show the question. */
      text?: string;
      /** TV only. */
      answers?: string[];
      /** How many answer tiles to show (2–4). */
      choices: number;
      answered: number;
      players: number;
      /** Phone only: what this phone picked, or null. Absent on the TV. */
      myChoice?: number | null;
      /** Phone only: false for someone who joined mid-question and plays from the next one. */
      canAnswer?: boolean;
    })
  | (Timed & {
      phase: 'reveal';
      round: number;
      rounds: number;
      text?: string;
      answers?: string[];
      choices: number;
      correct: number;
      /** For each answer, the public ids of the players who picked it. */
      pickedBy: string[][];
      fact?: string;
      /** Phone only. */
      me?: Standing & { choice: number | null; correct: boolean };
      /** Phone only: true for someone who joined after this question started; they play from the next one. */
      waiting?: boolean;
    })
  | (Timed & {
      phase: 'leaderboard';
      round: number;
      rounds: number;
      standings: Standing[];
      /** Phone only: true for someone who hasn't played a question yet; they play from the next one. */
      waiting?: boolean;
    })
  | { phase: 'podium'; rounds: number; standings: Standing[]; serverNow: number };
