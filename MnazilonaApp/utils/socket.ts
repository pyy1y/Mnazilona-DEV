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
//   refreshSocketAuth()                     -> rebind with the latest token
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

const attachLifecycleLogs = (sock: Socket) => {
  sock.on('connect', () => {
    if (__DEV__) console.log('[socket] connected', sock.id);
  });
  sock.on('disconnect', (reason) => {
    if (__DEV__) console.log('[socket] disconnected:', reason);
  });
  sock.on('connect_error', (err) => {
    if (__DEV__) console.log('[socket] connect_error:', err.message);
  });
};

export async function connectSocket(): Promise<Socket | null> {
  // Reuse the singleton whether it's already connected OR still handshaking
  // / auto-reconnecting. Tearing it down mid-handshake (the old behavior)
  // caused a churn of half-built sockets when multiple screens mounted at
  // once and each called connectSocket() before the first one finished.
  if (socket) return socket;

  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const token = await TokenManager.get();
    if (!token) return null;

    const next = buildSocket(token);
    attachLifecycleLogs(next);
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
 * Re-bind the active socket to the latest token from SecureStore. Call this
 * after a token rotation — without it the singleton keeps reconnecting with
 * the old access token and gets rejected by the server's JWT middleware.
 */
export async function refreshSocketAuth(): Promise<void> {
  if (!socket) return;
  const token = await TokenManager.get();
  if (!token) return;
  // socket.io-client v4 exposes `auth` as a mutable field used on every
  // (re)connect handshake. Disconnect + connect forces it to be sent now.
  (socket as any).auth = { token };
  socket.disconnect();
  socket.connect();
}

/**
 * Subscribe to a backend event. Returns an unsubscribe fn — always call it
 * from a React effect cleanup so listeners don't pile up across remounts.
 */
export function onSocketEvent(event: string, handler: SocketHandler): () => void {
  let cancelled = false;
  let attached: { sock: Socket; handler: SocketHandler } | null = null;

  const attach = (sock: Socket) => {
    if (cancelled) return;
    sock.on(event, handler);
    attached = { sock, handler };
  };

  if (socket) {
    // Socket exists (connected or auto-reconnecting). on() buffers handlers,
    // they fire as soon as events arrive — no need to wait for `connected`.
    attach(socket);
  } else {
    connectSocket().then((sock) => {
      if (sock) attach(sock);
    });
  }

  return () => {
    cancelled = true;
    if (attached) {
      attached.sock.off(event, attached.handler);
      attached = null;
    }
  };
}

export function getSocket(): Socket | null {
  return socket;
}
