import type { Mood, PotatoKind } from '@couchpotato/shared';

export interface RoomPlayer {
  id: string;
  name: string;
  /** Lobby seat index; the room maps it onto the sofa's fill order. */
  seat: number;
  /** Cushion colour index (0–3), shown on the name tag. */
  colour: number;
  kind: PotatoKind;
  /** Wears the crown. */
  head: boolean;
  /** Reconnecting: the potato dozes with its eyes shut. */
  away: boolean;
}

export interface RoomOptions {
  mood: Mood;
  /** The first frame is on screen (the room is baked behind it). */
  onReady?: () => void;
  /** A potato just landed on its seat. */
  onLand?: (id: string) => void;
}

export interface Room {
  /** The whole lobby, every time: new potatoes drop in, missing ones hop off. */
  setPlayers(list: RoomPlayer[]): void;
  /** Re-lights and re-bakes the room. Cover the canvas for a moment, the bake takes a frame. */
  setMood(mood: Mood): void;
  hop(id: string): void;
  dispose(): void;
}

export function createRoom(canvas: HTMLCanvasElement, tagsEl: HTMLElement, opts: RoomOptions): Room;
