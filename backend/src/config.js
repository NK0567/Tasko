import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 4300;
const nodeEnv = process.env.NODE_ENV || 'development';
const numEnv = (key, def) => (process.env[key] !== undefined && process.env[key] !== '' && Number.isFinite(Number(process.env[key])) ? Number(process.env[key]) : def);

export const config = {
  rootDir,
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port,
  host: process.env.HOST || '0.0.0.0',
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}`,
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || 'postgres://tasko:tasko_dev_password@localhost:5433/tasko',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me-please',
  jwtExpiresIn: '30d',
  uploadDir: path.join(rootDir, 'uploads'),
  maxUploadBytes: 5 * 1024 * 1024,
  paymentProviderOverride: process.env.PAYMENT_PROVIDER || '',
  payoutProviderOverride: process.env.PAYOUT_PROVIDER || '',
  mockPaymentDelayMs: process.env.MOCK_PAYMENT_DELAY_MS ? Number(process.env.MOCK_PAYMENT_DELAY_MS) : 3000,
  mockPayoutDelayMs: process.env.MOCK_PAYOUT_DELAY_MS ? Number(process.env.MOCK_PAYOUT_DELAY_MS)
    : process.env.MOCK_PAYMENT_DELAY_MS ? Number(process.env.MOCK_PAYMENT_DELAY_MS) : 3000,
  // Clé AES-256-GCM des données sensibles au repos (comptes de versement). 64 hex, base64 de 32 octets, ou phrase (dérivée SHA-256).
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
  // Planificateur interne (libération auto, rappels, tenders, récurrences, reversements). Désactivé en test.
  schedulerEnabled: process.env.SCHEDULER_ENABLED ? process.env.SCHEDULER_ENABLED !== 'false' : nodeEnv !== 'test',
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS) || 60_000,
  notchpay: {
    baseUrl: process.env.NOTCHPAY_BASE_URL || 'https://api.notchpay.co',
    publicKey: process.env.NOTCHPAY_PUBLIC_KEY || '',
    privateKey: process.env.NOTCHPAY_PRIVATE_KEY || '',
    hashKey: process.env.NOTCHPAY_HASH_KEY || '',
  },
  // Campay — https://documenter.getpostman.com/view/2391374/T1LV8PVA (démo https://demo.campay.net/api, prod https://www.campay.net/api)
  campay: {
    baseUrl: (process.env.CAMPAY_BASE_URL || 'https://demo.campay.net/api').replace(/\/+$/, ''),
    username: process.env.CAMPAY_USERNAME || '',
    password: process.env.CAMPAY_PASSWORD || '',
    token: process.env.CAMPAY_TOKEN || '', // jeton permanent (APP KEYS) : dispense de username/password
    webhookKey: process.env.CAMPAY_WEBHOOK_KEY || '',
    // Frais publiés sur https://www.campay.net/ (consulté le 16/10/2026) — surchargeables si votre contrat diffère.
    fees: {
      collect_rate: numEnv('CAMPAY_COLLECT_FEE_RATE', 0.02),
      payout_rate: numEnv('CAMPAY_PAYOUT_FEE_RATE', 0.01),
      bank_flat: numEnv('CAMPAY_BANK_TRANSFER_FEE', 5000),
    },
  },
  // Monetbil — https://www.monetbil.com (clés du service : tableau de bord Monetbil)
  monetbil: {
    serviceKey: process.env.MONETBIL_SERVICE_KEY || '',
    serviceSecret: process.env.MONETBIL_SERVICE_SECRET || '',
    widgetUrl: (process.env.MONETBIL_WIDGET_URL || 'https://api.monetbil.com/widget/v2.1').replace(/\/+$/, ''),
    apiUrl: (process.env.MONETBIL_API_URL || 'https://api.monetbil.com/payment/v1').replace(/\/+$/, ''),
    // Versement (payouts/withdrawal) : désactivé par défaut — API seulement partiellement documentée (voir monetbil.js).
    payoutEnabled: process.env.MONETBIL_PAYOUT_ENABLED === 'true',
    payoutUrl: (process.env.MONETBIL_PAYOUT_URL || 'https://api.monetbil.com/v1/payouts/withdrawal').replace(/\/+$/, ''),
    // Accepter les paiements en mode test Monetbil (statut 7) comme réussis : JAMAIS en production.
    allowTestMode: process.env.MONETBIL_ALLOW_TESTMODE === 'true',
    // Aucun tarif public (négocié à l'ouverture du compte) : renseignez ceux de votre contrat.
    fees: {
      collect_rate: numEnv('MONETBIL_COLLECT_FEE_RATE', null),
      payout_rate: numEnv('MONETBIL_PAYOUT_FEE_RATE', null),
      bank_flat: null,
    },
  },
};

if (config.isProd && config.jwtSecret === 'dev-only-change-me-please') {
  throw new Error('JWT_SECRET doit être défini en production');
}
if (config.isProd && !config.dataEncryptionKey) {
  throw new Error('DATA_ENCRYPTION_KEY doit être défini en production (chiffrement des comptes de versement)');
}
