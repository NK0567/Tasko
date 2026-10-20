// V2 §5.9 — médiation à trois, prestataire absent, accord amiable, double validation (RG-G10..G15).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import { advance, api, app, auth, closeAll, createProvider, fundedJob, makeAdmin, pool, registerUser, resetDb } from './helpers.js';
import { attachSocket } from '../src/realtime/socket.js';
import { runSchedulerOnce } from '../src/scheduler/index.js';

let server;
let io;
let url;
const sockets = [];
let admin;
let admin2;
let stranger;

before(async () => {
  await resetDb();
  server = http.createServer(app);
  io = attachSocket(server, { origin: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
  admin = await registerUser('Médiateur Un');
  admin2 = await registerUser('Médiateur Deux');
  await makeAdmin(admin.user.id);
  await makeAdmin(admin2.user.id);
  stranger = await registerUser('Tiers Curieux');
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
const later = (h) => new Date(Date.now() + h * 3600e3);

/** Mission financée dont l'échéance d'arrivée est dépassée (funded_at reculé de 4 h). */
async function lateJob(name) {
  const provider = await createProvider({ name: `Absent ${name}` });
  const client = await registerUser(`Client ${name}`);
  const f = await fundedJob(client, provider);
  await pool.query(`UPDATE jobs SET funded_at = now() - interval '4 hours' WHERE id = $1`, [f.id]);
  return { provider, client, id: f.id, code: f.code };
}

test('RG-G11 : no-show signalable seulement après l\'échéance d\'arrivée', async () => {
  const provider = await createProvider({ name: 'Ponctuel' });
  const client = await registerUser('Client Pressé');
  const f = await fundedJob(client, provider);
  let r = await api().get(`/api/v1/jobs/${f.id}`).set(auth(client.token));
  assert.ok(r.body.arrival_deadline);
  assert.equal(r.body.can_report_no_show, false);
  r = await api().post(`/api/v1/jobs/${f.id}/no-show`).set(auth(client.token)).send({});
  assert.equal(r.status, 409);
});

test('RG-G11 : no-show non contesté → remboursement automatique, compteur no_shows', async () => {
  const { provider, client, id } = await lateJob('Non contesté');
  let r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.can_report_no_show, true);
  r = await api().post(`/api/v1/jobs/${id}/no-show`).set(auth(client.token)).send({ message: 'Personne n\'est venu depuis ce matin' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'disputed');
  assert.equal(r.body.dispute.kind, 'no_show');
  const disputeId = r.body.dispute.id;
  // le client ne peut pas se rembourser seul (RG-G10)
  r = await api().post(`/api/v1/jobs/${id}/cancel`).set(auth(client.token)).send({});
  assert.equal(r.status, 409);
  // avant l'échéance de réponse (12 h) : rien
  let res = await runSchedulerOnce({ now: later(11), only: ['no_shows'] });
  assert.equal(res.results.no_shows, 0);
  res = await runSchedulerOnce({ now: later(13), only: ['no_shows'] });
  assert.equal(res.results.no_shows, 1);
  r = await api().get(`/api/v1/disputes/${disputeId}`).set(auth(client.token));
  assert.equal(r.body.status, 'resolved');
  assert.equal(r.body.resolution, 'refund');
  assert.equal(r.body.resolved_by, 'system');
  assert.equal(r.body.job.status, 'cancelled');
  assert.equal(r.body.job.payment_status, 'refunded');
  r = await api().get('/api/v1/me').set(auth(provider.token));
  assert.equal(r.body.provider.no_shows, 1);
  assert.equal(r.body.provider.disputes_lost, 1);
  r = await api().get(`/api/v1/disputes/${disputeId}/messages`).set(auth(client.token));
  assert.ok(r.body.items.some((m) => m.sender_role === 'system' && /Décision automatique/.test(m.body)));
});

test('RG-G11 : no-show contesté par le prestataire → reste ouvert (décision admin)', async () => {
  const { provider, client, id } = await lateJob('Contesté');
  let r = await api().post(`/api/v1/jobs/${id}/no-show`).set(auth(client.token)).send({});
  const disputeId = r.body.dispute.id;
  r = await api().post(`/api/v1/disputes/${disputeId}/messages`).set(auth(provider.token)).send({ type: 'text', body: 'Je suis venu à 9 h, personne n\'a ouvert.' });
  assert.equal(r.status, 201);
  assert.equal(r.body.sender_role, 'provider');
  const res = await runSchedulerOnce({ now: later(13), only: ['no_shows'] });
  assert.equal(res.results.no_shows, 0);
  r = await api().get(`/api/v1/disputes/${disputeId}`).set(auth(admin.token));
  assert.equal(r.body.status, 'open');
});

test('RG-G12 : salon à trois — admin signé « Médiateur Tasko », messages non modifiables, tiers exclu', async () => {
  const provider = await createProvider({ name: 'Plombier Salon' });
  const client = await registerUser('Client Salon');
  const f = await fundedJob(client, provider);
  await advance(provider, f.id, ['en_route', 'arrived', 'in_progress', 'done'], f.code);
  let r = await api().post(`/api/v1/jobs/${f.id}/dispute`).set(auth(client.token)).send({ reason: 'La fuite continue', kind: 'quality' });
  const d = (await api().get(`/api/v1/disputes/${r.body.dispute.id}`).set(auth(client.token))).body;
  assert.ok(d.conversation_id);
  assert.ok(d.decision_due_at);
  r = await api().post(`/api/v1/disputes/${d.id}/messages`).set(auth(admin.token)).send({ type: 'text', body: 'Bonjour, pouvez-vous envoyer une photo ?' });
  assert.equal(r.status, 201);
  assert.equal(r.body.sender_role, 'admin');
  assert.equal(r.body.sender_name, 'Médiateur Tasko');
  r = await api().get(`/api/v1/conversations/${d.conversation_id}/messages`).set(auth(provider.token));
  assert.ok(r.body.items.some((m) => m.sender_name === 'Médiateur Tasko'));
  // tiers : ni REST ni socket
  r = await api().get(`/api/v1/disputes/${d.id}/messages`).set(auth(stranger.token));
  assert.equal(r.status, 404);
  r = await api().get(`/api/v1/conversations/${d.conversation_id}/messages`).set(auth(stranger.token));
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/disputes/${d.id}/messages`).set(auth(stranger.token)).send({ type: 'text', body: 'coucou' });
  assert.equal(r.status, 404);
  const ss = await connect(stranger.token);
  assert.equal((await ss.emitWithAck('conversation:join', { conversation_id: d.conversation_id })).ok, false);
  const as = await connect(admin2.token);
  assert.equal((await as.emitWithAck('conversation:join', { conversation_id: d.conversation_id })).ok, true);
  // messages immuables (fait foi)
  await assert.rejects(pool.query(`UPDATE messages SET body = 'modifié' WHERE conversation_id = $1`, [d.conversation_id]));
  await assert.rejects(pool.query(`DELETE FROM messages WHERE conversation_id = $1`, [d.conversation_id]));
});

test('RG-G13 : proposition acceptée par une seule partie → rien ; par les deux → split exécuté', async () => {
  const provider = await createProvider({ name: 'Plombier Accord' });
  const client = await registerUser('Client Accord');
  const f = await fundedJob(client, provider); // total 5 250
  await advance(provider, f.id, ['en_route', 'arrived', 'in_progress', 'done'], f.code);
  let r = await api().post(`/api/v1/jobs/${f.id}/dispute`).set(auth(client.token)).send({ reason: 'Travail incomplet' });
  const did = r.body.dispute.id;
  r = await api().post(`/api/v1/disputes/${did}/proposals`).set(auth(admin.token)).send({ provider_amount: 9000, message: 'trop' });
  assert.equal(r.status, 400); // au-delà du séquestre
  r = await api().post(`/api/v1/disputes/${did}/proposals`).set(auth(admin.token)).send({ provider_amount: 3000, message: '3 000 au prestataire, le reste remboursé' });
  assert.equal(r.status, 201);
  assert.equal(r.body.client_refund, 2250);
  const pid = r.body.id;
  r = await api().post(`/api/v1/disputes/${did}/proposals/${pid}/accept`).set(auth(stranger.token));
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/disputes/${did}/proposals/${pid}/accept`).set(auth(client.token));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'open');
  assert.equal(r.body.proposals[0].client_accepted, true);
  assert.equal(r.body.proposals[0].provider_accepted, null);
  const { rows: none } = await pool.query(`SELECT 1 FROM transactions WHERE job_id = $1 AND type IN ('payout', 'partial_refund')`, [f.id]);
  assert.equal(none.length, 0);
  r = await api().post(`/api/v1/disputes/${did}/proposals/${pid}/accept`).set(auth(provider.token));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'resolved');
  assert.equal(r.body.resolved_by, 'agreement');
  assert.equal(r.body.resolution, 'split');
  const { rows } = await pool.query(`SELECT type, amount FROM transactions WHERE job_id = $1 AND type IN ('payout', 'partial_refund')`, [f.id]);
  assert.deepEqual(Object.fromEntries(rows.map((t) => [t.type, t.amount])), { payout: 3000, partial_refund: 2250 });
});

test('RG-G14 : double validation au-delà du seuil — le même admin ne peut pas confirmer', async () => {
  await pool.query(`UPDATE settings SET value = '1000'::jsonb WHERE key = 'four_eyes_threshold'`);
  try {
    const provider = await createProvider({ name: 'Plombier Quatre Yeux' });
    const client = await registerUser('Client Quatre Yeux');
    const f = await fundedJob(client, provider);
    await advance(provider, f.id, ['en_route', 'arrived', 'in_progress', 'done'], f.code);
    let r = await api().post(`/api/v1/jobs/${f.id}/dispute`).set(auth(provider.token)).send({ reason: 'Le client ne valide pas', kind: 'not_validated' });
    const did = r.body.dispute.id;
    r = await api().post(`/api/v1/admin/disputes/${did}/resolve`).set(auth(admin.token)).send({ resolution: 'release', note: 'Travail conforme aux photos' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'pending_confirmation');
    assert.equal(r.body.decided_by.id, admin.user.id);
    r = await api().post(`/api/v1/admin/disputes/${did}/confirm`).set(auth(admin.token));
    assert.equal(r.status, 403);
    r = await api().get('/api/v1/admin/disputes?status=pending_confirmation').set(auth(admin2.token));
    assert.ok(r.body.items.some((x) => x.id === did));
    r = await api().post(`/api/v1/admin/disputes/${did}/confirm`).set(auth(admin2.token));
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'resolved');
    assert.equal(r.body.resolution, 'release');
    assert.equal(r.body.confirmed_by.id, admin2.user.id);
    assert.equal(r.body.job.status, 'completed');
    assert.equal(r.body.job.client.trust.disputes_lost, 1); // RG-G15
  } finally {
    await pool.query(`UPDATE settings SET value = '100000'::jsonb WHERE key = 'four_eyes_threshold'`);
  }
});
