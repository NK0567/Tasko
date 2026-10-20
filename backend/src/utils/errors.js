export class AppError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message = 'Requête invalide', details) => new AppError('VALIDATION_ERROR', message, 400, details);
export const unauthorized = (message = 'Authentification requise') => new AppError('UNAUTHORIZED', message, 401);
export const forbidden = (message = 'Accès refusé') => new AppError('FORBIDDEN', message, 403);
export const notFound = (message = 'Ressource introuvable', details) => new AppError('NOT_FOUND', message, 404, details);
export const tooMany = (message = 'Trop de tentatives, réessayez plus tard', details) => new AppError('RATE_LIMITED', message, 429, details);
export const conflict = (message = 'Conflit', details) => new AppError('CONFLICT', message, 409, details);
export const invalidState = (message = 'Transition de statut interdite', details) =>
  new AppError('INVALID_STATE', message, 409, details);
export const paymentFailed = (message = 'Le paiement a échoué', details) => new AppError('PAYMENT_FAILED', message, 402, details);
