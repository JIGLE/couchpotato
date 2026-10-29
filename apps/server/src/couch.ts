// Who sits where in one room, and how long a seat is held after a phone drops.
// Kept free of Socket.IO so it can be unit-tested.

import { randomBytes } from 'node:crypto';
import type { CushionColour, Player, PotatoKind, Role } from '@couchpotato/shared';
import { MAX_SEATS, allKindsUsed, cushion, freePotato, freeSeat, isPotato } from './rooms.js';

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
  potato: PotatoKind;
  /** Order of arrival; the earliest one still seated is the Head Spud. */
  arrived: number;
  socketId: string | null;
  awaySince: number | null;
}

export type SitResult = { ok: true; player: Player; token: string; rejoined: boolean } | { ok: false; reason: 'full' };

export class Couch {
  private byToken = new Map<string, Seated>();
  private arrivals = 0;
  /** Token of the phone that claimed the TV (or was handed the role). Null until someone has. */
  private crowned: string | null = null;

  constructor(
    private now: () => number = Date.now,
    private makeToken: () => string = newToken,
    private seats = MAX_SEATS,
  ) {}

  /**
   * Sit a phone down. A known token gets its old seat back (and keeps its colour and potato);
   * otherwise the phone takes the lowest free seat and the potato it asked for, or a free one if that is taken
   * (once all eight kinds are in use, kinds repeat).
   * Away players still hold their seats and potatoes.
   */
  sit(token: unknown, socketId: string, name: string, colour: unknown, potato?: unknown): SitResult {
    const known = isToken(token) ? this.byToken.get(token) : undefined;
    if (known) {
      known.socketId = socketId;
      known.awaySince = null;
      known.name = name || known.name;
      return { ok: true, player: this.toPlayer(known), token: known.token, rejoined: true };
    }

    const seat = freeSeat([...this.byToken.values()].map((p) => p.seat), this.seats);
    const kind = freePotato(potato, this.takenPotatoes());
    if (seat === -1) return { ok: false, reason: 'full' };

    const seated: Seated = {
      token: this.makeToken(), // always ours; a phone never picks its own token
      id: this.makeToken().slice(0, 12),
      name,
      seat,
      colour: cushion(colour, seat),
      potato: kind,
      arrived: this.arrivals++,
      socketId,
      awaySince: null,
    };
    this.byToken.set(seated.token, seated);
    return { ok: true, player: this.toPlayer(seated), token: seated.token, rejoined: false };
  }

  /** Swap this phone's potato for one nobody else has (any kind, once all eight are in use). Returns true if it changed. */
  pick(socketId: string, potato: unknown): boolean {
    const p = this.bySocket(socketId);
    if (!p || !isPotato(potato) || p.potato === potato) return false;
    const taken = this.takenPotatoes();
    if (taken.includes(potato) && !allKindsUsed(taken)) return false;
    p.potato = potato;
    return true;
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
    return p && this.toPlayer(p);
  }

  list(): Player[] {
    return [...this.byToken.values()].map((p) => this.toPlayer(p)).sort((a, b) => a.seat - b.seat);
  }

  /** Make this phone the Head Spud: the host who claimed the TV, or a host coming back to their room. */
  crown(socketId: string): boolean {
    const p = this.bySocket(socketId);
    if (!p) return false;
    this.crowned = p.token;
    return true;
  }

  /**
   * The Head Spud: the phone that claimed the TV. A dropped Head Spud keeps the role while their seat is held;
   * once they leave (or are swept) it passes to whoever has been on the couch longest, so the night goes on.
   */
  isHeadSpud(socketId: string): boolean {
    const p = this.bySocket(socketId);
    return !!p && p === this.headSpud();
  }

  private headSpud(): Seated | undefined {
    const crowned = this.crowned ? this.byToken.get(this.crowned) : undefined;
    if (crowned) return crowned;
    let first: Seated | undefined;
    for (const p of this.byToken.values()) if (!first || p.arrived < first.arrived) first = p;
    return first;
  }

  private toPlayer(p: Seated): Player {
    const role: Role = p === this.headSpud() ? 'head-spud' : 'potato';
    return { id: p.id, name: p.name, seat: p.seat, colour: p.colour, potato: p.potato, role, away: p.awaySince !== null };
  }

  private takenPotatoes(): PotatoKind[] {
    return [...this.byToken.values()].map((p) => p.potato);
  }

  private bySocket(socketId: string): Seated | undefined {
    for (const p of this.byToken.values()) if (p.socketId === socketId) return p;
    return undefined;
  }
}
