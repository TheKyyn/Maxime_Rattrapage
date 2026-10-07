'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMetrics } = require('../src/metrics');
const { enrich } = require('../src/classify');

test('les JSON invalides et 404 sont mesurés sans label de chemin arbitraire', async () => {
  const metrics = createMetrics({ defaults: false });
  const server = createApp({ fleet: null, log() {}, metrics }).listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400);
    for (const path of ['/random-a', '/random-b']) await fetch(base + path);
    const text = await (await fetch(base + '/metrics')).text();
    assert.match(text, /game_http_requests_total\{method="POST",route="unmatched",status="400"\} 1/);
    assert.match(text, /game_http_requests_total\{method="GET",route="unmatched",status="404"\} 2/);
    assert.doesNotMatch(text, /random-a|random-b|route="\/metrics"/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('un build client arbitraire et un rapport incohérent ne polluent pas les histogrammes', async () => {
  const metrics = createMetrics({ defaults: false });
  metrics.observe(enrich({ event: 'perf_spike', source: 'ingest', report: { id: 'P-1234abcd-1', build: 'unbounded-user-value', frameMs: -1 }, server: {} }));
  const text = await metrics.registry.metrics();
  assert.match(text, /game_reports_total\{source="ingest",build="other",cause="invalid"\} 1/);
  assert.doesNotMatch(text, /unbounded-user-value|game_frame_duration_seconds_count\{/);
});
