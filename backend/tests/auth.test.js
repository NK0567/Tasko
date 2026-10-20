import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, auth, closeAll, resetDb } from './helpers.js';

before(resetDb);
after(closeAll);

test('OTP en mode dev : code 123456 renvoyé', async () => {
  const res = await api().post('/api/v1/auth/otp/request').send({ phone: '690112233' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sent: true, dev_code: '123456' });
});

test('inscription puis connexion (numéro normalisé)', async () => {
  const reg = await api()
    .post('/api/v1/auth/register')
    .send({ full_name: 'Moussa Kamga', phone: '690 11 22 33', password: 'motdepasse', otp_code: '123456', city: 'Yaoundé' });
  assert.equal(reg.status, 201);
  assert.ok(reg.body.token);
  assert.equal(reg.body.user.phone, '+237690112233');
  assert.equal(reg.body.user.verification_level, 2);
  assert.equal(reg.body.user.is_provider, false);
  assert.equal(reg.body.user.provider, null);

  const dup = await api().post('/api/v1/auth/register').send({ full_name: 'Autre', phone: '+237690112233', password: 'motdepasse' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'CONFLICT');

  const bad = await api().post('/api/v1/auth/login').send({ phone: '690112233', password: 'mauvais' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'UNAUTHORIZED');

  const ok = await api().post('/api/v1/auth/login').send({ phone: '237690112233', password: 'motdepasse' });
  assert.equal(ok.status, 200);
  const me = await api().get('/api/v1/me').set(auth(ok.body.token));
  assert.equal(me.status, 200);
  assert.equal(me.body.full_name, 'Moussa Kamga');
});

test('validation en français et format d\'erreur du contrat', async () => {
  const res = await api().post('/api/v1/auth/register').send({ full_name: 'A', phone: '12345', password: '1' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.match(res.body.error.details.phone, /Numéro invalide/);
  assert.match(res.body.error.details.password, /au moins 8 caractères/);
});

test('route protégée sans jeton → 401', async () => {
  const res = await api().get('/api/v1/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});
