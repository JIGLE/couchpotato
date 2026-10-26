// Shared contracts between the server, the TV and the phones.
// Keep this file types-only (no runtime code) so both sides can `import type` it.

export type Screen = 'tv' | 'phone';

export type RoomError = 'not-found' | 'bad-request';

/** Events the server sends to clients. */
export interface ServerToClient {
  /** A TV asked for a room; this is its code. */
  'room:created': (payload: { code: string }) => void;
  /** A phone (or a reconnecting TV) is now in the room. */
  'room:joined': (payload: { code: string }) => void;
  /** Joining failed, e.g. a mistyped code. */
  'room:error': (payload: { reason: RoomError; code: string }) => void;
  /** Phase 0 smoke test: taps in this room. */
  'tap:count': (payload: { count: number; lastBy: string | null }) => void;
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
  'hello': (payload: { screen: Screen; code?: string; name?: string }) => void;
  /** Phase 0 smoke test: a phone taps the big button. */
  'tap': () => void;
}

/** The WebSocket path both sides use. Mirror of the literal '/ws' in server and web. */
export type SocketPath = '/ws';
