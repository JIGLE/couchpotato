// Shared contracts between the server, the TV and the phones.
// Keep this file types-only (no runtime code) so both sides can `import type` it.

export type Screen = 'tv' | 'phone';

/** Events the server sends to clients. */
export interface ServerToClient {
  /** Phase 0 smoke test: total taps across all phones. */
  'tap:count': (payload: { count: number; lastBy: string | null }) => void;
  /** How many phones and TVs are connected right now. */
  'presence': (payload: { tvs: number; phones: number }) => void;
}

/** Events clients send to the server. */
export interface ClientToServer {
  /** A client announces what it is right after connecting. */
  'hello': (payload: { screen: Screen; name?: string }) => void;
  /** Phase 0 smoke test: a phone taps the big button. */
  'tap': () => void;
}

/** The WebSocket path both sides use. Mirror of the literal '/ws' in server and web. */
export type SocketPath = '/ws';
