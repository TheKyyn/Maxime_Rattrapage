'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseParisDate, parseExport } = require('../src/export-parser');
const { classify, enrich } = require('../src/classify');
const { createRng } = require('../src/prng');
const T = require('../src/telemetry');

function sample(cause, version = 1) {
  const rng = createRng(42);
  const client = T.makeClient(rng);
  const server = T.makeServer(rng, { createdAt: Date.UTC(2026, 8, 24, 18) });
  return T.spikeReport(rng, client, server, { cause, version, build: 'beta-20260924-3', now: Date.UTC(2026, 8, 24, 19) });
}

test('Paris : été, hiver et dates inexistantes ou ambiguës', () => {
  assert.equal(parseParisDate('9/24/2026, 9:00:00 PM'), '2026-09-24T19:00:00.000Z');
  assert.equal(parseParisDate('1/24/2026, 9:00:00 PM'), '2026-01-24T20:00:00.000Z');
  assert.throws(() => parseParisDate('2/30/2026, 9:00:00 PM'), /invalid/);
  assert.throws(() => parseParisDate('3/29/2026, 2:30:00 AM'), /invalid/);
  assert.throws(() => parseParisDate('10/25/2026, 2:30:00 AM'), /ambiguous/);
});

test('les signatures du simulateur sont distinguées en v1 et v2', () => {
  for (const version of [1, 2]) for (const cause of ['overlay', 'shader', 'hidden', 'world', 'network']) {
    const e = sample(cause, version);
    assert.equal(classify(e.report, e.server).cause, cause);
  }
});

test('un rapport incohérent est isolé avant toute classification de performance', () => {
  const e = sample('overlay');
  e.report.work.stages.render = -42;
  assert.equal(classify(e.report, e.server).cause, 'invalid');
  assert.ok(classify(e.report, e.server).issues.includes('invalid_stage'));
});

test('physics et sous-détails de rendu restent validés avant la classification', () => {
  const a = sample('generic', 2);
  a.report.work.stages.physics = -10;
  assert.equal(classify(a.report, a.server).cause, 'invalid');
  for (const value of [5000, '5000']) {
    const b = sample('generic');
    b.report.work.details.renderOverlay = value;
    assert.equal(classify(b.report, b.server).cause, 'invalid');
  }
});

test('des bots périmés forment un signal indépendant de la signature graphique', () => {
  const e = sample('overlay');
  e.server.botStaleCount = 2;
  e.server.botDecisionAgeMs = 2500;
  const result = enrich({ ...e, event: 'perf_spike' });
  assert.equal(result.cause, 'overlay');
  assert.equal(result.staleBots, true);
  assert.equal(enrich({ ...e, event: 'perf_spike', server: { ...e.server, botDecisionAgeMs: 30 } }).staleBots, false);
});

test('l’import distingue doublon, collision d’identifiant et bloc tronqué', () => {
  const a = sample('overlay');
  const b = structuredClone(a);
  b.report.frameMs += 20;
  const input = '\uFEFF' + [T.exportSpike(a), T.exportSpike(a), T.exportSpike(b), T.exportSpike(sample('shader')).slice(0, -30)].join('\n').replace(/\n/g, '\r\n');
  const result = parseExport(input);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.audit.map((r) => r.status), ['accepted', 'duplicate', 'conflict', 'rejected']);
});

test('le parseur reprend au bloc suivant après un JSON cassé', () => {
  const a = sample('overlay');
  const b = sample('hidden');
  b.report.id = 'P-0123abcd-9';
  const result = parseExport(T.exportSpike(a).slice(0, -30) + '\n' + T.exportSpike(b));
  assert.deepEqual(result.audit.map((r) => r.status), ['rejected', 'accepted']);
  assert.equal(result.events[0].cause, 'hidden');
});

test('le temps accéléré du simulateur ne transforme pas les parties normales en farming', () => {
  const event = { event: 'game_completed', source: 'simulation', simulationSpeed: 10, ts: '2026-09-24T20:01:00Z', server: { createdAt: Date.parse('2026-09-24T20:00:00Z'), map: 'vault', score: [3, 0] } };
  assert.equal(enrich(event).durationSeconds, 600);
  assert.equal(enrich(event).shortWin, false);
  assert.equal(enrich({ ...event, source: 'historical' }).shortWin, true);
});

test('l’export fourni conserve ses volumes, ses v2 et ses données suspectes', () => {
  const { events, audit } = parseExport(fs.readFileSync('data/admin-export-2026-09-20_26.log', 'utf8'));
  assert.equal(events.length, 2889);
  assert.equal(audit.filter((a) => a.status === 'duplicate').length, 55);
  assert.equal(audit.filter((a) => a.status === 'rejected').length, 0);
  assert.equal(events.filter((e) => e.cause === 'invalid').length, 70);
  assert.equal(events.filter((e) => e.shortWin).length, 83);
  assert.ok(events.some((e) => e.schema === 2 && e.rttMs > 0));
});
