import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { fileUrl, requireFile, upload } from './middleware/upload.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/users/routes.js';
import categoryRoutes from './modules/categories/routes.js';
import providerRoutes from './modules/providers/routes.js';
import jobRoutes from './modules/jobs/routes.js';
import paymentRoutes from './modules/payments/routes.js';
import messagingRoutes from './modules/messaging/routes.js';
import adminRoutes from './modules/admin/routes.js';
import disputeRoutes from './modules/disputes/routes.js';
import marketplaceRoutes from './modules/marketplace/routes.js';
import propertyRoutes from './modules/properties/routes.js';

export const corsOptions = {
  origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
  credentials: false,
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // API JSON : aucune ressource active ; les reçus HTML définissent leur propre CSP.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], imgSrc: ["'self'", 'data:'] } },
      strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cors(corsOptions));
  app.use(
    express.json({
      limit: '1mb',
      strict: false, // PUT /me/business accepte `null`
      // Corps brut conservé pour la vérification HMAC des webhooks
      verify: (req, _res, buf) => {
        if (req.originalUrl.startsWith('/api/v1/payments/webhook')) req.rawBody = buf;
      },
    }),
  );
  // Notifications Monetbil (formulaire x-www-form-urlencoded) : analysées uniquement sur les routes de webhook.
  app.use('/api/v1/payments/webhook', express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      maxAge: '7d',
      index: false,
      dotfiles: 'deny',
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (filePath.endsWith('.pdf')) res.setHeader('Content-Disposition', 'inline');
      },
    }),
  );

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'tasko-api', time: new Date().toISOString() }));

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // réponses personnelles : jamais en cache intermédiaire
    next();
  });
  api.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => config.isTest,
      handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Trop de requêtes, réessayez dans un instant' } }),
    }),
  );
  api.use('/auth', authRoutes);
  api.use('/me', userRoutes);
  api.use('/providers', providerRoutes);
  api.use('/jobs', jobRoutes);
  api.use('/disputes', disputeRoutes);
  api.use('/admin', adminRoutes);
  api.use('/', categoryRoutes);
  api.use('/', paymentRoutes);
  api.use('/', messagingRoutes);
  api.use('/', marketplaceRoutes);
  api.use('/', propertyRoutes);
  api.post('/uploads', requireAuth, ...upload.single('file'), (req, res) => {
    res.status(201).json({ url: fileUrl(requireFile(req)) });
  });

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
