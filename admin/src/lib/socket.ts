import { io, type Socket } from 'socket.io-client';
import { tokenStore } from '../api/client';

/**
 * Connexion Socket.IO unique (contrat §3). En dev, `/socket.io` passe par le proxy Vite.
 * VITE_SOCKET_URL permet de cibler une autre origine en production.
 */
let socket: Socket | null = null;
let socketToken: string | null = null;

export function getSocket(): Socket | null {
  const token = tokenStore.get();
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  const url = (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? undefined;
  socket = io(url ?? window.location.origin, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 2000,
  });
  socketToken = token;
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}
