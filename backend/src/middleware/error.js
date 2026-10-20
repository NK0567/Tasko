import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../utils/errors.js';

function zodDetails(err) {
  const details = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!details[key]) details[key] = issue.message;
  }
  return details;
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route introuvable' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  }
  if (err instanceof ZodError) {
    const details = zodDetails(err);
    const first = Object.entries(details)[0];
    const message = first ? (first[0] === '_' ? first[1] : `${first[0]} : ${first[1]}`) : 'Données invalides';
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message, details } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (5 Mo maximum)' : 'Envoi de fichier invalide (un seul fichier, champ « file »)';
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Corps JSON invalide' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'VALIDATION_ERROR', message: 'Requête trop volumineuse' } });
  }
  // Erreurs PostgreSQL connues (messages génériques : aucun détail SQL n'est renvoyé)
  if (err?.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Cette ressource existe déjà' } });
  }
  if (err?.code === '23503') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Ressource liée introuvable ou encore utilisée' } });
  }
  if (err?.code === '22P02') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Identifiant ou valeur invalide' } });
  }
  if (err?.code === '23514') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Valeur non autorisée' } });
  }
  if (err?.code === '22003') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Valeur hors limites' } });
  }
  // Erreur inattendue : journalisée côté serveur, jamais exposée au client.
  console.error('[erreur]', req.method, req.originalUrl, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Erreur interne du serveur' } });
}
