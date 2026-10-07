'use strict';

const express = require('express');

// Application HTTP : ingestion des rapports clients + consultation des parties en cours.
function createApp({ fleet, log, metrics }) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/metrics') return;
      const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const method = ['GET', 'POST', 'HEAD', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER';
      const route = req.route?.path ?? 'unmatched';
      metrics?.requests.inc({ method, route, status: String(res.statusCode) });
      metrics?.duration.observe({ method, route }, durationMs / 1000);
      log({ ts: new Date().toISOString(), level: 'info', event: 'http_request', method, path: route, status: res.statusCode, durationMs: Math.round(durationMs * 100) / 100 });
    });
    next();
  });

  // Avant le parseur : les JSON invalides et trop volumineux sont aussi mesurés.
  app.use(express.json({ limit: '64kb' }));

  app.get('/metrics', async (_req, res) => {
    if (!metrics) return res.sendStatus(503);
    res.type(metrics.registry.contentType).send(await metrics.registry.metrics());
  });

  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.get('/api/games', (req, res) => res.json(fleet ? fleet.liveGames() : []));

  app.post('/api/reports', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.report || !body.server || typeof body.server.id !== 'string') {
      return res.status(400).json({ error: 'expected { report, server }' });
    }
    const { report } = body;
    if (typeof report.id !== 'string' || !/^P-[0-9a-f]{8}-\d+$/.test(report.id)) {
      return res.status(422).json({ error: 'invalid report id' });
    }
    // Simule un traitement plus lent quand le rapport est gros (analyse, enrichissement)
    const size = JSON.stringify(body).length;
    const busy = Date.now() + Math.min(40, size / 400);
    while (Date.now() < busy) { /* travail synchrone volontaire */ }
    log({ ts: new Date().toISOString(), level: 'warn', event: 'perf_spike', source: 'ingest', report, server: body.server });
    return res.status(202).json({ accepted: report.id });
  });

  app.use((err, req, res, _next) => {
    log({ ts: new Date().toISOString(), level: 'error', event: 'http_error', message: err.message, path: req.path });
    res.status(err.status ?? 500).json({ error: 'internal' });
  });

  return app;
}

module.exports = { createApp };
