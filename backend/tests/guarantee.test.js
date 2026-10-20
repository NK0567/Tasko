// V2 — garantie de paiement (RG-G1..G9), modes instant / direct / offre prestataire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import {
  YDE, advance, api, app, auth, cats, closeAll, createProvider, fundedJob, jobBody, makeAdmin, pool, registerUser, resetDb, waitFor, waitTx,
} from './helpers.js';
import { attachSocket } from '../src/realtime/socket.js';
import { runSchedulerOnce } from '../src/scheduler/index.js';

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
const collect = (s, event) => {
  const list = [];
  s.on(event, (p) => list.push(p));
  return list;
};
const hours = (h) => new Date(Date.now() + h * 3600e3);

test('RG-G1 : le prestataire ne peut pas se déplacer ni démarrer sans séquestre', async () => {
  const provider = await createProvider({ name: 'Plombier G1' });
  const client = await registerUser('Client G1');
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ provider_id: provider.user.id }));
  const id = r.body.id;
  assert.equal(r.body.mode, 'direct');
  assert.equal(r.body.funds_secured, false);
  r = await api().post(`/api/v1/jobs/${id}/accept`).set(auth(provider.token)).send({});
  assert.equal(r.status, 200);
  for (const status of ['en_route', 'arrived', 'in_progress']) {
    r = await api().post(`/api/v1/jobs/${id}/status`).set(auth(provider.token)).send({ status, start_code: '1234' });
    assert.equal(r.status, 409, status);
    assert.equal(r.body.error.code, 'INVALID_STATE');
  }
});

test('RG-G2 : code de démarrage requis, visible uniquement du client', async () => {
  const provider = await createProvider({ name: 'Plombier G2' });
  const client = await registerUser('Client G2');
  const { id, code, job } = await fundedJob(client, provider);
  assert.equal(job.status, 'funded');
  assert.equal(job.funds_secured, true);
  assert.match(code, /^\d{4}$/);
  let r = await api().get(`/api/v1/jobs/${id}`).set(auth(provider.token));
  assert.equal(r.body.start_code, null);
  await advance(provider, id, ['en_route', 'arrived'], code);
  r = await api().post(`/api/v1/jobs/${id}/status`).set(auth(provider.token)).send({ status: 'in_progress' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.details.start_code, 'Requis');
  const wrong = code === '0000' ? '1111' : '0000';
  r = await api().post(`/api/v1/jobs/${id}/status`).set(auth(provider.token)).send({ status: 'in_progress', start_code: wrong });
  assert.equal(r.status, 400);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.status, 'arrived');
  r = await api().post(`/api/v1/jobs/${id}/status`).set(auth(provider.token)).send({ status: 'in_progress', start_code: code });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'in_progress');
});

test('RG-G3/G4 : preuve de fin puis libération automatique à échéance (horloge simulée)', async () => {
  const provider = await createProvider({ name: 'Plombier G4' });
  const client = await registerUser('Client G4');
  const { id, code } = await fundedJob(client, provider);
  const done = await advance(provider, id, ['en_route', 'arrived', 'in_progress', 'done'], code, { proof_photos: ['/uploads/preuve.jpg'], note: 'Fuite réparée' });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.completion_proof, { photos: ['/uploads/preuve.jpg'], note: 'Fuite réparée' });
  const releaseAt = new Date(done.auto_release_at).getTime();
  assert.ok(Math.abs(releaseAt - (Date.now() + 48 * 3600e3)) < 60e3, 'auto_release_at = done_at + 48 h');

  let res = await runSchedulerOnce({ now: hours(47), only: ['auto_release', 'reminders'] });
  assert.equal(res.ran, true);
  assert.equal(res.results.auto_release, 0);
  assert.ok(res.results.reminders >= 1); // rappel de mi-parcours / 2 h avant
  let r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.status, 'done');

  res = await runSchedulerOnce({ now: hours(49), only: ['auto_release'] });
  assert.equal(res.results.auto_release, 1);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.status, 'completed');
  assert.equal(r.body.completed_by, 'auto');
  assert.equal(r.body.payment_status, 'released');
  // idempotence : un second passage ne libère rien de plus
  res = await runSchedulerOnce({ now: hours(50), only: ['auto_release'] });
  assert.equal(res.results.auto_release, 0);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM transactions WHERE job_id = $1 AND type = 'payout'`, [id]);
  assert.equal(rows[0].n, 1);
});

test('RG-G6 : un litige gèle la libération automatique ; résolution split', async () => {
  const provider = await createProvider({ name: 'Plombier G6' });
  const client = await registerUser('Client G6');
  const admin = await registerUser('Admin G6');
  await makeAdmin(admin.user.id);
  const { id, code } = await fundedJob(client, provider, { budget: 10000 });
  await advance(provider, id, ['en_route', 'arrived', 'in_progress', 'done'], code);
  let r = await api().post(`/api/v1/jobs/${id}/dispute`).set(auth(client.token)).send({ reason: 'Le travail est mal fait', photos: ['/uploads/fuite.jpg'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'disputed');
  const disputeId = r.body.dispute.id;
  const res = await runSchedulerOnce({ now: hours(49), only: ['auto_release'] });
  assert.equal(res.results.auto_release, 0);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.status, 'disputed');

  r = await api().post(`/api/v1/admin/disputes/${disputeId}/resolve`).set(auth(admin.token)).send({ resolution: 'split', provider_amount: 6000 });
  assert.equal(r.status, 400); // motif obligatoire
  r = await api().post(`/api/v1/admin/disputes/${disputeId}/resolve`).set(auth(admin.token))
    .send({ resolution: 'split', provider_amount: 6000, note: 'Travail partiellement réalisé' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'resolved');
  assert.equal(r.body.resolution, 'split');
  assert.equal(r.body.resolved_by, 'admin');
  const { rows } = await pool.query(`SELECT type, amount FROM transactions WHERE job_id = $1 AND type <> 'escrow_in'`, [id]);
  const m = Object.fromEntries(rows.map((t) => [t.type, t.amount]));
  assert.equal(m.payout, 6000);
  assert.equal(m.partial_refund, 10500 - 6000);
  assert.equal(r.body.job.status, 'completed');
});

test('RG-G5 : annulation client en route → frais de déplacement ; interdite après arrivée', async () => {
  const provider = await createProvider({ name: 'Plombier G5' });
  const client = await registerUser('Client G5');
  let { id, code } = await fundedJob(client, provider);
  await advance(provider, id, ['en_route'], code);
  let r = await api().post(`/api/v1/jobs/${id}/cancel`).set(auth(client.token)).send({ reason: 'Imprévu' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'cancelled');
  assert.equal(r.body.cancelled_by, 'client');
  assert.equal(r.body.cancellation_fee, 1000);
  const { rows } = await pool.query(`SELECT type, amount, user_id FROM transactions WHERE job_id = $1 AND type <> 'escrow_in'`, [id]);
  const m = Object.fromEntries(rows.map((t) => [t.type, t]));
  assert.equal(m.cancellation_fee.amount, 1000);
  assert.equal(m.cancellation_fee.user_id, provider.user.id);
  assert.equal(m.partial_refund.amount, 5250 - 1000);

  ({ id, code } = await fundedJob(client, provider));
  await advance(provider, id, ['en_route', 'arrived'], code);
  r = await api().post(`/api/v1/jobs/${id}/cancel`).set(auth(client.token)).send({});
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INVALID_STATE');

  // annulation par le prestataire : remboursement intégral + compteur
  r = await api().post(`/api/v1/jobs/${id}/cancel`).set(auth(provider.token)).send({ reason: 'Panne de matériel' });
  assert.equal(r.status, 200);
  assert.equal(r.body.payment_status, 'refunded');
  r = await api().get('/api/v1/me').set(auth(provider.token));
  assert.equal(r.body.provider.cancellations, 1);
});

test('RG-G8 : téléphones et numéros dans le chat masqués avant paiement sécurisé', async () => {
  const provider = await createProvider({ name: 'Plombier G8' });
  const client = await registerUser('Client G8');
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ provider_id: provider.user.id }));
  const id = r.body.id;
  await api().post(`/api/v1/jobs/${id}/accept`).set(auth(provider.token)).send({});
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.provider.phone, null);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(provider.token));
  assert.equal(r.body.client.phone, null);
  assert.ok(r.body.client.trust); // RG-G7
  assert.deepEqual(Object.keys(r.body.client.trust).sort(), ['disputes_lost', 'jobs_paid', 'rating_avg', 'rating_count']);

  r = await api().post('/api/v1/conversations').set(auth(provider.token)).send({ user_id: client.user.id, job_id: id });
  const conv = r.body.id;
  await api().post(`/api/v1/conversations/${conv}/messages`).set(auth(provider.token)).send({ type: 'text', body: 'Appelez-moi au 6 90 12 34 56 svp' });
  r = await api().get(`/api/v1/conversations/${conv}/messages`).set(auth(client.token));
  assert.ok(!/90 12 34 56/.test(r.body.items[0].body), r.body.items[0].body);
  assert.match(r.body.items[0].body, /visible après paiement sécurisé/);

  // après paiement : visibles
  r = await api().post(`/api/v1/jobs/${id}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  await waitTx(r.body.transaction.id);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.provider.phone, provider.phone);
  r = await api().get(`/api/v1/conversations/${conv}/messages`).set(auth(client.token));
  assert.match(r.body.items[0].body, /90 12 34 56/);
});

test('RG-G7 : le prestataire note le client (réputation client exposée)', async () => {
  const provider = await createProvider({ name: 'Plombier G7' });
  const client = await registerUser('Client G7');
  const { id, code } = await fundedJob(client, provider);
  await advance(provider, id, ['en_route', 'arrived', 'in_progress', 'done'], code);
  await api().post(`/api/v1/jobs/${id}/complete`).set(auth(client.token)).send({});
  let r = await api().post(`/api/v1/jobs/${id}/review`).set(auth(provider.token)).send({ rating: 4, comment: 'Client correct' });
  assert.equal(r.status, 201);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(provider.token));
  assert.equal(r.body.client.trust.rating_avg, 4);
  assert.equal(r.body.client.trust.rating_count, 1);
  assert.equal(r.body.client.trust.jobs_paid, 1);
  // la note reçue en tant que client n'affecte pas une note prestataire
  r = await api().get('/api/v1/me').set(auth(provider.token));
  assert.equal(r.body.provider.rating_count, 0);
});

test('RG-G9 : résultat de paiement rejoué sans double effet', async () => {
  const provider = await createProvider({ name: 'Plombier G9' });
  const client = await registerUser('Client G9');
  const { id } = await fundedJob(client, provider);
  const { handlePaymentResult } = await import('../src/modules/payments/service.js');
  const { rows } = await pool.query(`SELECT id FROM transactions WHERE job_id = $1 AND type = 'escrow_in'`, [id]);
  const again = await handlePaymentResult({ provider: 'mock', reference: rows[0].id, status: 'success' });
  assert.equal(again, null);
  const r = await pool.query(`SELECT count(*)::int AS n FROM transactions WHERE job_id = $1 AND type = 'refund'`, [id]);
  assert.equal(r.rows[0].n, 0);
});

test('mode instant : deux prestataires acceptent en même temps → un seul gagne, l\'autre 409 + job:closed', async () => {
  const p1 = await createProvider({ name: 'Rapide Un' });
  const p2 = await createProvider({ name: 'Rapide Deux' });
  const client = await registerUser('Client Instant');
  const s1 = await connect(p1.token);
  const s2 = await connect(p2.token);
  const closed1 = collect(s1, 'job:closed');
  const closed2 = collect(s2, 'job:closed');
  const news2 = collect(s2, 'job:new');
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody());
  assert.equal(r.body.mode, 'instant');
  const id = r.body.id;
  await waitFor(() => news2.some((j) => j.id === id));
  const [a, b] = await Promise.all([
    api().post(`/api/v1/jobs/${id}/accept`).set(auth(p1.token)).send({}),
    api().post(`/api/v1/jobs/${id}/accept`).set(auth(p2.token)).send({}),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.error.code, 'CONFLICT');
  assert.match(loser.body.error.message, /déjà été attribuée/);
  const loserClosed = a.status === 409 ? closed1 : closed2;
  await waitFor(() => loserClosed.some((e) => e.job_id === id && e.reason === 'assigned'));
  // la mission disparaît de /jobs/nearby
  r = await api().get(`/api/v1/jobs/nearby?lat=${YDE.lat}&lng=${YDE.lng}`).set(auth(a.status === 409 ? p1.token : p2.token));
  assert.ok(!r.body.items.some((j) => j.id === id));
});

test('mode direct : jamais diffusé, seul le prestataire ciblé peut accepter', async () => {
  const target = await createProvider({ name: 'Cible Directe' });
  const other = await createProvider({ name: 'Voisin Curieux' });
  const client = await registerUser('Client Direct');
  const so = await connect(other.token);
  const newsOther = collect(so, 'job:new');
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ mode: 'direct', provider_id: target.user.id }));
  assert.equal(r.status, 201);
  const id = r.body.id;
  r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ mode: 'direct' }));
  assert.equal(r.status, 400); // provider_id obligatoire
  await new Promise((res) => setTimeout(res, 200));
  assert.ok(!newsOther.some((j) => j.id === id));
  r = await api().get(`/api/v1/jobs/nearby?lat=${YDE.lat}&lng=${YDE.lng}`).set(auth(other.token));
  assert.ok(!r.body.items.some((j) => j.id === id));
  r = await api().post(`/api/v1/jobs/${id}/accept`).set(auth(other.token)).send({});
  assert.equal(r.status, 404);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(other.token));
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/jobs/${id}/accept`).set(auth(target.token)).send({});
  assert.equal(r.status, 200);
});

test('lookup prestataire par code Tasko ou téléphone', async () => {
  const p = await createProvider({ name: 'Code Public' });
  const client = await registerUser('Client Lookup');
  let r = await api().get('/api/v1/me').set(auth(p.token));
  const code = r.body.provider.public_code;
  assert.match(code, /^TSK-[A-Z0-9]{5}$/);
  r = await api().get(`/api/v1/providers/lookup?code=${code}`).set(auth(client.token));
  assert.equal(r.status, 200);
  assert.equal(r.body.id, p.user.id);
  r = await api().get(`/api/v1/providers/lookup?phone=${encodeURIComponent(p.phone)}`).set(auth(client.token));
  assert.equal(r.body.id, p.user.id);
  r = await api().get('/api/v1/providers/lookup?code=TSK-ZZZZZ').set(auth(client.token));
  assert.equal(r.status, 404);
});

test('offre créée par le prestataire : client identifié par téléphone, puis paiement pour confirmer', async () => {
  const p = await createProvider({ name: 'Bika Offre' });
  const client = await registerUser('Client Offre');
  let r = await api().post('/api/v1/jobs/offer').set(auth(p.token)).send({
    client_phone: client.phone, category_id: cats.plomberie, description: 'Remplacement du siphon', price: 5000,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.origin, 'provider_offer');
  assert.equal(r.body.mode, 'direct');
  assert.equal(r.body.status, 'accepted');
  assert.equal(r.body.client.id, client.user.id);
  const id = r.body.id;
  r = await api().get('/api/v1/notifications?type=job').set(auth(client.token));
  assert.ok(r.body.items.some((n) => n.data.job_id === id && /vous propose/.test(n.title)));
  r = await api().post(`/api/v1/jobs/${id}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  await waitTx(r.body.transaction.id);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.status, 'funded');

  r = await api().post('/api/v1/jobs/offer').set(auth(p.token)).send({
    client_phone: '+237677777771', category_id: cats.plomberie, description: 'Inconnu', price: 5000,
  });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.details.can_invite, true);
  r = await api().post('/api/v1/invitations').set(auth(p.token)).send({ phone: '+237677777771' });
  assert.deepEqual(r.body, { ok: true });
});

test('reçu JSON et HTML', async () => {
  const provider = await createProvider({ name: 'Plombier Reçu' });
  const client = await registerUser('Client Reçu');
  const { id } = await fundedJob(client, provider);
  let r = await api().get(`/api/v1/jobs/${id}/receipt`).set(auth(client.token));
  assert.equal(r.status, 200);
  assert.match(r.body.number, /^TSK-\d{4}-\d{6}$/);
  assert.equal(r.body.total, 5250);
  assert.equal(r.body.service_fee, 250);
  assert.deepEqual(r.body.lines, [{ label: r.body.lines[0].label, amount: 5000 }]);
  const again = await api().get(`/api/v1/jobs/${id}/receipt`).set(auth(provider.token));
  assert.equal(again.body.number, r.body.number); // numéro stable
  r = await api().get(`/api/v1/jobs/${id}/receipt.html`).set(auth(client.token));
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /html/);
  assert.match(r.text, /Total payé/);
});
