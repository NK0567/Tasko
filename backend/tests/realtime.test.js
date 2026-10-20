import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import { YDE, api, app, auth, cats, closeAll, createProvider, registerUser, resetDb } from './helpers.js';
import { attachSocket } from '../src/realtime/socket.js';

let server;
let io;
let url;
const sockets = [];

before(async () => {
  await resetDb();
  server = http.createServer(app);
  io = attachSocket(server, { origin: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const s of sockets) s.close();
  await new Promise((r) => io.close(() => r()));
  await closeAll();
});

const connect = (token) =>
  new Promise((resolve, reject) => {
    const s = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
const once = (s, event, ms = 10000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`événement ${event} non reçu`)), ms);
    s.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

test('handshake sans jeton refusé', async () => {
  await assert.rejects(connect('invalide'));
});

test('job:new, job:updated, provider:location, message:new', async () => {
  const provider = await createProvider({ name: 'Plombier Temps Réel' });
  const client = await registerUser('Client Temps Réel');
  const ps = await connect(provider.token);
  const cs = await connect(client.token);

  const newJob = once(ps, 'job:new');
  const notif = once(ps, 'notification:new');
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send({
    category_id: cats.plomberie, description: 'Fuite', lat: YDE.lat + 0.02, lng: YDE.lng, urgency: 'now', budget: 5000,
  });
  const jobId = r.body.id;
  const received = await newJob;
  assert.equal(received.id, jobId);
  assert.equal(received.client.phone, null); // masqué avant attribution
  assert.ok(received.distance_km > 2);
  assert.equal((await notif).type, 'job');

  const updated = once(cs, 'job:updated');
  await api().post(`/api/v1/jobs/${jobId}/accept`).set(auth(provider.token)).send({});
  assert.equal((await updated).status, 'accepted');

  // le client rejoint la room du job puis reçoit la position du prestataire
  const ack = await cs.emitWithAck('job:join', { job_id: jobId });
  assert.equal(ack.ok, true);
  const loc = once(cs, 'provider:location');
  const ack2 = await ps.emitWithAck('location:update', { lat: YDE.lat + 0.01, lng: YDE.lng });
  assert.equal(ack2.ok, true);
  const p = await loc;
  assert.equal(p.job_id, jobId);
  assert.equal(p.provider_id, provider.user.id);
  assert.ok(p.distance_km > 1 && p.distance_km < 1.3);
  assert.equal(p.eta_min, Math.ceil((p.distance_km / 20) * 60) + 2);

  // un tiers ne peut pas rejoindre la room
  const other = await registerUser('Curieux');
  const os = await connect(other.token);
  const ack3 = await os.emitWithAck('job:join', { job_id: jobId });
  assert.equal(ack3.ok, false);

  // messagerie
  r = await api().post('/api/v1/conversations').set(auth(client.token)).send({ user_id: provider.user.id, job_id: jobId });
  const convId = r.body.id;
  const r2 = await api().post('/api/v1/conversations').set(auth(provider.token)).send({ user_id: client.user.id });
  assert.equal(r2.body.id, convId); // réutilise l'existante
  const msg = once(ps, 'message:new');
  r = await api().post(`/api/v1/conversations/${convId}/messages`).set(auth(client.token))
    .send({ type: 'text', body: "Bonjour, je souhaite une intervention pour une fuite d'eau dans ma salle de bain." });
  assert.equal(r.status, 201);
  assert.equal((await msg).conversation_id, convId);
  r = await api().get('/api/v1/conversations').set(auth(provider.token));
  assert.equal(r.body.items[0].unread_count, 1);
  assert.equal(r.body.items[0].other_user.full_name, 'Client Temps Réel');
  await api().post(`/api/v1/conversations/${convId}/read`).set(auth(provider.token));
  r = await api().get(`/api/v1/conversations/${convId}/messages`).set(auth(provider.token));
  assert.equal(r.body.items.length, 1);
  assert.ok(r.body.items[0].read_at);
});
