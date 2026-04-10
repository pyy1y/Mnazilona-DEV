'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import Cookies from 'js-cookie';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type SocketInstance = ReturnType<typeof io>;

// Singleton socket instance
let socketInstance: SocketInstance | null = null;
let refCount = 0;

function getSocket(): SocketInstance {
  if (!socketInstance) {
    const token = Cookies.get('admin_token');
    socketInstance = io(`${API_BASE}/admin`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });

    (socketInstance as any).on('connect', () => {
      console.log('Socket.IO connected');
    });

    (socketInstance as any).on('connect_error', (err: Error) => {
      console.warn('Socket.IO error:', err.message);
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
  const socketRef = useRef<SocketInstance | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    refCount++;

    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    (socket as any).on('connect', onConnect);
    (socket as any).on('disconnect', onDisconnect);

    return () => {
      (socket as any).off('connect', onConnect);
      (socket as any).off('disconnect', onDisconnect);
      refCount--;
      releaseSocket();
    };
  }, []);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    (socketRef.current as any)?.on(event, handler);
    return () => { (socketRef.current as any)?.off(event, handler); };
  }, []);

  return { connected, on, socket: socketRef.current };
}

// Hook: listen to a specific socket event
export function useSocketEvent<T = unknown>(event: string, handler: (data: T) => void) {
  const { on, connected } = useSocket();

  useEffect(() => {
    const cleanup = on(event, handler as (...args: any[]) => void);
    return cleanup;
  }, [event, handler, on]);

  return { connected };
}
