// Fournisseurs Campay et Monetbil : réponses HTTP simulées (fetch intercepté — aucun appel réseau réel).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { PASSWORD, advance, api, auth, closeAll, createProvider, jobBody, makeAdmin, pool, registerUser, resetDb, waitFor } from './helpers.js';
import { config } from '../src/config.js';
import { resetCampayToken } from '../src/payments/campay.js';
import { monetbilSign } from '../src/payments/monetbil.js';
import { runSchedulerOnce } from '../src/scheduler/index.js';

const CAMPAY_KEY = 'test-campay-webhook-key';
const MB_SECRET = 'test-monetbil-secret';
const MB_KEY = 'test-monetbil-service';

// ------------------------------------------------------------------ faux fournisseurs (fetch intercepté)
const realFetch = globalThis.fetch;
const calls = [];
const campayTx = new Map(); // reference → { status, amount, currency, external_reference, endpoint }
const monetbilTx = new Map(); // paymentId → { status, amount, payment_ref }
let seq = 0;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function readBody(init) {
  if (!init?.body) return {};
  if (init.body instanceof URLSearchParams) return Object.fromEntries(init.body);
  return JSON.parse(init.body);
}

async function fakeFetch(input, init = {}) {
  const url = new URL(String(input));
  const body = readBody(init);
  calls.push({ url: url.toString(), method: init.method || 'GET', body, headers: init.headers || {} });
  if (url.host === 'campay.test') {
    const p = url.pathname.replace(/^\/api/, '');
    if (p === '/token/') return json({ token: 'tok-123', expires_in: 3600 });
    if (init.headers?.Authorization !== 'Token tok-123') return json({ detail: 'unauthorized' }, 401);
    if (p === '/collect/') {
      const reference = `CP-${++seq}`;
      campayTx.set(reference, { status: 'PENDING', amount: String(body.amount), currency: 'XAF', external_reference: body.external_reference, endpoint: 'collect' });
      return json({ reference, ussd_code: '*126#', operator: 'mtn' });
    }
    if (p === '/withdraw/') {
      const reference = `CPW-${++seq}`;
      campayTx.set(reference, { status: 'PENDING', amount: String(body.amount), currency: 'XAF', external_reference: body.external_reference, endpoint: 'withdraw' });
      return json({ reference, status: 'PENDING' });
    }
    const m = p.match(/^\/transaction\/([^/]+)\/$/);
    if (m) {
      const t = campayTx.get(decodeURIComponent(m[1]));
      return t ? json({ reference: m[1], ...t }) : json({ message: 'not found' }, 404);
    }
    if (p === '/balance/') return json({ total_balance: 120000, mtn_balance: 100000, orange_balance: 20000, currency: 'XAF' });
    return json({ message: 'unknown' }, 404);
  }
  if (url.host === 'monetbil.test') {
    if (url.pathname.endsWith('/placePayment')) {
      if (body.service !== MB_KEY) return json({ status: 'SERVICE_NOT_FOUND' }, 400);
      const paymentId = `MB-${++seq}`;
      monetbilTx.set(paymentId, { status: 0, pending: true, amount: Number(body.amount), payment_ref: body.payment_ref });
      return json({ status: 'REQUEST_ACCEPTED', message: 'payment pending', channel: 'CM_MTNMOBILEMONEY', paymentId });
    }
    if (url.pathname.endsWith('/checkPayment')) {
      const t = monetbilTx.get(body.paymentId);
      if (!t) return json({ paymentId: body.paymentId, message: 'payment not found' });
      if (t.pending) return json({ paymentId: body.paymentId, message: 'payment pending' });
      return json({ paymentId: body.paymentId, transaction: { status: t.status, testmode: 0, amount: t.amount, currency: 'XAF', payment_ref: t.payment_ref } });
    }
    return json({ message: 'unknown' }, 404);
  }
  throw new Error(`Appel réseau inattendu dans les tests : ${url}`);
}

function configureCampay(on = true) {
  Object.assign(config.campay, on
    ? { baseUrl: 'https://campay.test/api', username: 'app-user', password: 'app-pass', token: '', webhookKey: CAMPAY_KEY }
    : { username: '', password: '', token: '', webhookKey: '' });
  resetCampayToken();
}
function configureMonetbil(on = true) {
  Object.assign(config.monetbil, on
    ? { serviceKey: MB_KEY, serviceSecret: MB_SECRET, apiUrl: 'https://monetbil.test/payment/v1', widgetUrl: 'https://monetbil.test/widget/v2.1', payoutEnabled: false }
    : { serviceKey: '', serviceSecret: '' });
}

// ------------------------------------------------------------------ utilitaires
let admin;
let provider;
let client;

const setSettings = (patch) => api().put('/api/v1/admin/settings').set(auth(admin.token)).send(patch);
const campaySig = (key = CAMPAY_KEY) => jwt.sign({ source: 'CamPay' }, key, { algorithm: 'HS256' });

function campayWebhook(reference, { key, method = 'post', extra = {} } = {}) {
  const t = campayTx.get(reference);
  const fields = { status: t.status, reference, amount: t.amount, currency: 'XAF', operator: 'MTN', endpoint: t.endpoint, external_reference: t.external_reference, signature: campaySig(key), ...extra };
  if (method === 'get') return api().get('/api/v1/payments/webhook/campay').query(fields);
  return api().post('/api/v1/payments/webhook/campay').send(fields);
}

function monetbilWebhook(paymentId, { secret = MB_SECRET, extra = {} } = {}) {
  const t = monetbilTx.get(paymentId);
  const fields = {
    service: MB_KEY, transaction_id: paymentId, transaction_uuid: `uuid-${paymentId}`, msisdn: '237690000001',
    amount: String(t.amount), fee: '0', status: 'success', message: 'ok', currency: 'XAF', item_ref: 'tasko', payment_ref: t.payment_ref, ...extra,
  };
  fields.sign = monetbilSign(secret, fields);
  return api().post('/api/v1/payments/webhook/monetbil').type('form').send(fields);
}

/** Mission directe acceptée, paiement initié : { id, tx } */
async function acceptedAndPay() {
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ provider_id: provider.user.id }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  r = await api().post(`/api/v1/jobs/${id}/accept`).set(auth(provider.token)).send({});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await api().post(`/api/v1/jobs/${id}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id, tx: r.body.transaction, checkout_url: r.body.checkout_url };
}

const jobRow = async (id) => (await pool.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
const txRow = async (id) => (await pool.query('SELECT * FROM transactions WHERE id = $1', [id])).rows[0];

/** Mission financée puis terminée et validée par le client → payout créé. Retourne la transaction payout. */
async function completeJob(id) {
  const view = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  await advance(provider, id, ['en_route', 'arrived', 'in_progress', 'done'], view.body.start_code);
  const r = await api().post(`/api/v1/jobs/${id}/complete`).set(auth(client.token)).send({});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return waitFor(async () => (await pool.query(`SELECT * FROM transactions WHERE job_id = $1 AND type = 'payout'`, [id])).rows[0]);
}

before(async () => {
  globalThis.fetch = fakeFetch;
  configureCampay(false);
  configureMonetbil(false);
  await resetDb();
  admin = await registerUser('Admin Paiements');
  await makeAdmin(admin.user.id);
  provider = await createProvider({ name: 'Prestataire Paiements' });
  client = await registerUser('Client Paiements');
});
after(async () => {
  globalThis.fetch = realFetch;
  configureCampay(false);
  configureMonetbil(false);
  await closeAll();
});

// ------------------------------------------------------------------ tests
test('fournisseur non configuré refusé ; GET /admin/payment-providers expose configuration, capacités et frais', async () => {
  let r = await setSettings({ payment_provider: 'campay' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  assert.match(r.body.error.message, /Campay.*non configuré/);
  r = await setSettings({ payout_provider: 'monetbil' });
  assert.equal(r.status, 400);
  r = await setSettings({ payment_provider: 'paypal' });
  assert.equal(r.status, 400);

  r = await api().get('/api/v1/admin/payment-providers').set(auth(admin.token));
  assert.equal(r.status, 200);
  const byId = Object.fromEntries(r.body.items.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(byId), ['mock', 'notchpay', 'campay', 'monetbil']);
  assert.equal(byId.mock.configured, true);
  assert.equal(byId.campay.configured, false);
  assert.deepEqual(byId.campay.fees, { collect_rate: 0.02, payout_rate: 0.01, bank_flat: 5000 });
  assert.deepEqual(byId.campay.supports, { collect: true, payout_momo: true, payout_bank: false, balance: true });
  assert.equal(byId.monetbil.supports.payout_momo, false);
  assert.match(byId.campay.docs_url, /^https:\/\//);
  r = await api().get('/api/v1/admin/payment-providers').set(auth(client.token));
  assert.equal(r.status, 403);

  configureCampay(true);
  configureMonetbil(true);
  r = await api().get('/api/v1/admin/payment-providers').set(auth(admin.token));
  assert.ok(r.body.items.find((p) => p.id === 'campay').configured);
  r = await setSettings({ payment_provider: 'campay', payout_provider: 'same' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.payment_provider, 'campay');
  assert.equal(r.body.payout_provider, 'same');
});

test('Campay : encaissement initié, webhook signé → re-vérification → funded ; rejeu idempotent ; mauvaise signature refusée', async () => {
  const { id, tx } = await acceptedAndPay();
  assert.equal(tx.provider, 'campay');
  assert.match(tx.external_ref, /^CP-/);
  const collect = calls.find((c) => c.url.endsWith('/collect/') && c.body.external_reference === tx.id);
  assert.ok(collect, 'collect appelé avec notre référence');
  assert.equal(collect.body.from, client.phone.replace('+', ''));
  assert.equal(collect.body.currency, 'XAF');
  assert.equal(Number(collect.body.amount), tx.amount);

  // mauvaise signature (autre clé) → 401, rien ne bouge
  campayTx.get(tx.external_ref).status = 'SUCCESSFUL';
  let r = await campayWebhook(tx.external_ref, { key: 'mauvaise-cle' });
  assert.equal(r.status, 401);
  r = await api().post('/api/v1/payments/webhook/campay').send({ reference: tx.external_ref, status: 'SUCCESSFUL' });
  assert.equal(r.status, 401);
  assert.equal((await jobRow(id)).status, 'accepted');

  // le corps du webhook dit SUCCESSFUL mais l'API dit PENDING → pas de crédit
  campayTx.get(tx.external_ref).status = 'PENDING';
  r = await campayWebhook(tx.external_ref, { extra: { status: 'SUCCESSFUL' } });
  assert.equal(r.status, 200);
  assert.equal((await jobRow(id)).status, 'accepted');

  campayTx.get(tx.external_ref).status = 'SUCCESSFUL';
  r = await campayWebhook(tx.external_ref, { method: 'get' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const job = await jobRow(id);
  assert.equal(job.status, 'funded');
  assert.equal(job.payment_status, 'held');
  assert.equal((await txRow(tx.id)).status, 'success');

  // rejeu : sans effet (code de démarrage inchangé, une seule transaction réussie)
  r = await campayWebhook(tx.external_ref);
  assert.equal(r.status, 200);
  assert.equal(r.body.ignored, 'already_processed');
  assert.equal((await jobRow(id)).start_code, job.start_code);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM transactions WHERE job_id = $1 AND type = 'escrow_in' AND status = 'success'`, [id]);
  assert.equal(rows[0].n, 1);

  // versement prestataire via Campay /withdraw/, confirmé par webhook (endpoint = withdraw) après re-vérification
  const payout = await completeJob(id);
  assert.equal(payout.provider, 'campay');
  await waitFor(async () => (await txRow(payout.id)).external_ref);
  const po = await txRow(payout.id);
  assert.match(po.external_ref, /^CPW-/);
  const withdraw = calls.find((c) => c.url.endsWith('/withdraw/') && c.body.external_reference === payout.id);
  assert.equal(Number(withdraw.body.amount), payout.amount);
  assert.equal(po.status, 'pending');
  campayTx.get(po.external_ref).status = 'SUCCESSFUL';
  r = await campayWebhook(po.external_ref);
  assert.equal(r.status, 200);
  assert.equal((await txRow(payout.id)).status, 'success');
});

test('Campay : montant différent chez le fournisseur → refusé, mission non financée, admin alerté', async () => {
  const { id, tx } = await acceptedAndPay();
  const t = campayTx.get(tx.external_ref);
  t.status = 'SUCCESSFUL';
  t.amount = String(tx.amount - 1000);
  const r = await campayWebhook(tx.external_ref, { extra: { amount: String(tx.amount) } });
  assert.equal(r.status, 409);
  const job = await jobRow(id);
  assert.notEqual(job.status, 'funded');
  assert.equal(job.payment_status, 'unpaid');
  const row = await txRow(tx.id);
  assert.equal(row.status, 'failed');
  assert.equal(row.meta.amount_mismatch.received, tx.amount - 1000);
  const n = await pool.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Montant de paiement incohérent'`, [admin.user.id]);
  assert.equal(n.rowCount, 1);
});

test('chaque transaction garde son fournisseur : webhook Campay traité après passage à Monetbil, webhook croisé ignoré', async () => {
  const { id, tx } = await acceptedAndPay();
  assert.equal(tx.provider, 'campay');
  let r = await setSettings({ payment_provider: 'monetbil' });
  assert.equal(r.status, 200);
  // un webhook Monetbil (signature valide) qui cite cette transaction Campay est ignoré
  monetbilTx.set('MB-FAKE', { status: 1, pending: false, amount: tx.amount, payment_ref: tx.id });
  r = await monetbilWebhook('MB-FAKE');
  assert.equal(r.status, 200);
  assert.equal(r.body.ignored, 'provider_mismatch');
  assert.equal((await jobRow(id)).status, 'accepted');
  // le webhook Campay est re-vérifié auprès de Campay (pas de Monetbil)
  campayTx.get(tx.external_ref).status = 'SUCCESSFUL';
  const before = calls.length;
  r = await campayWebhook(tx.external_ref);
  assert.equal(r.status, 200);
  assert.ok(calls.slice(before).some((c) => c.url.includes(`/transaction/${tx.external_ref}/`)));
  assert.ok(!calls.slice(before).some((c) => c.url.includes('monetbil')));
  assert.equal((await jobRow(id)).status, 'funded');
});

test('Monetbil : placePayment, notification signée → checkPayment → funded ; rejeu ; signature et montant invalides refusés', async () => {
  let r = await setSettings({ payment_provider: 'monetbil', payout_provider: 'same' });
  assert.equal(r.status, 200);
  const { id, tx } = await acceptedAndPay();
  assert.equal(tx.provider, 'monetbil');
  assert.match(tx.external_ref, /^MB-/);
  const place = calls.find((c) => c.url.endsWith('/placePayment') && c.body.payment_ref === tx.id);
  assert.equal(place.body.service, MB_KEY);
  assert.equal(place.body.operator, 'CM_MTNMOBILEMONEY');
  assert.equal(Number(place.body.amount), tx.amount);

  r = await monetbilWebhook(tx.external_ref, { secret: 'mauvais-secret' });
  assert.equal(r.status, 401);
  // champ modifié après signature → 401
  const t = monetbilTx.get(tx.external_ref);
  const fields = { service: MB_KEY, transaction_id: tx.external_ref, amount: String(tx.amount), status: 'success', payment_ref: tx.id };
  fields.sign = monetbilSign(MB_SECRET, fields);
  r = await api().post('/api/v1/payments/webhook/monetbil').type('form').send({ ...fields, amount: '1' });
  assert.equal(r.status, 401);

  // checkPayment encore en attente → aucun crédit malgré status=success dans la notification
  r = await monetbilWebhook(tx.external_ref);
  assert.equal(r.status, 200);
  assert.equal((await jobRow(id)).status, 'accepted');

  t.pending = false;
  t.status = 1;
  r = await monetbilWebhook(tx.external_ref);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await jobRow(id)).status, 'funded');
  r = await monetbilWebhook(tx.external_ref);
  assert.equal(r.body.ignored, 'already_processed');

  // versement Monetbil non supporté → échec propre, crédité au portefeuille, admin prévenu
  const payout = await completeJob(id);
  assert.equal(payout.provider, 'monetbil');
  const po = await waitFor(async () => { const x = await txRow(payout.id); return x.status !== 'pending' ? x : null; });
  assert.equal(po.status, 'failed');
  assert.match(po.meta.failure_reason, /Monetbil ne propose pas de versement automatique/);
  r = await api().get('/api/v1/me/wallet').set(auth(provider.token));
  assert.ok(r.body.available >= payout.amount);
  const n = await pool.query(`SELECT body FROM notifications WHERE user_id = $1 AND title = 'Versement non effectué'`, [admin.user.id]);
  assert.equal(n.rowCount, 1);

  // montant différent
  const second = await acceptedAndPay();
  const t2 = monetbilTx.get(second.tx.external_ref);
  Object.assign(t2, { pending: false, status: 1, amount: second.tx.amount + 500 });
  r = await monetbilWebhook(second.tx.external_ref);
  assert.equal(r.status, 409);
  assert.notEqual((await jobRow(second.id)).status, 'funded');
  assert.equal((await txRow(second.tx.id)).status, 'failed');
});

test('payout_provider : encaisser avec Monetbil, verser avec Campay ; trésorerie (frais, banque refusée, solde)', async () => {
  let r = await setSettings({ payment_provider: 'monetbil', payout_provider: 'campay' });
  assert.equal(r.status, 200);
  const { id, tx } = await acceptedAndPay();
  assert.equal(tx.provider, 'monetbil');
  Object.assign(monetbilTx.get(tx.external_ref), { pending: false, status: 1 });
  r = await monetbilWebhook(tx.external_ref);
  assert.equal((await jobRow(id)).status, 'funded');
  const payout = await completeJob(id);
  assert.equal(payout.provider, 'campay');
  await waitFor(async () => (await txRow(payout.id)).external_ref);
  assert.ok(calls.some((c) => c.url.endsWith('/withdraw/') && c.body.external_reference === payout.id));
  // vérification de statut par le planificateur (webhook perdu)
  campayTx.get((await txRow(payout.id)).external_ref).status = 'SUCCESSFUL';
  await runSchedulerOnce({ now: new Date(Date.now() + 5 * 60_000), only: ['provider_reconciliation'] });
  assert.equal((await txRow(payout.id)).status, 'success');

  // trésorerie : solde Campay, banque refusée avec message clair, frais MoMo 1 %
  r = await api().get('/api/v1/admin/treasury').set(auth(admin.token));
  assert.equal(r.body.aggregator_balance, 120000);
  assert.equal(r.body.payout_provider, 'campay');
  const bank = await api().post('/api/v1/admin/payout-accounts').set(auth(admin.token)).send({
    type: 'bank', label: 'Ecobank', bank_name: 'Ecobank Cameroun', account_holder: 'Tasko SAS', account_number: 'CM21 10005 00001 99999999911',
  });
  r = await api().post('/api/v1/admin/treasury/withdrawals').set(auth(admin.token)).send({ amount: 100, payout_account_id: bank.body.id, password: PASSWORD });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.message, 'Avec Campay, le virement bancaire se fait depuis le tableau de bord Campay');
  const momo = await api().post('/api/v1/admin/payout-accounts').set(auth(admin.token)).send({ type: 'mtn_momo', label: 'MoMo admin', phone: '677123456' });
  r = await api().post('/api/v1/admin/treasury/withdrawals').set(auth(admin.token)).send({ amount: 200, payout_account_id: momo.body.id, password: PASSWORD });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.fee, 2);
  const w = calls.filter((c) => c.url.endsWith('/withdraw/')).at(-1);
  assert.equal(w.body.to, '237677123456');

  // retour au simulateur (toujours configuré)
  r = await setSettings({ payment_provider: 'mock', payout_provider: 'same' });
  assert.equal(r.status, 200);
});
