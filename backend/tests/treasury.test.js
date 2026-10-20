// V2 — trésorerie admin, portefeuille prestataire, comptes entreprise / biens / récurrences, IDOR.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, advance, api, auth, cats, closeAll, createProvider, fundedJob, makeAdmin, pool, registerUser, resetDb, waitFor, waitTx } from './helpers.js';
import { runSchedulerOnce } from '../src/scheduler/index.js';

let admin;
let admin2;
let provider;
let client;
let stranger;
let jobId;

before(async () => {
  await resetDb();
  admin = await registerUser('Admin Trésor');
  admin2 = await registerUser('Admin Bis');
  await makeAdmin(admin.user.id);
  await makeAdmin(admin2.user.id);
  provider = await createProvider({ name: 'Prestataire Trésor' });
  client = await registerUser('Client Trésor');
  stranger = await registerUser('Curieux Indiscret');
  // revenu : une mission terminée (frais de service 250)
  const f = await fundedJob(client, provider);
  jobId = f.id;
  await advance(provider, jobId, ['en_route', 'arrived', 'in_progress', 'done'], f.code);
  await api().post(`/api/v1/jobs/${jobId}/complete`).set(auth(client.token)).send({});
});
after(closeAll);

test('comptes de versement chiffrés AES-256-GCM, jamais renvoyés en clair', async () => {
  const accountNumber = 'CM21 10005 00001 23456789012';
  let r = await api().post('/api/v1/admin/payout-accounts').set(auth(admin.token)).send({
    type: 'bank', label: 'Ecobank principal', bank_name: 'Ecobank Cameroun', account_holder: 'Tasko SAS', account_number: accountNumber, is_default: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.account_number_masked, '•••• 9012');
  assert.ok(!JSON.stringify(r.body).includes('23456789012'));
  r = await api().post('/api/v1/admin/payout-accounts').set(auth(admin.token)).send({ type: 'mtn_momo', label: 'MoMo admin', phone: '677123456' });
  assert.equal(r.body.phone_masked, '•••• 3456');
  r = await api().get('/api/v1/admin/payout-accounts').set(auth(admin.token));
  assert.equal(r.body.items.length, 2);
  assert.ok(!JSON.stringify(r.body).includes('23456789012') && !JSON.stringify(r.body).includes('677123456'));
  const { rows } = await pool.query('SELECT account_number_enc, phone_enc FROM payout_accounts');
  for (const row of rows) {
    const enc = row.account_number_enc || row.phone_enc;
    assert.match(enc, /^v1:/);
    assert.ok(!enc.includes('23456789012') && !enc.includes('677123456'));
  }
  r = await api().get('/api/v1/admin/payout-accounts').set(auth(client.token));
  assert.equal(r.status, 403);
});

test('trésorerie : grand livre, retrait plafonné au disponible, mot de passe, audit', async () => {
  let r = await api().get('/api/v1/admin/treasury').set(auth(admin.token));
  assert.equal(r.status, 200);
  assert.equal(r.body.revenue_total, 250);
  assert.equal(r.body.breakdown.service_fees, 250);
  assert.equal(r.body.revenue_available, 250);
  assert.equal(r.body.escrow_held, 0);
  assert.equal(r.body.aggregator_balance, null);
  const accounts = (await api().get('/api/v1/admin/payout-accounts').set(auth(admin.token))).body.items;
  const bank = accounts.find((a) => a.type === 'bank');

  r = await api().post('/api/v1/admin/treasury/withdrawals').set(auth(admin.token)).send({ amount: 1000, payout_account_id: bank.id, password: PASSWORD });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'CONFLICT');
  r = await api().post('/api/v1/admin/treasury/withdrawals').set(auth(admin.token)).send({ amount: 200, payout_account_id: bank.id, password: 'mauvais-mdp' });
  assert.equal(r.status, 401);

  // deux retraits simultanés de 200 sur 250 disponibles : un seul passe (verrou)
  const [a, b] = await Promise.all([
    api().post('/api/v1/admin/treasury/withdrawals').set(auth(admin.token)).send({ amount: 200, payout_account_id: bank.id, password: PASSWORD }),
    api().post('/api/v1/admin/treasury/withdrawals').set(auth(admin2.token)).send({ amount: 200, payout_account_id: bank.id, password: PASSWORD }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const w = a.status === 201 ? a.body : b.body;
  assert.equal(w.status, 'pending');
  assert.equal(w.payout_account.account_number_masked, '•••• 9012');
  await waitFor(async () => (await pool.query(`SELECT status FROM admin_withdrawals WHERE id = $1`, [w.id])).rows[0].status === 'success');
  r = await api().get('/api/v1/admin/treasury').set(auth(admin.token));
  assert.equal(r.body.revenue_withdrawn, 200);
  assert.equal(r.body.revenue_available, 50);
  r = await api().get('/api/v1/admin/treasury/withdrawals').set(auth(admin.token));
  assert.equal(r.body.total, 1);
  assert.equal(r.body.items[0].status, 'success');
  r = await api().get('/api/v1/admin/audit-logs').set(auth(admin.token));
  const actions = r.body.items.map((x) => x.action);
  assert.ok(actions.includes('treasury.withdrawal'));
  assert.ok(actions.includes('treasury.withdrawal_denied'));
  assert.ok(actions.includes('payout_account.create'));
  r = await api().get('/api/v1/admin/treasury/ledger?days=7').set(auth(admin.token));
  assert.equal(r.body.items.length, 7);
  assert.equal(r.body.items.at(-1).revenue, 250);
});

test('portefeuille prestataire : versement échoué (MoMo …000) → disponible, retrait manuel plafonné', async () => {
  const p = await createProvider({ name: 'Prestataire MoMo KO' });
  await pool.query(`UPDATE provider_profiles SET momo_number = '+237690000000' WHERE user_id = $1`, [p.user.id]);
  const f = await fundedJob(client, p);
  await advance(p, f.id, ['en_route', 'arrived', 'in_progress', 'done'], f.code);
  await api().post(`/api/v1/jobs/${f.id}/complete`).set(auth(client.token)).send({});
  const { rows } = await pool.query(`SELECT id FROM transactions WHERE job_id = $1 AND type = 'payout'`, [f.id]);
  const payout = await waitTx(rows[0].id);
  assert.equal(payout.status, 'failed');
  let r = await api().get('/api/v1/me/wallet').set(auth(p.token));
  assert.equal(r.body.available, 5000);
  r = await api().get('/api/v1/admin/treasury').set(auth(admin.token));
  assert.equal(r.body.providers_available, 5000);
  r = await api().post('/api/v1/me/wallet/withdraw').set(auth(p.token)).send({ amount: 6000, method: 'mtn_momo', phone: p.phone });
  assert.equal(r.status, 409);
  r = await api().post('/api/v1/me/wallet/withdraw').set(auth(p.token)).send({ amount: 5000, method: 'mtn_momo', phone: '+237691111111' });
  assert.equal(r.status, 400); // numéro non enregistré
  r = await api().post('/api/v1/me/wallet/withdraw').set(auth(p.token)).send({ amount: 5000, method: 'mtn_momo', phone: p.phone });
  assert.equal(r.status, 201);
  await waitTx(r.body.transaction.id);
  r = await api().get('/api/v1/me/wallet').set(auth(p.token));
  assert.equal(r.body.available, 0);
  // rien à relancer
  const res = await runSchedulerOnce({ only: ['provider_payouts'] });
  assert.equal(res.results.provider_payouts, 0);
});

test('compte entreprise, biens immobiliers et mission récurrente créée par le planificateur', async () => {
  let r = await api().put('/api/v1/me/business').set(auth(client.token)).send({ name: 'Résidence Test SARL', kind: 'real_estate', niu: 'M0123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.account_type, 'business');
  assert.equal(r.body.business.kind, 'real_estate');
  r = await api().post('/api/v1/properties').set(auth(client.token)).send({ name: 'Immeuble A', kind: 'building', address: 'Bastos', lat: 3.87, lng: 11.51, units_count: 12 });
  assert.equal(r.status, 201);
  const propId = r.body.id;
  r = await api().post('/api/v1/recurring-jobs').set(auth(client.token)).send({
    property_id: propId, category_id: cats.plomberie, provider_id: provider.user.id, title: 'Contrôle hebdomadaire', price: 5000,
    frequency: 'weekly', next_run_at: new Date(Date.now() - 60e3).toISOString(),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const recId = r.body.id;
  const res = await runSchedulerOnce({ only: ['recurring'] });
  assert.equal(res.results.recurring, 1);
  r = await api().get(`/api/v1/properties/${propId}`).set(auth(client.token));
  assert.equal(r.body.jobs.length, 1);
  assert.equal(r.body.jobs[0].origin, 'recurring');
  assert.equal(r.body.jobs[0].mode, 'direct');
  assert.equal(r.body.jobs[0].provider.id, provider.user.id);
  assert.equal(r.body.recurring[0].id, recId);
  assert.ok(new Date(r.body.recurring[0].next_run_at) > new Date());
  // pas de double création au cycle suivant
  assert.equal((await runSchedulerOnce({ only: ['recurring'] })).results.recurring, 0);
  r = await api().put('/api/v1/me/business').set(auth(client.token)).send({ business: null });
  assert.equal(r.body.account_type, 'individual');
});

test('IDOR : un tiers ne lit ni ne modifie les ressources des autres', async () => {
  const t = auth(stranger.token);
  let r = await api().get(`/api/v1/jobs/${jobId}`).set(t);
  assert.equal(r.status, 404);
  r = await api().get(`/api/v1/jobs/${jobId}/receipt`).set(t);
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/jobs/${jobId}/review`).set(t).send({ rating: 1 });
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/jobs/${jobId}/cancel`).set(t).send({});
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/jobs/${jobId}/pay`).set(t).send({ method: 'mtn_momo', phone: stranger.phone });
  assert.equal(r.status, 404);
  const { rows } = await pool.query(`SELECT id FROM transactions WHERE job_id = $1 AND type = 'escrow_in'`, [jobId]);
  r = await api().get(`/api/v1/transactions/${rows[0].id}`).set(t);
  assert.equal(r.status, 404);
  r = await api().get(`/api/v1/transactions/${rows[0].id}`).set(auth(provider.token)); // le prestataire ne voit pas l'encaissement du client
  assert.equal(r.status, 404);

  const conv = await api().post('/api/v1/conversations').set(auth(client.token)).send({ user_id: provider.user.id, job_id: jobId });
  r = await api().get(`/api/v1/conversations/${conv.body.id}/messages`).set(t);
  assert.equal(r.status, 404);
  r = await api().post(`/api/v1/conversations/${conv.body.id}/messages`).set(t).send({ type: 'text', body: 'intrusion' });
  assert.equal(r.status, 404);
  // rattacher la mission d'autrui à sa propre conversation
  r = await api().post('/api/v1/conversations').set(t).send({ user_id: provider.user.id, job_id: jobId });
  assert.equal(r.status, 400);

  const props = await api().get('/api/v1/properties').set(auth(client.token));
  const propId = props.body.items[0].id;
  r = await api().get(`/api/v1/properties/${propId}`).set(t);
  assert.equal(r.status, 404);
  r = await api().patch(`/api/v1/properties/${propId}`).set(t).send({ name: 'Volé' });
  assert.equal(r.status, 404);
  r = await api().delete(`/api/v1/properties/${propId}`).set(t);
  assert.equal(r.status, 404);
  r = await api().get('/api/v1/recurring-jobs').set(t);
  assert.deepEqual(r.body.items, []);
  r = await api().post('/api/v1/jobs').set(t).send({
    category_id: cats.plomberie, description: 'test', lat: 3.85, lng: 11.5, budget: 5000, property_id: propId,
  });
  assert.equal(r.status, 400);
  r = await api().get('/api/v1/admin/treasury').set(t);
  assert.equal(r.status, 403);
});

test('sécurité : upload limité aux images/PDF (contenu vérifié), verrouillage après échecs de connexion', async () => {
  let r = await api().post('/api/v1/uploads').set(auth(client.token)).attach('file', Buffer.from('<svg onload=alert(1)>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
  assert.equal(r.status, 400);
  r = await api().post('/api/v1/uploads').set(auth(client.token)).attach('file', Buffer.from('MZ fake exe'), { filename: 'x.png', contentType: 'image/png' });
  assert.equal(r.status, 400);
  r = await api().post('/api/v1/uploads').set(auth(client.token)).attach('file', Buffer.from('%PDF-1.4\n%devis'), { filename: 'devis.pdf', contentType: 'application/pdf' });
  assert.equal(r.status, 201);
  assert.match(r.body.url, /^\/uploads\/[0-9a-f-]+\.pdf$/);

  const victim = await registerUser('Victime Brute Force');
  for (let i = 0; i < 5; i++) {
    r = await api().post('/api/v1/auth/login').send({ phone: victim.phone, password: `faux${i}xxxx` });
    assert.equal(r.status, 401);
  }
  r = await api().post('/api/v1/auth/login').send({ phone: victim.phone, password: PASSWORD });
  assert.equal(r.status, 429); // verrouillé même avec le bon mot de passe
  await pool.query(`UPDATE login_attempts SET locked_until = now() - interval '1 second' WHERE phone = $1`, [victim.phone]);
  r = await api().post('/api/v1/auth/login').send({ phone: victim.phone, password: PASSWORD });
  assert.equal(r.status, 200);

  // OTP : 3 demandes max par numéro / 10 min
  for (let i = 0; i < 3; i++) assert.equal((await api().post('/api/v1/auth/otp/request').send({ phone: '690998877' })).status, 200);
  assert.equal((await api().post('/api/v1/auth/otp/request').send({ phone: '690998877' })).status, 429);

  r = await api().get('/api/v1/me').set(auth(client.token));
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
