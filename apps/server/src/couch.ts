// Who sits where in one room, and how long a seat is held after a phone drops.
// Kept free of Socket.IO so it can be unit-tested.

import { randomBytes } from 'node:crypto';
import type { CushionColour, Player } from '@couchpotato/shared';
import { MAX_SEATS, cushion, freeSeat } from './rooms.js';

/** A dropped phone keeps its seat this long. */
export const HOLD_MS = 2 * 60 * 1000;

/** Tokens are 32 hex characters. Anything else from a phone is ignored and a fresh one is issued. */
const TOKEN_RE = /^[a-f0-9]{32}$/;

export function newToken(): string {
  return randomBytes(16).toString('hex');
}

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

interface Seated {
  /** Private: only the owning phone knows it. */
  token: string;
  /** Public: shown to the TV and other phones. */
  id: string;
  name: string;
  seat: number;
  colour: CushionColour;
  socketId: string | null;
  awaySince: number | null;
}

export type SitResult = { ok: true; player: Player; token: string; rejoined: boolean } | { ok: false; reason: 'full' };

export class Couch {
  private byToken = new Map<string, Seated>();

  constructor(
    private now: () => number = Date.now,
    private makeToken: () => string = newToken,
    private seats = MAX_SEATS,
  ) {}

  /**
   * Sit a phone down. A known token gets its old seat back (and keeps its colour);
   * otherwise the phone takes the lowest free seat. Away players still hold their seats.
   */
  sit(token: unknown, socketId: string, name: string, colour: unknown): SitResult {
    const known = isToken(token) ? this.byToken.get(token) : undefined;
    if (known) {
      known.socketId = socketId;
      known.awaySince = null;
      known.name = name || known.name;
      return { ok: true, player: toPlayer(known), token: known.token, rejoined: true };
    }

    const seat = freeSeat([...this.byToken.values()].map((p) => p.seat), this.seats);
    if (seat === -1) return { ok: false, reason: 'full' };

    const seated: Seated = {
      token: this.makeToken(), // always ours; a phone never picks its own token
      id: this.makeToken().slice(0, 12),
      name,
      seat,
      colour: cushion(colour, seat),
      socketId,
      awaySince: null,
    };
    this.byToken.set(seated.token, seated);
    return { ok: true, player: toPlayer(seated), token: seated.token, rejoined: false };
  }

  /** The phone's connection dropped. Hold the seat. Ignores sockets that were already replaced. */
  drop(socketId: string): boolean {
    const p = this.bySocket(socketId);
    if (!p) return false;
    p.socketId = null;
    p.awaySince = this.now();
    return true;
  }

  /** The phone left on purpose. Free the seat now. */
  leave(socketId: string): boolean {
    const p = this.bySocket(socketId);
    if (!p) return false;
    this.byToken.delete(p.token);
    return true;
  }

  /** Free seats whose phones have been away longer than HOLD_MS. Returns true if anything changed. */
  sweep(): boolean {
    let changed = false;
    const t = this.now();
    for (const [token, p] of this.byToken) {
      if (p.awaySince !== null && t - p.awaySince >= HOLD_MS) {
        this.byToken.delete(token);
        changed = true;
      }
    }
    return changed;
  }

  player(socketId: string): Player | undefined {
    const p = this.bySocket(socketId);
    return p && toPlayer(p);
  }

  list(): Player[] {
    return [...this.byToken.values()].map(toPlayer).sort((a, b) => a.seat - b.seat);
  }

  private bySocket(socketId: string): Seated | undefined {
    for (const p of this.byToken.values()) if (p.socketId === socketId) return p;
    return undefined;
  }
}

function toPlayer(p: Seated): Player {
  return { id: p.id, name: p.name, seat: p.seat, colour: p.colour, away: p.awaySince !== null };
}
