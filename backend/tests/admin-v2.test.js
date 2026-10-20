// Alignement avec l'admin V2 : trust sur les utilisateurs, offres lisibles par l'admin, salon de médiation en temps réel,
// rôles des messages, champs prestataire du Job, clés d'audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import { YDE, advance, api, app, auth, cats, closeAll, createProvider, fundedJob, makeAdmin, registerUser, resetDb } from './helpers.js';
import { attachSocket } from '../src/realtime/socket.js';

let server;
let io;
let url;
const sockets = [];
let admin;

before(async () => {
  await resetDb();
  server = http.createServer(app);
  io = attachSocket(server, { origin: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
  admin = await registerUser('Admin Alignement');
  await makeAdmin(admin.user.id);
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
const once = (s, event, ms = 5000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} non reçu`)), ms);
    s.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

test('GET /admin/users et /admin/users/:id exposent trust (et compteurs prestataire)', async () => {
  const provider = await createProvider({ name: 'Prestataire Trust' });
  const client = await registerUser('Client Trust');
  const f = await fundedJob(client, provider);
  let r = await api().get('/api/v1/admin/users?role=client').set(auth(admin.token));
  const c = r.body.items.find((u) => u.id === client.user.id);
  assert.deepEqual(c.trust, { rating_avg: 0, rating_count: 0, jobs_paid: 1, disputes_lost: 0 });
  r = await api().get('/api/v1/admin/users?role=provider').set(auth(admin.token));
  const p = r.body.items.find((u) => u.id === provider.user.id);
  assert.equal(p.provider.no_shows, 0);
  assert.equal(p.provider.disputes_lost, 0);
  assert.ok(p.trust);
  r = await api().get(`/api/v1/admin/users/${client.user.id}`).set(auth(admin.token));
  assert.equal(r.status, 200);
  assert.equal(r.body.trust.jobs_paid, 1);
  r = await api().get(`/api/v1/admin/users/${client.user.id}`).set(auth(client.token));
  assert.equal(r.status, 403);
  // Job : provider.no_shows / disputes_lost, client.trust
  r = await api().get(`/api/v1/jobs/${f.id}`).set(auth(admin.token));
  assert.equal(r.body.provider.no_shows, 0);
  assert.equal(r.body.provider.disputes_lost, 0);
  assert.equal(r.body.client.trust.jobs_paid, 1);
});

test('un admin lit toutes les offres d\'un appel d\'offres', async () => {
  const client = await registerUser('Syndic Admin');
  const p1 = await createProvider({ name: 'Offreur Un' });
  const p2 = await createProvider({ name: 'Offreur Deux' });
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send({
    mode: 'tender', category_id: cats.batiment, title: 'Toiture', description: 'Réfection', lat: YDE.lat, lng: YDE.lng,
    bid_deadline: new Date(Date.now() + 2 * 86400e3).toISOString(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  assert.equal((await api().post(`/api/v1/jobs/${id}/bids`).set(auth(p1.token)).send({ amount: 300000 })).status, 201);
  assert.equal((await api().post(`/api/v1/jobs/${id}/bids`).set(auth(p2.token)).send({ amount: 280000 })).status, 201);
  r = await api().get(`/api/v1/jobs/${id}/bids`).set(auth(admin.token));
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
});

test('un admin rejoint le salon de médiation et reçoit message:new ; rôles et noms des messages', async () => {
  const provider = await createProvider({ name: 'Plombier Salon Admin' });
  const client = await registerUser('Client Salon Admin');
  const f = await fundedJob(client, provider);
  await advance(provider, f.id, ['en_route', 'arrived', 'in_progress', 'done'], f.code);
  let r = await api().post(`/api/v1/jobs/${f.id}/dispute`).set(auth(client.token)).send({ reason: 'Travail non conforme' });
  const d = (await api().get(`/api/v1/disputes/${r.body.dispute.id}`).set(auth(admin.token))).body;
  const as = await connect(admin.token);
  assert.equal((await as.emitWithAck('conversation:join', { conversation_id: d.conversation_id })).ok, true);
  const incoming = once(as, 'message:new');
  await api().post(`/api/v1/disputes/${d.id}/messages`).set(auth(provider.token)).send({ type: 'text', body: 'Voici mes photos.' });
  const m = await incoming;
  assert.equal(m.conversation_id, d.conversation_id);
  assert.equal(m.sender_role, 'provider');
  assert.equal(m.sender_name, 'Plombier Salon Admin');
  await api().post(`/api/v1/disputes/${d.id}/messages`).set(auth(admin.token)).send({ type: 'text', body: 'Bien reçu.' });
  r = await api().get(`/api/v1/disputes/${d.id}/messages`).set(auth(client.token));
  for (const msg of r.body.items) {
    assert.ok(['client', 'provider', 'admin', 'system'].includes(msg.sender_role), JSON.stringify(msg));
    assert.equal(typeof msg.sender_name, 'string');
  }
  assert.ok(r.body.items.some((x) => x.sender_role === 'admin' && x.sender_name === 'Médiateur Tasko'));
  assert.ok(r.body.items.some((x) => x.sender_role === 'system' && x.sender_name === 'Tasko'));
  // conversation directe : rôles déduits de la mission
  const conv = await api().post('/api/v1/conversations').set(auth(client.token)).send({ user_id: provider.user.id, job_id: f.id });
  await api().post(`/api/v1/conversations/${conv.body.id}/messages`).set(auth(client.token)).send({ type: 'text', body: 'Bonjour' });
  r = await api().get(`/api/v1/conversations/${conv.body.id}/messages`).set(auth(provider.token));
  assert.equal(r.body.items[0].sender_role, 'client');
  assert.equal(r.body.items[0].sender_name, 'Client Salon Admin');

  // clés d'audit domaine.action
  await api().post(`/api/v1/admin/disputes/${d.id}/resolve`).set(auth(admin.token)).send({ resolution: 'split', provider_amount: 5250, note: 'Partage du séquestre' });
  await api().patch(`/api/v1/admin/categories/${cats.coiffure}`).set(auth(admin.token)).send({ description: 'Coupe à domicile' });
  r = await api().get('/api/v1/admin/audit-logs').set(auth(admin.token));
  const actions = r.body.items.map((x) => x.action);
  assert.ok(actions.includes('dispute.resolve'));
  assert.ok(actions.includes('category.update'));
  for (const a of actions) assert.match(a, /^[a-z_]+\.[a-z_]+$/);
});
