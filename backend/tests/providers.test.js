import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { YDE, api, auth, cats, closeAll, createProvider, registerUser, resetDb } from './helpers.js';
import { matchingScore } from '../src/modules/providers/service.js';

const km = (d) => d / 111.32; // degrés de latitude
let near;
let top;
let far;
let hair;
let offline;

before(async () => {
  await resetDb();
  // proche mais peu noté
  near = await createProvider({ name: 'Proche Débutant', lat: YDE.lat + km(0.5), lng: YDE.lng, rating: 3, missions: 0 });
  // un peu plus loin, excellent, mis en avant et pro → meilleur score
  top = await createProvider({ name: 'Top Plombier', lat: YDE.lat + km(2), lng: YDE.lng, rating: 4.9, missions: 60, featured: true, pro: true });
  // loin
  far = await createProvider({ name: 'Lointain', lat: YDE.lat + km(8), lng: YDE.lng, rating: 4, missions: 10, skills: [{ category_id: cats.electricite, base_price: 3000 }] });
  // hors rayon (15 km)
  await createProvider({ name: 'Hors Rayon', lat: YDE.lat + km(15), lng: YDE.lng, rating: 5, missions: 50 });
  // autre compétence
  hair = await createProvider({ name: 'Coiffeuse', lat: YDE.lat, lng: YDE.lng + km(1), rating: 4.5, skills: [{ category_id: cats.coiffure, base_price: 2000 }] });
  offline = await createProvider({ name: 'Hors Ligne', lat: YDE.lat, lng: YDE.lng + km(1), online: false, rating: 4 });
});
after(closeAll);

test('score de matching conforme à la formule du contrat', () => {
  const s = matchingScore({ distance_km: 2, radius_km: 10, rating_avg: 5, missions_completed: 25, is_online: true, is_featured: false, is_pro: true });
  assert.equal(Math.round(s * 1000) / 1000, Math.round((0.35 * 0.8 + 0.25 + 0.15 * 0.5 + 0.1 + 0.05) * 1000) / 1000);
});

test('recherche triée par score (défaut), rayon respecté, champs ProviderCard', async () => {
  const r = await api().get(`/api/v1/providers?lat=${YDE.lat}&lng=${YDE.lng}`);
  assert.equal(r.status, 200);
  const names = r.body.items.map((p) => p.full_name);
  assert.ok(!names.includes('Hors Rayon'));
  assert.equal(names[0], 'Top Plombier');
  for (let i = 1; i < r.body.items.length; i++) assert.ok(r.body.items[i - 1].score >= r.body.items[i].score);
  const card = r.body.items[0];
  for (const k of ['id', 'full_name', 'avatar_url', 'headline', 'provider_type', 'rating_avg', 'rating_count', 'missions_completed', 'distance_km',
    'eta_min', 'min_price', 'is_online', 'is_featured', 'is_pro', 'verification_level', 'lat', 'lng', 'skills', 'score']) {
    assert.ok(k in card, k);
  }
  assert.equal(card.is_featured, true);
  assert.equal(card.is_pro, true);
  assert.equal(card.distance_km, 2);
  assert.equal(card.eta_min, Math.ceil((2 / 20) * 60) + 2);
  assert.deepEqual(card.skills, ['Plomberie']);
});

test('filtres : catégorie parente, sous-service, en ligne, tri distance/prix', async () => {
  let r = await api().get(`/api/v1/providers?lat=${YDE.lat}&lng=${YDE.lng}&category_id=${cats.batiment}`);
  let ids = r.body.items.map((p) => p.id);
  assert.ok(ids.includes(far.user.id)); // électricité ∈ bâtiment
  assert.ok(!ids.includes(hair.user.id));

  r = await api().get(`/api/v1/providers?lat=${YDE.lat}&lng=${YDE.lng}&category_id=${cats.coiffure}`);
  assert.deepEqual(r.body.items.map((p) => p.id), [hair.user.id]);
  assert.equal(r.body.items[0].min_price, 2000);

  r = await api().get(`/api/v1/providers?lat=${YDE.lat}&lng=${YDE.lng}&online=true`);
  assert.ok(!r.body.items.some((p) => p.id === offline.user.id));

  r = await api().get(`/api/v1/providers?lat=${YDE.lat}&lng=${YDE.lng}&sort=distance`);
  const d = r.body.items.map((p) => p.distance_km);
  assert.deepEqual(d, [...d].sort((a, b) => a - b));

  r = await api().get(`/api/v1/providers?lat=${YDE.lat}&lng=${YDE.lng}&sort=price&category_id=${cats.batiment}`);
  assert.equal(r.body.items[0].id, far.user.id);

  r = await api().get(`/api/v1/providers?lat=${YDE.lat}&lng=${YDE.lng}&q=top`);
  assert.deepEqual(r.body.items.map((p) => p.id), [top.user.id]);
});

test('fiche prestataire et favoris', async () => {
  const client = await registerUser('Client Fan');
  let r = await api().get(`/api/v1/providers/${near.user.id}?lat=${YDE.lat}&lng=${YDE.lng}`).set(auth(client.token));
  assert.equal(r.status, 200);
  assert.equal(r.body.is_followed, false);
  assert.ok(Array.isArray(r.body.reviews));
  assert.equal(r.body.skills[0].name, 'Plomberie');
  r = await api().post(`/api/v1/providers/${near.user.id}/follow`).set(auth(client.token));
  assert.deepEqual(r.body, { is_followed: true });
  r = await api().get('/api/v1/me/favorites').set(auth(client.token));
  assert.deepEqual(r.body.items.map((p) => p.id), [near.user.id]);
  r = await api().post(`/api/v1/providers/${near.user.id}/follow`).set(auth(client.token));
  assert.deepEqual(r.body, { is_followed: false });
});
