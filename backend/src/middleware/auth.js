import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Vérifie un JWT et retourne l'utilisateur (minimal) ou lève UNAUTHORIZED / FORBIDDEN. */
export async function userFromToken(token) {
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Session invalide ou expirée, veuillez vous reconnecter');
  }
  const user = await one(
    'SELECT id, full_name, phone, is_admin, is_provider, status FROM users WHERE id = $1',
    [payload.sub],
  );
  if (!user) throw unauthorized('Compte introuvable');
  if (user.status === 'suspended') throw forbidden('Votre compte est suspendu. Contactez le support.');
  return user;
}

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

export async function requireAuth(req, _res, next) {
  try {
    req.user = await userFromToken(bearer(req));
    next();
  } catch (err) {
    next(err);
  }
}

/** Authentification facultative : req.user renseigné si un jeton valide est fourni. */
export async function optionalAuth(req, _res, next) {
  const token = bearer(req);
  if (!token) return next();
  try {
    req.user = await userFromToken(token);
  } catch {
    req.user = null;
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!req.user.is_admin) return next(forbidden('Réservé aux administrateurs'));
  next();
}

export function requireProvider(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!req.user.is_provider) return next(forbidden('Activez le mode prestataire pour accéder à cette fonctionnalité'));
  next();
}
