'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app');
const { Fleet } = require('./fleet');
const { enrich } = require('./classify');
const { createMetrics } = require('./metrics');

const PORT = Number(process.env.PORT ?? 8080);
const LOG_FILE = process.env.LOG_FILE ?? path.join(__dirname, '..', 'logs', 'telemetry.log');
const BUILD = process.env.BUILD ?? 'beta-20260926-6';

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
stream.on('error', (error) => { console.error('Impossible d’écrire les logs:', error.message); process.exit(1); });

const fleet = new Fleet({
  build: BUILD,
  gamesPerMinute: Number(process.env.GAMES_PER_MINUTE ?? 4),
  speed: Number(process.env.SPEED ?? 10),
  incidents: process.env.INCIDENTS !== '0',
});
const metrics = createMetrics({ fleet });
const log = (obj) => {
  const event = enrich(obj);
  metrics.observe(event);
  const line = JSON.stringify(event) + '\n';
  stream.write(line);
  if (process.env.LOG_STDOUT !== '0') process.stdout.write(line);
};
fleet.on('log', (event) => log({ ...event, source: 'simulation', simulationSpeed: fleet.speed }));
fleet.start();

const app = createApp({ fleet, log, metrics });
const server = app.listen(PORT, () => {
  log({ ts: new Date().toISOString(), level: 'info', event: 'startup', port: PORT, build: BUILD });
});

const shutdown = () => {
  fleet.stop();
  server.close(() => stream.end(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
