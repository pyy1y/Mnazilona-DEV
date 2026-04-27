'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Cookies from 'js-cookie';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Server -> client event payloads (kept in sync with backend emitToAdmins calls)
export interface DeviceStatusPayload {
  serialNumber: string;
  isOnline: boolean;
  lastSeen?: string;
  deviceType?: string;
  name?: string;
  owner?: { _id: string; name: string; email: string } | null;
}

export interface DeviceHeartbeatPayload {
  serialNumber: string;
  isOnline: boolean;
  lastSeen: string;
  payload: Record<string, unknown> | null;
}

export interface DeviceDpReportPayload {
  serialNumber: string;
  payload: Record<string, unknown>;
}

export interface OtaProgressPayload {
  serialNumber: string;
  status: string;
  progress?: number;
  version?: string;
  error?: string | null;
}

export interface RateLimitHitPayload {
  type: string;
  ip: string;
  path: string;
  timestamp: string;
}

export interface ServiceStatusPayload {
  mqtt?: string;
  database?: string;
}

interface ServerToClientEvents {
  'device:status': (data: DeviceStatusPayload) => void;
  'device:heartbeat': (data: DeviceHeartbeatPayload) => void;
  'device:dp_report': (data: DeviceDpReportPayload) => void;
  'service:status': (data: ServiceStatusPayload) => void;
  'anomaly:alert': (data: unknown) => void;
  'ota:progress': (data: OtaProgressPayload) => void;
  'ratelimit:hit': (data: RateLimitHitPayload) => void;
}

type TypedSocket = Socket<ServerToClientEvents>;

// Singleton socket — kept alive across page navigations so we don't lose
// real-time events while React unmounts/remounts dashboard pages.
let socketInstance: TypedSocket | null = null;

function buildSocket(): TypedSocket {
  const token = Cookies.get('admin_token');
  const socket = io(`${API_BASE}/admin`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
  }) as TypedSocket;

  // The Manager (`socket.io`) emits `reconnect_attempt`, NOT the socket itself.
  // We refresh the auth token here so reconnects use the latest cookie value.
  socket.io.on('reconnect_attempt', () => {
    const freshToken = Cookies.get('admin_token');
    socket.auth = { token: freshToken };
  });

  socket.on('connect_error', (err: Error) => {
    if (err.message.includes('auth') || err.message.toLowerCase().includes('unauthorized')) {
      const freshToken = Cookies.get('admin_token');
      socket.auth = { token: freshToken };
    }
  });

  return socket;
}

function getSocket(): TypedSocket {
  if (!socketInstance) socketInstance = buildSocket();
  return socketInstance;
}

// Called from auth.logout — fully tear down the connection so the next login
// doesn't reuse a socket authenticated with the old token.
export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
}

// Hook: subscribe to admin namespace events. Multiple components share the
// singleton socket; cleanup only removes this hook's listeners.
export function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<TypedSocket | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const on = useCallback(<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E]
  ) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on(event, handler as never);
    return () => { socket.off(event, handler as never); };
  }, []);

  return { connected, on };
}

// Hook: listen to a single event. Caller MUST memoize `handler` (e.g. with
// useCallback) — otherwise we'd re-subscribe on every render.
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E]
) {
  const { on, connected } = useSocket();

  useEffect(() => {
    return on(event, handler);
  }, [event, handler, on]);

  return { connected };
}
