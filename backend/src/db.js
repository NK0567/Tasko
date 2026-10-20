import pg from 'pg';
import { config } from './config.js';

// bigint (count, sum) -> number ; numeric -> number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15 });
pool.on('error', (err) => console.error('[pg] erreur client inactif', err.message));

export const query = (text, params) => pool.query(text, params);

export async function one(text, params, client = pool) {
  const { rows } = await client.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params, client = pool) {
  const { rows } = await client.query(text, params);
  return rows;
}

/** Exécute fn(client) dans une transaction SQL (BEGIN/COMMIT, ROLLBACK si erreur). */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
