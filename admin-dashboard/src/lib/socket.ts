'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Cookies from 'js-cookie';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN_KEY = 'admin_token';

const getStoredToken = () =>
  Cookies.get(TOKEN_KEY) || (typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null);

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

// Sent by the server to a single socket immediately after it joins
// admin:device:<sn>. Carries the device's current state so the detail page
// can refresh after reconnects without an extra REST roundtrip.
export interface DeviceSnapshotPayload {
  serialNumber: string;
  name?: string;
  deviceType?: string;
  isOnline: boolean;
  lastSeen?: string;
  state?: Record<string, unknown>;
  otaStatus?: string;
  otaProgress?: number;
  otaTargetVersion?: string | null;
  otaError?: string | null;
  firmwareVersion?: string;
  at: string;
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

// Coarse OTA lifecycle event delivered to the lobby on status transitions
// (notified, success, failed, rolled_back, idle/cleared, or { cleared: 'all' }
// for bulk clears). The firmware fleet view listens for this; the device
// detail view subscribes to the per-device room and listens for the
// fine-grained `ota:progress` instead.
export type OtaLifecyclePayload =
  | OtaProgressPayload
  | { cleared: 'all' };

// Device lifecycle events emitted to admin:devices when a row appears,
// disappears, or changes ownership. The dashboard typically just refetches
// on these — payloads are intentionally loose since the index re-queries.
export interface DeviceLifecyclePayload {
  serialNumber: string;
  [key: string]: unknown;
}

interface ServerToClientEvents {
  'device:status': (data: DeviceStatusPayload) => void;
  'device:heartbeat': (data: DeviceHeartbeatPayload) => void;
  'device:dp_report': (data: DeviceDpReportPayload) => void;
  'device:snapshot': (data: DeviceSnapshotPayload) => void;
  'device:paired': (data: DeviceLifecyclePayload) => void;
  'device:unpaired': (data: DeviceLifecyclePayload) => void;
  'device:transferred': (data: DeviceLifecyclePayload) => void;
  'device:registered': (data: DeviceLifecyclePayload) => void;
  'service:status': (data: ServiceStatusPayload) => void;
  'anomaly:alert': (data: unknown) => void;
  'ota:progress': (data: OtaProgressPayload) => void;
  'ota:lifecycle': (data: OtaLifecyclePayload) => void;
  'ratelimit:hit': (data: RateLimitHitPayload) => void;
}

// Per-page subscription topics. The backend scopes high-frequency events
// (heartbeat, dp_report, ota:progress) to per-device rooms; pages must
// opt in via `subscribe` to receive them.
export type AdminSubscription =
  | { topic: 'device'; id: string }
  | { topic: 'devices' }
  | { topic: 'users' }
  | { topic: 'monitoring' };

type SubscribeAck = { ok: true; room: string } | { ok: false; error: string };
type UnsubscribeAck = { ok: true };

interface ClientToServerEvents {
  subscribe: (payload: AdminSubscription, ack?: (res: SubscribeAck) => void) => void;
  unsubscribe: (payload: AdminSubscription, ack?: (res: UnsubscribeAck) => void) => void;
}

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Singleton socket — kept alive across page navigations so we don't lose
// real-time events while React unmounts/remounts dashboard pages.
let socketInstance: TypedSocket | null = null;

// Refcount of active room subscriptions across the app. Two pages asking for
// the same room must not double-subscribe, and unmounting one must not kick
// the other off. Also drives resubscribe-on-reconnect.
const roomRefCount = new Map<string, AdminSubscription>();
const roomCounts = new Map<string, number>();

function subscriptionKey(payload: AdminSubscription): string {
  return payload.topic === 'device' ? `device:${payload.id.toUpperCase()}` : payload.topic;
}

function buildSocket(): TypedSocket {
  const token = getStoredToken();
  const socket = io(`${API_BASE}/admin`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
  }) as TypedSocket;

  // The Manager (`socket.io`) emits `reconnect_attempt`, NOT the socket itself.
  // We refresh the auth token here so reconnects use the latest stored value.
  socket.io.on('reconnect_attempt', () => {
    const freshToken = getStoredToken();
    socket.auth = { token: freshToken };
  });

  socket.on('connect_error', (err: Error) => {
    if (err.message.includes('auth') || err.message.toLowerCase().includes('unauthorized')) {
      const freshToken = getStoredToken();
      socket.auth = { token: freshToken };
    }
  });

  // On every (re)connect, re-emit subscribe for each active room. Server-side
  // joins are idempotent, so the initial-connect duplicate (with the buffered
  // emit from subscribeRoom) is harmless.
  socket.on('connect', () => {
    for (const payload of roomRefCount.values()) {
      socket.emit('subscribe', payload);
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
  // Drop all room state so a fresh login starts clean. Any still-mounted
  // component's cleanup will hit the `if (socketInstance)` guard below.
  roomRefCount.clear();
  roomCounts.clear();
}

// Refcounted room subscription. Returns a teardown that decrements the count
// and only emits unsubscribe when the last consumer leaves.
function subscribeRoom(payload: AdminSubscription): () => void {
  const key = subscriptionKey(payload);
  const prev = roomCounts.get(key) || 0;
  roomCounts.set(key, prev + 1);
  if (prev === 0) {
    roomRefCount.set(key, payload);
    // socket.io-client buffers emits until connected, so this is safe even
    // before the socket has finished its first handshake.
    getSocket().emit('subscribe', payload);
  }
  return () => {
    const next = (roomCounts.get(key) || 1) - 1;
    if (next <= 0) {
      roomCounts.delete(key);
      roomRefCount.delete(key);
      // If the socket was torn down (logout), the unsubscribe is irrelevant.
      if (socketInstance) socketInstance.emit('unsubscribe', payload);
    } else {
      roomCounts.set(key, next);
    }
  };
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
    const onConnectError = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
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

// Hook: join a per-page admin room for the lifetime of the component. Pass
// null/undefined to opt out (e.g. while waiting for a serial to load). The
// hook is refcounted, so two pages requesting the same room is safe.
export function useAdminSubscription(payload: AdminSubscription | null | undefined) {
  // Serialize to a primitive so a fresh object literal each render doesn't
  // tear down and re-create the subscription.
  const serialized = payload ? JSON.stringify(payload) : null;

  useEffect(() => {
    if (!serialized) return;
    return subscribeRoom(JSON.parse(serialized) as AdminSubscription);
  }, [serialized]);
}
