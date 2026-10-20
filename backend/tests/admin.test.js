import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { YDE, api, auth, cats, closeAll, makeAdmin, registerUser, resetDb } from './helpers.js';

let admin;
let user;

before(async () => {
  await resetDb();
  admin = await registerUser('Admin Tasko');
  await makeAdmin(admin.user.id);
  user = await registerUser('Client simple');
});
after(closeAll);

test('accès admin refusé aux non-administrateurs', async () => {
  let r = await api().get('/api/v1/admin/stats').set(auth(user.token));
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'FORBIDDEN');
  r = await api().post('/api/v1/admin/categories').set(auth(user.token)).send({ name: 'Piratage', icon: 'build' });
  assert.equal(r.status, 403);
  r = await api().get('/api/v1/admin/stats');
  assert.equal(r.status, 401);
});

test('CRUD catégories + sous-services + réordonnancement', async () => {
  let r = await api().post('/api/v1/admin/categories').set(auth(admin.token)).send({ name: 'Animaux', icon: 'pets', color: '#795548', description: 'Soins des animaux' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const parent = r.body;
  assert.equal(parent.slug, 'animaux');
  assert.equal(parent.parent_id, null);
  assert.deepEqual(parent.children, []);

  r = await api().post('/api/v1/admin/categories').set(auth(admin.token)).send({ name: 'Promenade de chiens', icon: 'pets', parent_id: parent.id });
  assert.equal(r.status, 201);
  const child = r.body;
  assert.equal(child.parent_id, parent.id);

  // icône non autorisée
  r = await api().post('/api/v1/admin/categories').set(auth(admin.token)).send({ name: 'Test', icon: 'rocket' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');

  r = await api().patch(`/api/v1/admin/categories/${parent.id}`).set(auth(admin.token)).send({ name: 'Animaux de compagnie', is_active: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Animaux de compagnie');
  assert.equal(r.body.is_active, false);
  assert.equal(r.body.children.length, 1);

  // inactives : absentes du catalogue public, présentes côté admin
  r = await api().get('/api/v1/categories');
  assert.ok(!r.body.items.some((c) => c.id === parent.id));
  r = await api().get('/api/v1/admin/categories').set(auth(admin.token));
  assert.ok(r.body.items.some((c) => c.id === parent.id));
  r = await api().get('/api/v1/categories?all=true').set(auth(admin.token));
  assert.ok(r.body.items.some((c) => c.id === parent.id));

  // réordonner : la catégorie passe en tête, « Autre service » reste dernière
  r = await api().post('/api/v1/admin/categories/reorder').set(auth(admin.token)).send({ ids: [parent.id, cats.beaute, cats.batiment] });
  assert.deepEqual(r.body, { ok: true });
  r = await api().get('/api/v1/admin/categories').set(auth(admin.token));
  assert.equal(r.body.items[0].id, parent.id);
  assert.equal(r.body.items.at(-1).slug, 'autre');

  r = await api().delete(`/api/v1/admin/categories/${parent.id}`).set(auth(admin.token));
  assert.equal(r.status, 200);
  r = await api().get(`/api/v1/categories/${child.id}`);
  assert.equal(r.status, 404);
});

test('suppression refusée si des missions sont liées (CONFLICT)', async () => {
  const r1 = await api().post('/api/v1/jobs').set(auth(user.token)).send({
    category_id: cats.coiffure, description: 'Coupe', lat: YDE.lat, lng: YDE.lng, urgency: 'now', budget: 3000,
  });
  assert.equal(r1.status, 201);
  const r = await api().delete(`/api/v1/admin/categories/${cats.beaute}`).set(auth(admin.token));
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'CONFLICT');
});

test('« Autre service » alimente les suggestions', async () => {
  let r = await api().post('/api/v1/jobs').set(auth(user.token)).send({
    category_id: cats.autre, other_label: 'Réparation de groupe électrogène', description: 'Groupe en panne',
    lat: YDE.lat, lng: YDE.lng, urgency: 'today', budget: 10000,
  });
  assert.equal(r.status, 201);
  r = await api().get('/api/v1/admin/category-suggestions').set(auth(admin.token));
  assert.equal(r.body.items[0].label, 'Réparation de groupe électrogène');
  assert.equal(r.body.items[0].count, 1);
});

test('statistiques, paramètres et utilisateurs', async () => {
  let r = await api().get('/api/v1/admin/stats').set(auth(admin.token));
  assert.equal(r.status, 200);
  for (const k of ['users_total', 'users_growth_pct', 'providers_total', 'jobs_today', 'gmv_today', 'revenue_today', 'gmv_month',
    'revenue_month', 'active_providers', 'cancellation_rate', 'avg_basket', 'disputes_open']) {
    assert.equal(typeof r.body[k], 'number', k);
  }
  r = await api().get('/api/v1/admin/stats/timeseries?days=7').set(auth(admin.token));
  assert.equal(r.body.items.length, 7);
  assert.ok(r.body.items.at(-1).jobs >= 2);

  r = await api().put('/api/v1/admin/settings').set(auth(admin.token)).send({ client_fee_rate: 0.07 });
  assert.equal(r.body.client_fee_rate, 0.07);
  r = await api().get('/api/v1/jobs/quote?price=10000');
  assert.equal(r.body.service_fee, 700);
  r = await api().put('/api/v1/admin/settings').set(auth(admin.token)).send({ unknown_key: 1 });
  assert.equal(r.status, 400);
  await api().put('/api/v1/admin/settings').set(auth(admin.token)).send({ client_fee_rate: 0.05 });

  r = await api().patch(`/api/v1/admin/users/${user.user.id}`).set(auth(admin.token)).send({ status: 'suspended' });
  assert.equal(r.body.status, 'suspended');
  r = await api().get('/api/v1/me').set(auth(user.token));
  assert.equal(r.status, 403);
  await api().patch(`/api/v1/admin/users/${user.user.id}`).set(auth(admin.token)).send({ status: 'active' });

  r = await api().get('/api/v1/admin/users?role=admin').set(auth(admin.token));
  assert.equal(r.body.total, 1);
});
