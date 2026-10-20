import { Server } from 'socket.io';
import { one } from '../db.js';
import { userFromToken } from '../middleware/auth.js';
import { markConnected, markDisconnected, setIo } from './hub.js';
import { updateProviderLocation } from './location.js';

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const fail = (message, code) => Object.assign(new Error(message), { code });

// Participants d'une conversation, ou admins pour un salon de médiation (RG-G12).
const CONV_ACCESS = `SELECT user_a, user_b FROM conversations
  WHERE id = $1 AND (user_a = $2 OR user_b = $2 OR (kind = 'mediation' AND $3::boolean))`;

/** Attache Socket.IO au serveur HTTP. Auth JWT dans le handshake : io(URL, { auth: { token } }). */
export function attachSocket(httpServer, corsOptions) {
  const io = new Server(httpServer, { cors: corsOptions, maxHttpBufferSize: 64 * 1024 });

  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer /, '');
      socket.data.user = await userFromToken(raw);
      next();
    } catch (err) {
      const e = new Error(err.message || 'UNAUTHORIZED');
      e.data = { code: err.code || 'UNAUTHORIZED' };
      next(e);
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    markConnected(user.id);

    const safe = (fn) => async (payload, ack) => {
      try {
        const r = await fn(payload && typeof payload === 'object' ? payload : {});
        if (typeof ack === 'function') ack({ ok: true, ...(r || {}) });
      } catch (err) {
        const code = err.code && /^[A-Z_]+$/.test(err.code) ? err.code : 'INTERNAL';
        if (typeof ack === 'function') ack({ ok: false, error: { code, message: code === 'INTERNAL' ? 'Erreur interne' : err.message } });
      }
    };

    socket.on('job:join', safe(async ({ job_id }) => {
      if (!isUuid(job_id)) throw fail('job_id invalide', 'VALIDATION_ERROR');
      const job = await one('SELECT client_id, provider_id FROM jobs WHERE id = $1', [job_id]);
      if (!job || (job.client_id !== user.id && job.provider_id !== user.id && !user.is_admin)) throw fail('Accès refusé', 'FORBIDDEN');
      socket.join(`job:${job_id}`);
    }));

    socket.on('job:leave', safe(async ({ job_id }) => {
      if (isUuid(job_id)) socket.leave(`job:${job_id}`);
    }));

    socket.on('conversation:join', safe(async ({ conversation_id }) => {
      if (!isUuid(conversation_id)) throw fail('conversation_id invalide', 'VALIDATION_ERROR');
      const c = await one(CONV_ACCESS, [conversation_id, user.id, !!user.is_admin]);
      if (!c) throw fail('Accès refusé', 'FORBIDDEN');
      socket.join(`conversation:${conversation_id}`);
    }));

    socket.on('location:update', safe(async ({ lat, lng }) => {
      if (!user.is_provider) throw fail('Réservé aux prestataires', 'FORBIDDEN');
      if (!finite(lat) || !finite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail('Coordonnées invalides', 'VALIDATION_ERROR');
      return updateProviderLocation(user.id, lat, lng);
    }));

    socket.on('typing', safe(async ({ conversation_id }) => {
      if (!isUuid(conversation_id)) return;
      const c = await one(CONV_ACCESS, [conversation_id, user.id, !!user.is_admin]);
      if (!c) return;
      const others = [c.user_a, c.user_b].filter((id) => id !== user.id).map((id) => `user:${id}`);
      socket.to([`conversation:${conversation_id}`, ...others]).emit('typing', { conversation_id, user_id: user.id });
    }));

    socket.on('disconnect', () => markDisconnected(user.id));
  });

  setIo(io);
  return io;
}
