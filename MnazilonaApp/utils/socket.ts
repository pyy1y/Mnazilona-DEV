// utils/socket.ts
//
// Singleton Socket.IO client for the mobile app.
//
// Why a singleton:
//   - We only ever need ONE active connection per user, regardless of which
//     screen is mounted. Components attach/detach event listeners; they do
//     not own the socket lifecycle.
//   - Reconnects (network drop, app foreground, etc.) are handled by the
//     socket.io-client built-in reconnection — we just need to make sure we
//     hand it the latest auth token before connecting.
//
// Public API:
//   connectSocket()                         -> opens (or reuses) the connection
//   disconnectSocket()                      -> closes (call on logout)
//   onSocketEvent(event, handler)           -> subscribe; returns unsubscribe()
//
// Real-time events emitted by the backend (`/app` namespace):
//   "device:update"   -> partial device patch (status / state / name)
//   "device:paired"   -> a freshly paired device record
//   "device:unpaired" -> { serialNumber }
//   "device:log"      -> a single new log entry

import { io, Socket } from 'socket.io-client';
import { API_URL, APP_CONFIG } from '../constants/api';
import { TokenManager } from './api';

type SocketHandler = (...args: any[]) => void;

let socket: Socket | null = null;
let connectingPromise: Promise<Socket | null> | null = null;

const buildSocket = (token: string): Socket => {
  return io(`${API_URL}${APP_CONFIG.SOCKET_NAMESPACE}`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 15000,
    autoConnect: true,
  });
};

export async function connectSocket(): Promise<Socket | null> {
  if (socket && socket.connected) return socket;

  // Coalesce concurrent connect() calls so two screens mounting at once
  // don't each open their own socket.
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const token = await TokenManager.get();
    if (!token) {
      connectingPromise = null;
      return null;
    }

    // If we already have a stale instance (e.g. after token refresh), tear
    // it down before reopening with the new token.
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    const next = buildSocket(token);

    next.on('connect', () => {
      if (__DEV__) console.log('[socket] connected', next.id);
    });
    next.on('disconnect', (reason) => {
      if (__DEV__) console.log('[socket] disconnected:', reason);
    });
    next.on('connect_error', (err) => {
      if (__DEV__) console.log('[socket] connect_error:', err.message);
    });

    socket = next;
    return next;
  })();

  try {
    return await connectingPromise;
  } finally {
    connectingPromise = null;
  }
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

/**
 * Subscribe to a backend event. Returns an unsubscribe fn — always call it
 * from a React effect cleanup so listeners don't pile up across remounts.
 */
export function onSocketEvent(event: string, handler: SocketHandler): () => void {
  let attached: { sock: Socket; handler: SocketHandler } | null = null;

  const attach = (sock: Socket) => {
    sock.on(event, handler);
    attached = { sock, handler };
  };

  // If already connected, attach immediately. Otherwise connect and attach.
  if (socket && socket.connected) {
    attach(socket);
  } else {
    connectSocket().then((sock) => {
      if (sock) attach(sock);
    });
  }

  return () => {
    if (attached) {
      attached.sock.off(event, attached.handler);
      attached = null;
    }
  };
}

export function getSocket(): Socket | null {
  return socket;
}
