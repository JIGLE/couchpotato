import type { CushionColour } from '@couchpotato/shared';

// Room bookkeeping, kept free of Socket.IO so it can be unit-tested.

/** No 0/O or 1/I — they are easy to misread on a TV across the room. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
/** Phones per room. Matches the 8 seats on the TV lobby. */
export const MAX_SEATS = 8;

/** The lowest seat nobody is using, or -1 when the couch is full. */
export function freeSeat(taken: Iterable<number>, max = MAX_SEATS): number {
  const used = new Set(taken);
  for (let seat = 0; seat < max; seat++) if (!used.has(seat)) return seat;
  return -1;
}

/** Trust nothing from the phone: anything that isn't 0–3 falls back to a colour based on the seat. */
export function cushion(colour: unknown, seat: number): CushionColour {
  return Number.isInteger(colour) && (colour as number) >= 0 && (colour as number) <= 3
    ? (colour as CushionColour)
    : ((Math.max(seat, 0) % 4) as CushionColour);
}

/** A room with nobody in it is removed after this long. */
export const EMPTY_TTL_MS = 30 * 60 * 1000;

export interface Room {
  code: string;
  createdAt: number;
  /** Socket ids of connected TVs and phones. */
  members: Set<string>;
  /** When the last member left; null while anyone is connected. */
  emptySince: number | null;
  /** Phase 0 tap counter, now per room. */
  taps: number;
  lastTapBy: string | null;
}

export type Rng = () => number;

export function generateCode(taken: (code: string) => boolean, rng: Rng = Math.random): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
    if (!taken(code)) return code;
  }
  throw new Error('Could not find a free room code');
}

/** Normalise what a person typed: upper-case, letters and digits only, at most 4 characters. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export class RoomStore {
  private rooms = new Map<string, Room>();

  constructor(private now: () => number = Date.now, private rng: Rng = Math.random) {}

  create(): Room {
    const code = generateCode((c) => this.rooms.has(c), this.rng);
    const room: Room = { code, createdAt: this.now(), members: new Set(), emptySince: this.now(), taps: 0, lastTapBy: null };
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normaliseCode(code));
  }

  join(code: string, memberId: string): Room | undefined {
    const room = this.get(code);
    if (!room) return undefined;
    room.members.add(memberId);
    room.emptySince = null;
    return room;
  }

  leave(code: string, memberId: string): void {
    const room = this.get(code);
    if (!room) return;
    room.members.delete(memberId);
    if (room.members.size === 0) room.emptySince = this.now();
  }

  /** Remove rooms that have been empty for longer than the TTL. Returns the removed codes. */
  sweep(): string[] {
    const removed: string[] = [];
    const t = this.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && t - room.emptySince >= EMPTY_TTL_MS) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  get size(): number {
    return this.rooms.size;
  }
}
