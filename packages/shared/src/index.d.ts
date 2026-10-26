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
