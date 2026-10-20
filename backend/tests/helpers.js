// Utilitaires de test : base dédiée `tasko_test` (créée/migrée automatiquement), purgée avant chaque fichier.
import 'dotenv/config';
import pg from 'pg';

process.env.NODE_ENV = 'test';
process.env.MOCK_PAYMENT_DELAY_MS = process.env.MOCK_PAYMENT_DELAY_MS_TEST || '150';
process.env.MOCK_PAYOUT_DELAY_MS = process.env.MOCK_PAYOUT_DELAY_MS_TEST || '150';
process.env.SCHEDULER_ENABLED = 'false';
const baseUrl = process.env.DATABASE_URL || 'postgres://tasko:tasko_dev_password@localhost:5433/tasko';
const testUrl = process.env.TEST_DATABASE_URL || baseUrl.replace(/\/[^/?]+(\?.*)?$/, '/tasko_test$1');
if (!/test/i.test(new URL(testUrl).pathname)) {
  throw new Error(`Sécurité : la base de test doit contenir « test » dans son nom (reçu ${new URL(testUrl).pathname})`);
}
process.env.DATABASE_URL = testUrl;

async function ensureDatabase() {
  const url = new URL(testUrl);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
  await admin.end();
}

await ensureDatabase();

const { default: supertest } = await import('supertest');
const { pool } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { runMigrations } = await import('../db/migrate.js');
const { ensureDefaultSettings } = await import('../src/modules/settings/service.js');

export { pool };
export const app = createApp();
export const api = () => supertest(app);

export const YDE = { lat: 3.848, lng: 11.5021 };
export const cats = {};

/** Réinitialise la base de test avec un catalogue minimal. */
export async function resetDb() {
  await runMigrations(pool, { log: () => {} });
  const { rows } = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`);
  await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await ensureDefaultSettings(pool);
  await pool.query(`INSERT INTO cities (name, lat, lng) VALUES ('Yaoundé', 3.848, 11.5021), ('Douala', 4.0511, 9.7679)`);
  const ins = async (name, slug, icon, parent = null, position = 0) =>
    (await pool.query(
      'INSERT INTO categories (name, slug, icon, parent_id, position) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, slug, icon, parent, position],
    )).rows[0].id;
  cats.batiment = await ins('Bâtiment & Chantier', 'batiment-chantier', 'construction', null, 0);
  cats.plomberie = await ins('Plomberie', 'plomberie', 'plumbing', cats.batiment, 0);
  cats.electricite = await ins('Électricité', 'electricite', 'electrical_services', cats.batiment, 1);
  cats.beaute = await ins('Beauté & Bien-être', 'beaute-bien-etre', 'spa', null, 1);
  cats.coiffure = await ins('Coiffure', 'coiffure', 'content_cut', cats.beaute, 0);
  cats.autre = await ins('Autre service', 'autre', 'more_horiz', null, 99);
}

let phoneSeq = 0;
export function nextPhone(prefix = '69') {
  phoneSeq += 1;
  return `+237${prefix}${String(Date.now() % 10000).padStart(4, '0')}${String(phoneSeq).padStart(3, '0')}`.slice(0, 13);
}

export async function registerUser(full_name = 'Utilisateur Test', phone = nextPhone()) {
  const res = await api().post('/api/v1/auth/register').send({ full_name, phone, password: 'secret123', otp_code: '123456', city: 'Yaoundé' });
  if (res.status !== 201) throw new Error(`register ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, user: res.body.user, phone };
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Crée un prestataire en ligne avec compétences et position. */
export async function createProvider({ name = 'Prestataire Test', skills, lat = YDE.lat, lng = YDE.lng, online = true, rating, missions, featured, pro } = {}) {
  const u = await registerUser(name);
  let r = await api().put('/api/v1/me/provider').set(auth(u.token)).send({
    headline: 'Plombier', bio: 'Bio', provider_type: 'artisan', years_experience: 3,
    momo_number: u.phone, momo_operator: 'mtn', available_days: [1, 2, 3, 4, 5, 6],
  });
  if (r.status !== 200) throw new Error(`provider ${r.status} ${JSON.stringify(r.body)}`);
  r = await api().put('/api/v1/me/skills').set(auth(u.token)).send({ skills: skills || [{ category_id: cats.plomberie, base_price: 5000 }] });
  if (r.status !== 200) throw new Error(`skills ${r.status} ${JSON.stringify(r.body)}`);
  await api().post('/api/v1/me/location').set(auth(u.token)).send({ lat, lng });
  await api().patch('/api/v1/me/provider/status').set(auth(u.token)).send({ is_online: online });
  if (rating !== undefined || missions !== undefined || featured || pro) {
    await pool.query(
      `UPDATE provider_profiles SET rating_avg = coalesce($2, rating_avg), missions_completed = coalesce($3, missions_completed),
         featured_until = CASE WHEN $4 THEN now() + interval '1 day' ELSE featured_until END,
         plan = CASE WHEN $5 THEN 'pro' ELSE plan END
       WHERE user_id = $1`,
      [u.user.id, rating ?? null, missions ?? null, !!featured, !!pro],
    );
  }
  return u;
}

export async function makeAdmin(userId) {
  await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [userId]);
}

export async function waitFor(fn, { timeout = 5000, interval = 50 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('waitFor : délai dépassé');
    await new Promise((r) => setTimeout(r, interval));
  }
}

export const PASSWORD = 'secret123';

/** Attend qu'une transaction ne soit plus `pending` (lecture directe en base). */
export async function waitTx(id, { timeout = 5000 } = {}) {
  return waitFor(async () => {
    const { rows } = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
    return rows[0] && rows[0].status !== 'pending' ? rows[0] : null;
  }, { timeout });
}

export const jobBody = (extra = {}) => ({
  category_id: cats.plomberie,
  description: "Fuite sous l'évier",
  address: 'Bastos, Yaoundé',
  lat: YDE.lat + 0.01,
  lng: YDE.lng,
  urgency: 'now',
  budget: 5000,
  ...extra,
});

/** Mission directe acceptée puis payée (séquestre) : retourne { id, code, job } (vue client). */
export async function fundedJob(client, provider, extra = {}) {
  let r = await api().post('/api/v1/jobs').set(auth(client.token)).send(jobBody({ provider_id: provider.user.id, ...extra }));
  if (r.status !== 201) throw new Error(`create ${r.status} ${JSON.stringify(r.body)}`);
  const id = r.body.id;
  r = await api().post(`/api/v1/jobs/${id}/accept`).set(auth(provider.token)).send({});
  if (r.status !== 200) throw new Error(`accept ${r.status} ${JSON.stringify(r.body)}`);
  r = await api().post(`/api/v1/jobs/${id}/pay`).set(auth(client.token)).send({ method: 'mtn_momo', phone: client.phone });
  if (r.status !== 200) throw new Error(`pay ${r.status} ${JSON.stringify(r.body)}`);
  const tx = await waitTx(r.body.transaction.id);
  if (tx.status !== 'success') throw new Error('paiement échoué');
  r = await api().get(`/api/v1/jobs/${id}`).set(auth(client.token));
  return { id, code: r.body.start_code, job: r.body };
}

/** Fait avancer une mission financée par le prestataire (statuts terrain), code de démarrage inclus. */
export async function advance(provider, id, statuses, code, extra = {}) {
  let r;
  for (const status of statuses) {
    r = await api().post(`/api/v1/jobs/${id}/status`).set(auth(provider.token))
      .send({ status, ...(status === 'in_progress' ? { start_code: code } : {}), ...(status === 'done' ? extra : {}) });
    if (r.status !== 200) throw new Error(`${status} ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

export async function closeAll() {
  await pool.end();
}
