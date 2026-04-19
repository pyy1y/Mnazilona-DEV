'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Cookies from 'js-cookie';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Define event types for type safety
interface ServerToClientEvents {
  'device:status': (data: { serialNumber: string; isOnline: boolean; lastSeen: string; deviceType?: string; name?: string }) => void;
  'service:status': (data: { mqtt?: string; database?: string }) => void;
  'anomaly:alert': (data: unknown) => void;
  'ota:progress': (data: unknown) => void;
  'ratelimit:hit': (data: { type: string; ip: string; path: string; timestamp: string }) => void;
}

type TypedSocket = Socket<ServerToClientEvents>;

// Singleton socket instance
let socketInstance: TypedSocket | null = null;
let refCount = 0;

function getSocket(): TypedSocket {
  if (!socketInstance) {
    const token = Cookies.get('admin_token');
    socketInstance = io(`${API_BASE}/admin`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    }) as TypedSocket;

    // Refresh token on reconnect attempts (fixes stale token issue)
    socketInstance.on('reconnect_attempt' as any, () => {
      const freshToken = Cookies.get('admin_token');
      if (socketInstance) {
        (socketInstance as any).auth = { token: freshToken };
      }
    });

    socketInstance.on('connect', () => {
      // Connected successfully
    });

    socketInstance.on('connect_error', (err: Error) => {
      // If auth error, try refreshing token
      if (err.message.includes('auth') || err.message.includes('unauthorized')) {
        const freshToken = Cookies.get('admin_token');
        if (socketInstance && freshToken) {
          (socketInstance as any).auth = { token: freshToken };
        }
      }
    });
  }
  return socketInstance;
}

function releaseSocket() {
  if (refCount <= 0 && socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

// Hook: connect to admin namespace and listen to events
export function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<TypedSocket | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    refCount++;

    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      refCount--;
      releaseSocket();
    };
  }, []);

  const on = useCallback(<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E]
  ) => {
    socketRef.current?.on(event, handler as any);
    return () => { socketRef.current?.off(event, handler as any); };
  }, []);

  return { connected, on, socket: socketRef.current };
}

// Hook: listen to a specific socket event
export function useSocketEvent<T = unknown>(event: string, handler: (data: T) => void) {
  const { on, connected } = useSocket();

  useEffect(() => {
    const cleanup = on(event as any, handler as any);
    return cleanup;
  }, [event, handler, on]);

  return { connected };
}
