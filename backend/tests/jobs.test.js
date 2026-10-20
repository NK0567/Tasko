import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { YDE, api, auth, cats, closeAll, createProvider, pool, registerUser, resetDb, waitFor } from './helpers.js';

before(resetDb);
after(closeAll);

const jobBody = (extra = {}) => ({
  category_id: cats.plomberie,
  description: "Fuite sous l'évier",
  address: 'Bastos, Yaoundé',
  lat: YDE.lat + 0.01,
  lng: YDE.lng,
  urgency: 'now',
  budget: 5000,
  ...extra,
});

async function waitPayment(token, txId) {
  return waitFor(async () => {
    const r = await api().get(`/api/v1/transactions/${txId}`).set(auth(token));
    return r.body.status !== 'pending' ? r.body : null;
  });
}

test('devis : frais de service et frais minimum', async () => {
  let r = await api().get('/api/v1/jobs/quote?price=5000');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { price: 5000, service_fee: 250, total: 5250, provider_commission: 0, provider_payout: 5000 });
  r = await api().get('/api/v1/jobs/quote?price=1000');
  assert.equal(r.body.service_fee, 100); // max(100, 50)
  assert.equal(r.body.total, 1100);
  r = await api().get('/api/v1/jobs/quote?price=abc');
  assert.equal(r.status, 400);
});

test('flux complet : requested → accepted → pay(mock) → funded → … → completed', async () => {
  const provider = await createProvider({ name: 'Bika Services' });
  const client = await registerUser('Marie Ngo');

  // création (diffusion) + visibilité côté prestataire
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const jobId = r.body.id;
  assert.equal(r.body.status, 'requested');
  assert.equal(r.body.payment_status, 'unpaid');
  assert.equal(r.body.provider, null);
  assert.equal(r.body.total, 5250);
  assert.equal(r.body.city, 'Yaoundé');

  r = await api().get(`/api/v1/jobs/nearby?lat=${YDE.lat}&lng=${YDE.lng}`).set(auth(provider.token));
  assert.equal(r.status, 200);
  assert.ok(r.body.items.some((j) => j.id === jobId));

  // notification « nouvelle mission » reçue par le prestataire
  r = await api().get('/api/v1/notifications?type=job').set(auth(provider.token));
  assert.ok(r.body.items.some((n) => n.data.job_id === jobId));

  // acceptation
  r = await api().post(`/api/v1/jobs/${jobId}/accept`).set(auth(provider.token)).send({});
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'accepted');
  assert.equal(r.body.provider.id, provider.user.id);

  // paiement mock
  r = await api().post(`/api/v1/jobs/${jobId}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(['pending', 'success'].includes(r.body.transaction.status)); // mock : passe en success après le délai
  assert.equal(r.body.transaction.type, 'escrow_in');
  assert.equal(r.body.transaction.amount, 5250);
  assert.equal(r.body.checkout_url, null);
  const tx = await waitPayment(client.token, r.body.transaction.id);
  assert.equal(tx.status, 'success');

  r = await api().get(`/api/v1/jobs/${jobId}`).set(auth(client.token));
  assert.equal(r.body.status, 'funded');
  assert.equal(r.body.payment_status, 'held');

  // statuts terrain (prestataire)
  r = await api().get(`/api/v1/jobs/${jobId}`).set(auth(client.token));
  const startCode = r.body.start_code; // V2 : code de démarrage visible du seul client
  assert.match(startCode, /^\d{4}$/);
  for (const status of ['en_route', 'arrived', 'in_progress', 'done']) {
    r = await api().post(`/api/v1/jobs/${jobId}/status`).set(auth(provider.token))
      .send({ status, ...(status === 'in_progress' ? { start_code: startCode } : {}) });
    assert.equal(r.status, 200, `${status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.status, status);
  }
  assert.ok(r.body.started_at);

  // confirmation client + note
  r = await api().post(`/api/v1/jobs/${jobId}/complete`).set(auth(client.token)).send({ rating: 5, comment: 'Excellent travail' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'completed');
  assert.equal(r.body.payment_status, 'released');
  assert.deepEqual(r.body.review, { rating: 5, comment: 'Excellent travail' });

  // V2 : le versement mock est asynchrone (~délai simulé)
  await waitFor(async () => (await pool.query(`SELECT 1 FROM transactions WHERE job_id = $1 AND type = 'payout' AND status = 'success'`, [jobId])).rowCount);
  const { rows: txs } = await pool.query('SELECT type, amount, status, user_id FROM transactions WHERE job_id = $1 ORDER BY type', [jobId]);
  const byType = Object.fromEntries(txs.map((t) => [t.type, t]));
  assert.equal(byType.escrow_in.amount, 5250);
  assert.equal(byType.payout.amount, 5000);
  assert.equal(byType.payout.status, 'success');
  assert.equal(byType.payout.user_id, provider.user.id);
  assert.equal(byType.commission.amount, 250); // service_fee + provider_commission
  assert.equal(byType.commission.status, 'success');

  // stats prestataire
  r = await api().get('/api/v1/me').set(auth(provider.token));
  assert.equal(r.body.provider.rating_avg, 5);
  assert.equal(r.body.provider.rating_count, 1);
  assert.equal(r.body.provider.missions_completed, 1);
  assert.equal(r.body.provider.completion_rate, 100);

  r = await api().get('/api/v1/me/earnings').set(auth(provider.token));
  assert.equal(r.body.total_earned, 5000);
  assert.equal(r.body.jobs_completed, 1);

  // idempotence : une seconde confirmation est refusée sans double versement
  r = await api().post(`/api/v1/jobs/${jobId}/complete`).set(auth(client.token)).send({});
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INVALID_STATE');
  const { rows: payouts } = await pool.query(`SELECT count(*)::int AS n FROM transactions WHERE job_id = $1 AND type = 'payout'`, [jobId]);
  assert.equal(payouts[0].n, 1);
});

test('commission prestataire lue depuis les paramètres', async () => {
  await pool.query(`UPDATE settings SET value = '0.1'::jsonb WHERE key = 'provider_commission_rate'`);
  try {
    const provider = await createProvider({ name: 'Électricien Test', skills: [{ category_id: cats.electricite, base_price: 8000 }] });
    const client = await registerUser('Client Commission');
    let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ category_id: cats.electricite, budget: 10000, provider_id: provider.user.id }));
    const jobId = r.body.id;
    r = await api().post(`/api/v1/jobs/${jobId}/accept`).set(auth(provider.token)).send({});
    assert.equal(r.body.service_fee, 500);
    assert.equal(r.body.provider_commission, 1000);
    assert.equal(r.body.provider_payout, 9000);
    assert.equal(r.body.total, 10500);
    r = await api().post(`/api/v1/jobs/${jobId}/pay`).set(auth(client.token)).send({ method: 'orange_money', phone: client.phone });
    await waitPayment(client.token, r.body.transaction.id);
    r = await api().post(`/api/v1/jobs/${jobId}/complete`).set(auth(client.token)).send({});
    assert.equal(r.status, 200);
    const { rows } = await pool.query(`SELECT type, amount FROM transactions WHERE job_id = $1 AND type IN ('payout', 'commission')`, [jobId]);
    const m = Object.fromEntries(rows.map((t) => [t.type, t.amount]));
    assert.equal(m.payout, 9000);
    assert.equal(m.commission, 1500); // revenu Tasko = 500 + 1000
  } finally {
    await pool.query(`UPDATE settings SET value = '0'::jsonb WHERE key = 'provider_commission_rate'`);
  }
});

test('transitions interdites → 409 INVALID_STATE et droits', async () => {
  const provider = await createProvider({ name: 'Plombier 2' });
  const client = await registerUser('Client 2');
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody());
  const jobId = r.body.id;

  // payer une mission non acceptée
  r = await api().post(`/api/v1/jobs/${jobId}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INVALID_STATE');

  r = await api().post(`/api/v1/jobs/${jobId}/accept`).set(auth(provider.token)).send({ price: 6000 });
  assert.equal(r.body.price, 6000);
  assert.equal(r.body.total, 6300);

  // statut terrain avant paiement
  r = await api().post(`/api/v1/jobs/${jobId}/status`).set(auth(provider.token)).send({ status: 'en_route' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INVALID_STATE');

  // seconde acceptation
  r = await api().post(`/api/v1/jobs/${jobId}/accept`).set(auth(provider.token)).send({});
  assert.equal(r.status, 409);

  r = await api().post(`/api/v1/jobs/${jobId}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  await waitPayment(client.token, r.body.transaction.id);

  // saut d'étape funded → done
  r = await api().post(`/api/v1/jobs/${jobId}/status`).set(auth(provider.token)).send({ status: 'done' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'INVALID_STATE');

  // le client ne peut pas changer un statut terrain ; le prestataire ne peut pas confirmer
  r = await api().post(`/api/v1/jobs/${jobId}/status`).set(auth(client.token)).send({ status: 'en_route' });
  assert.equal(r.status, 403);
  r = await api().post(`/api/v1/jobs/${jobId}/complete`).set(auth(provider.token)).send({});
  assert.equal(r.status, 403);

  // annulation client après paiement → remboursement
  r = await api().post(`/api/v1/jobs/${jobId}/cancel`).set(auth(client.token)).send({ reason: 'Imprévu' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'cancelled');
  assert.equal(r.body.payment_status, 'refunded');
  const { rows } = await pool.query(`SELECT amount, status FROM transactions WHERE job_id = $1 AND type = 'refund'`, [jobId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 6300);

  // plus aucune transition depuis cancelled
  r = await api().post(`/api/v1/jobs/${jobId}/dispute`).set(auth(client.token)).send({ reason: 'Problème grave' });
  assert.equal(r.status, 409);
});

test('paiement mock échoué (numéro finissant par 000)', async () => {
  const provider = await createProvider({ name: 'Plombier 3' });
  const client = await registerUser('Client 3');
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ provider_id: provider.user.id }));
  const jobId = r.body.id;
  await api().post(`/api/v1/jobs/${jobId}/accept`).set(auth(provider.token)).send({});
  r = await api().post(`/api/v1/jobs/${jobId}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: '+237690000000' });
  const tx = await waitPayment(client.token, r.body.transaction.id);
  assert.equal(tx.status, 'failed');
  r = await api().get(`/api/v1/jobs/${jobId}`).set(auth(client.token));
  assert.equal(r.body.status, 'accepted');
  assert.equal(r.body.payment_status, 'unpaid');
});

test('litige puis résolution admin (remboursement)', async () => {
  const provider = await createProvider({ name: 'Plombier 4' });
  const client = await registerUser('Client 4');
  const admin = await registerUser('Admin');
  await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [admin.user.id]);
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ provider_id: provider.user.id }));
  const jobId = r.body.id;
  await api().post(`/api/v1/jobs/${jobId}/accept`).set(auth(provider.token)).send({});
  r = await api().post(`/api/v1/jobs/${jobId}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  await waitPayment(client.token, r.body.transaction.id);
  r = await api().post(`/api/v1/jobs/${jobId}/dispute`).set(auth(client.token)).send({ reason: 'Le prestataire ne vient pas' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'disputed');
  r = await api().get('/api/v1/admin/disputes?status=open').set(auth(admin.token));
  const dispute = r.body.items.find((d) => d.job.id === jobId);
  assert.ok(dispute);
  r = await api().post(`/api/v1/admin/disputes/${dispute.id}/resolve`).set(auth(admin.token)).send({ resolution: 'refund', note: 'Absent' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'resolved');
  assert.equal(r.body.job.status, 'cancelled');
  assert.equal(r.body.job.payment_status, 'refunded');
});
