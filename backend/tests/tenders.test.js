// V2 — appels d'offres (bids, attribution atomique, rejet, date limite) et jalons séquestrés un par un.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { YDE, advance, api, auth, cats, closeAll, createProvider, pool, registerUser, resetDb, waitFor, waitTx } from './helpers.js';
import { runSchedulerOnce } from '../src/scheduler/index.js';

before(resetDb);
after(closeAll);

const tenderBody = (extra = {}) => ({
  mode: 'tender',
  category_id: cats.plomberie,
  title: 'Réfection de la plomberie de l\'immeuble',
  description: 'Remplacement des colonnes montantes sur 4 étages',
  lat: YDE.lat,
  lng: YDE.lng,
  urgency: 'scheduled',
  scheduled_at: new Date(Date.now() + 10 * 86400e3).toISOString(),
  budget_min: 200000,
  budget_max: 500000,
  bid_deadline: new Date(Date.now() + 3 * 86400e3).toISOString(),
  ...extra,
});

let client;
let pA;
let pB;
let pNoSkill;
let tenderId;
let bidA;
let bidB;

test('appel d\'offres public : création, liste /tenders, offres, éligibilité', async () => {
  client = await registerUser('Syndic Test');
  pA = await createProvider({ name: 'Plombier Offre A' });
  pB = await createProvider({ name: 'Plombier Offre B', rating: 4.8, missions: 40 });
  pNoSkill = await createProvider({ name: 'Coiffeuse Hors Sujet', skills: [{ category_id: cats.coiffure, base_price: 2000 }] });

  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(tenderBody());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.mode, 'tender');
  assert.equal(r.body.visibility, 'public');
  assert.equal(r.body.status, 'requested');
  assert.equal(r.body.bids_count, 0);
  tenderId = r.body.id;

  r = await api().get('/api/v1/tenders').set(auth(pA.token));
  assert.ok(r.body.items.some((j) => j.id === tenderId));
  r = await api().get('/api/v1/tenders').set(auth(pNoSkill.token));
  assert.ok(!r.body.items.some((j) => j.id === tenderId));

  r = await api().post(`/api/v1/jobs/${tenderId}/bids`).set(auth(pA.token)).send({ amount: 450000, duration_days: 12, message: 'Matériel inclus' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'pending');
  assert.equal(r.body.provider.id, pA.user.id);
  bidA = r.body.id;
  // mise à jour de sa propre offre (unicité job/prestataire)
  r = await api().post(`/api/v1/jobs/${tenderId}/bids`).set(auth(pA.token)).send({ amount: 420000, duration_days: 12 });
  assert.equal(r.body.id, bidA);
  assert.equal(r.body.amount, 420000);

  // jalons dont la somme ≠ montant → 400
  r = await api().post(`/api/v1/jobs/${tenderId}/bids`).set(auth(pB.token))
    .send({ amount: 400000, milestones: [{ title: 'Gros œuvre', amount: 150000 }, { title: 'Finitions', amount: 200000 }] });
  assert.equal(r.status, 400);
  r = await api().post(`/api/v1/jobs/${tenderId}/bids`).set(auth(pB.token))
    .send({ amount: 400000, duration_days: 10, milestones: [{ title: 'Gros œuvre', amount: 200000 }, { title: 'Finitions', amount: 200000 }] });
  assert.equal(r.status, 201);
  bidB = r.body.id;

  r = await api().post(`/api/v1/jobs/${tenderId}/bids`).set(auth(pNoSkill.token)).send({ amount: 300000 });
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/jobs/${tenderId}/accept`).set(auth(pA.token)).send({});
  assert.equal(r.status, 409);

  // client : toutes les offres triées par score ; prestataire : la sienne
  r = await api().get(`/api/v1/jobs/${tenderId}/bids`).set(auth(client.token));
  assert.equal(r.body.items.length, 2);
  assert.ok(r.body.items[0].score >= r.body.items[1].score);
  r = await api().get(`/api/v1/jobs/${tenderId}/bids`).set(auth(pA.token));
  assert.deepEqual(r.body.items.map((b) => b.id), [bidA]);
  r = await api().get(`/api/v1/jobs/${tenderId}`).set(auth(pA.token));
  assert.equal(r.body.my_bid.id, bidA);
  assert.equal(r.body.bids_count, 2);
});

test('attribution : job accepted avec les jalons de l\'offre, autres offres rejetées, plus d\'offre possible', async () => {
  let r = await api().post(`/api/v1/jobs/${tenderId}/bids/${bidB}/award`).set(auth(pA.token));
  assert.equal(r.status, 404); // seul le client attribue
  r = await api().post(`/api/v1/jobs/${tenderId}/bids/${bidB}/award`).set(auth(client.token));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'accepted');
  assert.equal(r.body.provider.id, pB.user.id);
  assert.equal(r.body.price, 400000);
  assert.equal(r.body.milestones.length, 2);
  assert.equal(r.body.milestones[0].service_fee, 10000);
  assert.equal(r.body.total, 420000);
  const { rows } = await pool.query('SELECT id, status FROM bids WHERE job_id = $1', [tenderId]);
  const st = Object.fromEntries(rows.map((b) => [b.id, b.status]));
  assert.equal(st[bidA], 'rejected');
  assert.equal(st[bidB], 'accepted');
  r = await api().post(`/api/v1/jobs/${tenderId}/bids`).set(auth(pA.token)).send({ amount: 100000 });
  assert.equal(r.status, 409);
  r = await api().post(`/api/v1/jobs/${tenderId}/bids/${bidA}/award`).set(auth(client.token));
  assert.equal(r.status, 409);
});

test('jalons : séquestre jalon par jalon, soumission, libération, clôture', async () => {
  let r = await api().get(`/api/v1/jobs/${tenderId}`).set(auth(client.token));
  const [m1, m2] = r.body.milestones;
  // prestataire ne peut pas démarrer avant le 1er jalon payé
  r = await api().post(`/api/v1/jobs/${tenderId}/status`).set(auth(pB.token)).send({ status: 'en_route' });
  assert.equal(r.status, 409);
  r = await api().post(`/api/v1/jobs/${tenderId}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  assert.equal(r.body.transaction.amount, m1.total);
  assert.equal(r.body.transaction.milestone_id, m1.id);
  await waitTx(r.body.transaction.id);
  r = await api().get(`/api/v1/jobs/${tenderId}`).set(auth(client.token));
  assert.equal(r.body.status, 'funded');
  assert.equal(r.body.milestones[0].status, 'funded');
  assert.equal(r.body.milestones[1].status, 'pending');
  const code = r.body.start_code;
  await advance(pB, tenderId, ['en_route', 'arrived', 'in_progress'], code);
  // jalon 2 non séquestré → 409
  r = await api().post(`/api/v1/jobs/${tenderId}/milestones/${m2.id}/submit`).set(auth(pB.token)).send({});
  assert.equal(r.status, 409);
  r = await api().post(`/api/v1/jobs/${tenderId}/status`).set(auth(pB.token)).send({ status: 'done' });
  assert.equal(r.status, 409); // mission par jalons
  r = await api().post(`/api/v1/jobs/${tenderId}/milestones/${m1.id}/submit`).set(auth(pB.token)).send({ proof_photos: ['/uploads/etage1.jpg'], note: 'Gros œuvre terminé' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.milestones[0].status, 'submitted');
  assert.equal(r.body.status, 'in_progress');
  r = await api().post(`/api/v1/jobs/${tenderId}/milestones/${m1.id}/release`).set(auth(client.token));
  assert.equal(r.status, 200);
  assert.equal(r.body.milestones[0].status, 'released');
  const { rows } = await pool.query(`SELECT type, amount FROM transactions WHERE milestone_id = $1 AND type IN ('payout', 'commission')`, [m1.id]);
  assert.deepEqual(Object.fromEntries(rows.map((t) => [t.type, t.amount])), { payout: 200000, commission: 10000 });

  // jalon 2 : paiement, soumission → mission done, libération auto du jalon à échéance
  r = await api().post(`/api/v1/jobs/${tenderId}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  assert.equal(r.body.transaction.milestone_id, m2.id);
  await waitTx(r.body.transaction.id);
  r = await api().post(`/api/v1/jobs/${tenderId}/milestones/${m2.id}/submit`).set(auth(pB.token)).send({});
  assert.equal(r.body.status, 'done');
  await runSchedulerOnce({ now: new Date(Date.now() + 49 * 3600e3), only: ['auto_release'] });
  r = await api().get(`/api/v1/jobs/${tenderId}`).set(auth(client.token));
  assert.equal(r.body.status, 'completed');
  assert.equal(r.body.completed_by, 'auto');
  assert.ok(r.body.milestones.every((m) => m.status === 'released'));
  r = await api().get('/api/v1/me/wallet').set(auth(pB.token));
  assert.equal(r.status, 200);
  await waitFor(async () => (await api().get('/api/v1/me/wallet').set(auth(pB.token))).body.paid_out_total === 400000);
});

test('date limite : offre refusée après échéance, clôture par le planificateur (job:closed expired)', async () => {
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(tenderBody({ title: 'Peinture du hall' }));
  const id = r.body.id;
  await pool.query(`UPDATE jobs SET bid_deadline = now() - interval '1 minute' WHERE id = $1`, [id]);
  r = await api().post(`/api/v1/jobs/${id}/bids`).set(auth(pA.token)).send({ amount: 100000 });
  assert.equal(r.status, 409);
  const res = await runSchedulerOnce({ only: ['tenders'] });
  assert.ok(res.results.tenders >= 1);
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  assert.equal(r.body.status, 'cancelled'); // aucune offre reçue
  assert.equal(r.body.cancelled_by, 'system');

  // appel d'offres sur invitation : seuls les invités voient et répondent
  r = await api().post('/api/v1/jobs').set(auth(client.token)).send(tenderBody({ title: 'Audit sur invitation', visibility: 'invited', invited_provider_ids: [pA.user.id] }));
  const inv = r.body.id;
  r = await api().get(`/api/v1/jobs/${inv}`).set(auth(pB.token));
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/jobs/${inv}/bids`).set(auth(pB.token)).send({ amount: 100000 });
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/jobs/${inv}/bids`).set(auth(pA.token)).send({ amount: 100000 });
  assert.equal(r.status, 201);
  r = await api().delete(`/api/v1/jobs/${inv}/bids/${r.body.id}`).set(auth(pA.token));
  assert.deepEqual(r.body, { ok: true });
});
