import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Chiffrement au repos AES-256-GCM (comptes de versement de la trésorerie).
 * Format stocké : `v1:<iv base64>:<tag base64>:<chiffré base64>`.
 * Clé : DATA_ENCRYPTION_KEY (64 hex, base64 de 32 octets, ou phrase dérivée par SHA-256).
 * Hors production, une clé de développement est dérivée si la variable est absente (avertissement au démarrage).
 */
let cachedKey = null;
let warned = false;

function key() {
  if (cachedKey) return cachedKey;
  const raw = config.dataEncryptionKey;
  if (!raw) {
    if (config.isProd) throw new Error('DATA_ENCRYPTION_KEY manquante');
    if (!warned && !config.isTest) {
      console.warn('[crypto] DATA_ENCRYPTION_KEY absente : clé de développement utilisée (NE PAS utiliser en production)');
      warned = true;
    }
    cachedKey = crypto.createHash('sha256').update('tasko-dev-only-data-key').digest();
    return cachedKey;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) cachedKey = Buffer.from(raw, 'hex');
  else {
    const b = Buffer.from(raw, 'base64');
    cachedKey = b.length === 32 && /^[A-Za-z0-9+/=]+$/.test(raw) ? b : crypto.createHash('sha256').update(raw).digest();
  }
  return cachedKey;
}

export function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(payload) {
  if (!payload) return null;
  const [v, iv, tag, ct] = String(payload).split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Format chiffré inconnu');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

export const last4 = (v) => (v ? String(v).replace(/\s+/g, '').slice(-4) : null);
/** Ex. « •••• 4821 » */
export const maskTail = (tail) => (tail ? `•••• ${tail}` : null);

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
