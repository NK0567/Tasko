import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, query } from '../../db.js';
import { badRequest, conflict, forbidden, tooMany, unauthorized } from '../../utils/errors.js';
import { signToken } from '../../middleware/auth.js';
import { getSettings } from '../settings/service.js';
import { getUserById } from '../users/service.js';

const DEV_CODE = '123456';
const OTP_TTL_MIN = 10;
const OTP_MAX_PER_WINDOW = 3; // demandes d'OTP par numéro…
const OTP_WINDOW_MIN = 10; // …par fenêtre de 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const LOGIN_MAX_FAILURES = 5; // échecs consécutifs avant verrouillage
const LOGIN_LOCK_MIN = 15;
// Hash factice : comparaison bcrypt même si le compte n'existe pas (temps de réponse homogène, pas d'énumération).
const DUMMY_HASH = bcrypt.hashSync('tasko-dummy-password', 10);

const hashCode = (phone, code) => crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function requestOtp(phone) {
  const settings = await getSettings();
  const { n } = await one(
    `SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > now() - make_interval(mins => $2)`,
    [phone, OTP_WINDOW_MIN],
  );
  if (n >= OTP_MAX_PER_WINDOW) throw tooMany('Trop de codes demandés pour ce numéro. Réessayez dans quelques minutes.');
  const code = settings.otp_dev_mode ? DEV_CODE : String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  // un seul code actif par numéro
  await query('UPDATE otp_codes SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL', [phone]);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [phone, hashCode(phone, code), OTP_TTL_MIN],
  );
  if (!settings.otp_dev_mode) {
    // TODO(prod) : brancher un fournisseur SMS (ex. Nexah, Orange SMS API, Twilio) et envoyer `code` au numéro.
    console.warn('[otp] envoi SMS non configuré');
    return { sent: true };
  }
  return { sent: true, dev_code: DEV_CODE };
}

/** Vérifie (et consomme) un code OTP. En otp_dev_mode, 123456 est toujours accepté. 5 essais max par code. */
export async function verifyOtp(phone, code) {
  const settings = await getSettings();
  if (settings.otp_dev_mode && code === DEV_CODE) return true;
  const row = await one(
    `UPDATE otp_codes SET attempts = attempts + 1
      WHERE id = (SELECT id FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
                   ORDER BY created_at DESC LIMIT 1)
      RETURNING id, code_hash, attempts`,
    [phone],
  );
  if (!row || row.attempts > OTP_MAX_ATTEMPTS) return false;
  if (!safeEq(row.code_hash, hashCode(phone, code))) return false;
  const consumed = await one('UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [row.id]);
  return !!consumed;
}

export async function register({ full_name, phone, password, otp_code, city }) {
  const settings = await getSettings();
  if (!settings.otp_dev_mode && !otp_code) throw badRequest('Code de vérification requis', { otp_code: 'Requis' });
  let verified = false;
  if (otp_code) {
    verified = await verifyOtp(phone, otp_code);
    if (!verified) throw badRequest('Code de vérification invalide ou expiré', { otp_code: 'Code invalide' });
  }
  const exists = await one('SELECT 1 FROM users WHERE phone = $1', [phone]);
  if (exists) throw conflict('Ce numéro est déjà associé à un compte');
  const hash = await bcrypt.hash(password, 10);
  const u = await one(
    `INSERT INTO users (full_name, phone, password_hash, city, verification_level)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [full_name.trim(), phone, hash, city || null, verified ? 2 : 1],
  );
  const user = await getUserById(u.id);
  return { token: signToken(user), user };
}

/**
 * Connexion avec verrouillage temporaire : après 5 échecs consécutifs pour un numéro, 15 min de blocage
 * (même avec le bon mot de passe). Message identique que le compte existe ou non.
 */
export async function login({ phone, password }) {
  const lock = await one('SELECT failed_count, locked_until FROM login_attempts WHERE phone = $1', [phone]);
  if (lock?.locked_until && new Date(lock.locked_until).getTime() > Date.now()) {
    const min = Math.ceil((new Date(lock.locked_until).getTime() - Date.now()) / 60000);
    throw tooMany(`Trop de tentatives. Compte temporairement bloqué, réessayez dans ${min} min.`);
  }
  const u = await one('SELECT id, password_hash, status FROM users WHERE phone = $1', [phone]);
  const ok = await bcrypt.compare(password, u?.password_hash || DUMMY_HASH);
  if (!u || !ok) {
    await query(
      `INSERT INTO login_attempts (phone, failed_count, updated_at) VALUES ($1, 1, now())
       ON CONFLICT (phone) DO UPDATE SET
         failed_count = CASE WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= now() THEN 1 ELSE login_attempts.failed_count + 1 END,
         locked_until = CASE WHEN (CASE WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= now() THEN 1 ELSE login_attempts.failed_count + 1 END) >= $2
                             THEN now() + make_interval(mins => $3) ELSE NULL END,
         updated_at = now()`,
      [phone, LOGIN_MAX_FAILURES, LOGIN_LOCK_MIN],
    );
    throw unauthorized('Numéro ou mot de passe incorrect');
  }
  await query('DELETE FROM login_attempts WHERE phone = $1', [phone]);
  if (u.status === 'suspended') throw forbidden('Votre compte est suspendu. Contactez le support.');
  const user = await getUserById(u.id);
  return { token: signToken(user), user };
}
