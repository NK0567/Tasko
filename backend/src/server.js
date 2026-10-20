import http from 'node:http';
import { config } from './config.js';
import { pool } from './db.js';
import { createApp, corsOptions } from './app.js';
import { attachSocket } from './realtime/socket.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';

const app = createApp();
const server = http.createServer(app);
server.headersTimeout = 30_000;
server.requestTimeout = 60_000;
const io = attachSocket(server, corsOptions);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Le port ${config.port} est déjà utilisé. Libérez-le ou définissez PORT dans .env.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(config.port, config.host, async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`Tasko API prête sur http://${config.host}:${config.port}/api/v1 (env=${config.nodeEnv})`);
    startScheduler();
  } catch (err) {
    console.error(`API démarrée mais base inaccessible (${err.message}). Lancez la base (docker compose up -d ou npm run db:embedded).`);
    startScheduler();
  }
});

const shutdown = async () => {
  stopScheduler();
  io.close();
  server.close();
  await pool.end().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
