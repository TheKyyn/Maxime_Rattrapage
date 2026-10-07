'use strict';

const client = require('prom-client');
const { boundedBuild, boundedMap, BUILDS, CAUSES } = require('./classify');
const { MAPS } = require('./telemetry');

function createMetrics({ fleet = null, defaults = true } = {}) {
  const registry = new client.Registry();
  if (defaults) client.collectDefaultMetrics({ register: registry, prefix: 'telemetry_' });
  const options = { registers: [registry] };
  const requests = new client.Counter({ ...options, name: 'game_http_requests_total', help: 'Requêtes HTTP terminées hors /metrics.', labelNames: ['method', 'route', 'status'] });
  const duration = new client.Histogram({ ...options, name: 'game_http_duration_seconds', help: 'Temps de réponse HTTP jusqu’à finish.', labelNames: ['method', 'route'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2] });
  const reports = new client.Counter({ ...options, name: 'game_reports_total', help: 'Rapports reçus, y compris les rapports incohérents.', labelNames: ['source', 'build', 'cause'] });
  const frames = new client.Histogram({ ...options, name: 'game_frame_duration_seconds', help: 'Durée des images signalées, hors rapports incohérents et onglets masqués.', labelNames: ['source', 'build', 'cause'], buckets: [0.016, 0.033, 0.05, 0.1, 0.2, 0.5, 1, 2, 5] });
  const completed = new client.Counter({ ...options, name: 'game_completed_total', help: 'Parties terminées dans le simulateur.', labelNames: ['map'] });
  const shortWins = new client.Counter({ ...options, name: 'game_short_wins_total', help: 'Victoires 3-0 sur vault en moins de 100 secondes de jeu simulé.' });
  const serverGaps = new client.Counter({ ...options, name: 'game_server_gap_reports_total', help: 'Rapports cohérents associés à un tickGapMaxMs supérieur ou égal à 150 ms.', labelNames: ['source'] });
  const staleBots = new client.Counter({ ...options, name: 'game_stale_bot_reports_total', help: 'Rapports cohérents signalant au moins deux bots dont la décision date de plus d’une seconde.', labelNames: ['source', 'map'] });
  const active = new client.Gauge({ ...options, name: 'game_active', help: 'Nombre de parties actuellement présentes dans la flotte.', collect() { this.set(fleet ? fleet.liveGames().length : 0); } });
  // Initialiser les compteurs à zéro pour afficher aussi les catégories sans événement.
  shortWins.inc(0);
  for (const source of ['simulation', 'ingest']) {
    serverGaps.labels(source).inc(0);
    for (const map of [...MAPS, 'other']) staleBots.labels(source, map).inc(0);
    for (const build of [...BUILDS, 'other']) for (const cause of CAUSES) reports.labels(source, build, cause).inc(0);
  }

  return { registry, requests, duration, active,
    observe(event) {
      if (event.event === 'perf_spike') {
        const source = event.source === 'simulation' ? 'simulation' : 'ingest';
        const labels = { source, build: boundedBuild(event.build), cause: event.cause };
        reports.inc(labels);
        if (!['invalid', 'hidden', 'unknown'].includes(event.cause) && event.frameMs >= 0) frames.observe(labels, event.frameMs / 1000);
        if (event.cause !== 'invalid' && event.server?.tickGapMaxMs >= 150) serverGaps.inc({ source });
        if (event.cause !== 'invalid' && event.staleBots) staleBots.inc({ source, map: boundedMap(event.map) });
      }
      if (event.event === 'game_completed' && event.source === 'simulation') {
        completed.inc({ map: boundedMap(event.map) });
        if (event.shortWin) shortWins.inc();
      }
    },
  };
}

module.exports = { createMetrics };
