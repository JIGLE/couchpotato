// Claim codes: a TV with no room shows one as a QR (and as text to type), and the first host phone to
// send it opens a room on that TV. Codes renew every minute and work once, so a photo of the screen
// can't be used later. Kept free of Socket.IO so it can be unit-tested.

import { randomInt } from 'node:crypto';
import { CODE_ALPHABET } from './rooms.js';

export const CLAIM_CODE_LENGTH = 6;
/** A new code every minute; the previous one keeps working until the next renewal, so a scan at the boundary still lands. */
export const RENEW_MS = 60 * 1000;

export function newClaimCode(): string {
  return Array.from({ length: CLAIM_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** What a person typed (or the QR carried): upper-case, letters and digits only. */
export function normaliseClaim(input: unknown): string {
  return typeof input === 'string' ? input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CLAIM_CODE_LENGTH) : '';
}

export interface Pairing {
  code: string;
  /** When this code is replaced. It still works for one more period after that. */
  renewsAt: number;
}

interface Waiting {
  current: string;
  previous: string | null;
  renewsAt: number;
}

export class Pairings {
  /** TV socket id → its codes. */
  private tvs = new Map<string, Waiting>();
  /** Code → TV socket id. */
  private codes = new Map<string, string>();

  constructor(
    private now: () => number = Date.now,
    private makeCode: () => string = newClaimCode,
  ) {}

  /** Give a waiting TV a fresh code (dropping any it had). */
  issue(tvId: string): Pairing {
    this.drop(tvId);
    const code = this.unique();
    const renewsAt = this.now() + RENEW_MS;
    this.tvs.set(tvId, { current: code, previous: null, renewsAt });
    this.codes.set(code, tvId);
    return { code, renewsAt };
  }

  /** Renew every code that is due. Returns the TVs that need to show a new one. */
  renew(): [tvId: string, pairing: Pairing][] {
    const t = this.now();
    const renewed: [string, Pairing][] = [];
    for (const [tvId, w] of this.tvs) {
      if (t < w.renewsAt) continue;
      if (w.previous) this.codes.delete(w.previous);
      w.previous = w.current;
      w.current = this.unique();
      w.renewsAt = t + RENEW_MS;
      this.codes.set(w.current, tvId);
      renewed.push([tvId, { code: w.current, renewsAt: w.renewsAt }]);
    }
    return renewed;
  }

  /** Use a code. Returns the TV it belonged to; every code of that TV stops working. */
  claim(code: unknown): string | undefined {
    const tvId = this.codes.get(normaliseClaim(code));
    if (tvId) this.drop(tvId);
    return tvId;
  }

  /** The TV left or got a room: forget its codes. */
  drop(tvId: string): void {
    const w = this.tvs.get(tvId);
    if (!w) return;
    this.codes.delete(w.current);
    if (w.previous) this.codes.delete(w.previous);
    this.tvs.delete(tvId);
  }

  has(tvId: string): boolean {
    return this.tvs.has(tvId);
  }

  private unique(): string {
    for (let i = 0; i < 100; i++) {
      const code = this.makeCode();
      if (!this.codes.has(code)) return code;
    }
    throw new Error('Could not find a free claim code');
  }
}
