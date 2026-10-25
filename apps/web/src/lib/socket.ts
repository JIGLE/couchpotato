import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@couchpotato/shared';

export type CouchSocket = Socket<ServerToClient, ClientToServer>;

/** One socket per tab, same origin, through the /ws path (works behind the Cloudflare tunnel). */
export function connect(): CouchSocket {
  return io({ path: '/ws', transports: ['websocket', 'polling'] });
}
