// Fallback de développement quand Docker n'est pas disponible :
// démarre un PostgreSQL local (binaire embarqué) sur le port 5433 avec les
// mêmes identifiants que docker-compose. Données dans backend/.pgdata (ignoré par git).
// Laisser ce processus tourner (Ctrl+C pour arrêter proprement).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.pgdata');
const user = process.env.POSTGRES_USER || 'tasko';
const password = process.env.POSTGRES_PASSWORD || 'tasko_dev_password';
const port = Number(process.env.POSTGRES_PORT || 5433);
const databases = [process.env.POSTGRES_DB || 'tasko', 'tasko_test'];

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  // UTF-8 obligatoire (sinon Windows initialise le cluster en WIN1252 : accents spéciaux / emojis refusés)
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-messages=C'],
  onLog: () => {},
  onError: (e) => console.error('[postgres]', String(e).trim()),
});

if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
  console.log('Initialisation du cluster PostgreSQL dans', dataDir);
  await server.initialise();
}
await server.start();

const admin = new pg.Client({ host: 'localhost', port, user, password, database: 'postgres' });
await admin.connect();
for (const db of databases) {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
  if (!rowCount) {
    await admin.query(`CREATE DATABASE "${db}" ENCODING 'UTF8' TEMPLATE template0`);
    console.log(`Base "${db}" créée`);
  }
}
await admin.end();
console.log(`PostgreSQL embarqué prêt sur localhost:${port} (user ${user}) — Ctrl+C pour arrêter`);

const stop = async () => {
  console.log('Arrêt de PostgreSQL…');
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
