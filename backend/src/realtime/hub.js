// Point d'accès unique à Socket.IO pour les services (no-op tant que le serveur n'est pas attaché, ex. tests).
let io = null;
const presence = new Map(); // userId -> nombre de sockets connectés

export function setIo(instance) {
  io = instance;
}
export const getIo = () => io;

export function emitToUser(userId, event, payload) {
  if (io && userId) io.to(`user:${userId}`).emit(event, payload);
}
export function emitToUsers(userIds, event, payload) {
  if (!io) return;
  const list = [...new Set(userIds.filter(Boolean))].map((id) => `user:${id}`);
  if (list.length) io.to(list).emit(event, payload);
}
export function emitToJob(jobId, event, payload) {
  if (io) io.to(`job:${jobId}`).emit(event, payload);
}
export function emitToConversation(conversationId, event, payload) {
  if (io) io.to(`conversation:${conversationId}`).emit(event, payload);
}

export function markConnected(userId) {
  presence.set(userId, (presence.get(userId) || 0) + 1);
}
export function markDisconnected(userId) {
  const n = (presence.get(userId) || 1) - 1;
  if (n <= 0) presence.delete(userId);
  else presence.set(userId, n);
}
export const isConnected = (userId) => presence.has(userId);

/** Émission unique vers plusieurs rooms (un socket présent dans plusieurs rooms ne reçoit l'événement qu'une fois). */
export function emitToRooms(rooms, event, payload) {
  const list = [...new Set(rooms.filter(Boolean))];
  if (io && list.length) io.to(list).emit(event, payload);
}

/**
 * Émission personnalisée par destinataire : `viewFor(user)` construit la charge utile selon l'utilisateur du socket
 * (ex. `start_code` visible du seul client, téléphones masqués avant paiement). Chaque socket ne reçoit qu'un message.
 */
export async function emitPerViewer(rooms, event, viewFor) {
  const list = [...new Set(rooms.filter(Boolean))];
  if (!io || !list.length) return;
  const sockets = await io.in(list).fetchSockets();
  const cache = new Map();
  for (const s of sockets) {
    const u = s.data?.user;
    const key = u?.id || '_';
    if (!cache.has(key)) cache.set(key, viewFor(u || null));
    const payload = cache.get(key);
    if (payload) s.emit(event, payload);
  }
}
