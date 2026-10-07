'use strict';

const limits = require('../config/detection.json');
const { MAPS } = require('./telemetry');

const BUILDS = ['beta-20260919-2', 'beta-20260922-1', 'beta-20260924-3', 'beta-20260926-5', 'beta-20260926-6'];
const CAUSES = ['invalid', 'hidden', 'overlay', 'shader', 'world', 'network', 'render', 'unknown'];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const boundedBuild = (build) => BUILDS.includes(build) ? build : 'other';
const boundedMap = (map) => MAPS.includes(map) ? map : 'other';

function inspectReport(report = {}) {
  const issues = [];
  const frame = report.frameMs;
  const work = report.work ?? {};
  const graphics = report.graphics ?? {};
  const rtt = report.version === 2 ? report.network?.rttMs : report.rttMs;
  if (![1, 2].includes(report.version)) issues.push('unknown_schema');
  for (const [name, value] of [['frame', frame], ['work', work.totalMs], ['rtt', rtt]]) {
    if (!finite(value) || value < 0) issues.push(`invalid_${name}`);
  }
  if (finite(frame) && finite(work.totalMs) && work.totalMs > frame + limits.workToleranceMs) issues.push('work_exceeds_frame');
  if (work.stages && finite(work.totalMs)) {
    const allValues = Object.values(work.stages);
    if (allValues.some((v) => !finite(v) || v < 0)) issues.push('invalid_stage');
    // La v2 ajoute physics sans le réintégrer dans totalMs dans le support fourni.
    const values = Object.entries(work.stages).filter(([key]) => key !== 'physics').map(([, value]) => value);
    if (allValues.every(finite) && Math.abs(values.reduce((a, b) => a + b, 0) - work.totalMs) > limits.workToleranceMs) issues.push('stage_sum_mismatch');
  } else issues.push('missing_stages');
  if (work.details && typeof work.details === 'object') {
    if (Object.values(work.details).some((v) => !finite(v) || v < 0)) issues.push('invalid_detail');
    const renderParts = ['renderShadows', 'renderWorld', 'renderPostprocess', 'renderOverlay'].map((name) => work.details[name]);
    if (!renderParts.every(finite)) issues.push('invalid_render_details');
    else if (finite(work.stages?.render) && Math.abs(renderParts.reduce((a, b) => a + b, 0) - work.stages.render) > limits.workToleranceMs) issues.push('render_sum_mismatch');
  } else issues.push('missing_details');
  for (const [name, value] of [['browser_delay', report.network?.browserDelayMs], ['new_programs', graphics.newPrograms]]) {
    if (value !== undefined && (!finite(value) || value < 0)) issues.push(`invalid_${name}`);
  }
  if (graphics.gpuTimerSupported === false && graphics.gpuRenderMs !== null && graphics.gpuRenderMs !== undefined) issues.push('gpu_measurement_unsupported');
  return issues;
}

function classify(report = {}, server = {}) {
  const issues = inspectReport(report);
  const detail = report.work?.details ?? {};
  const graphics = report.graphics ?? {};
  const activities = Array.isArray(report.activities) ? report.activities : [];
  const rtt = report.version === 2 ? report.network?.rttMs : report.rttMs;
  const matches = [];
  if (activities.some((a) => a?.name === 'visibilityHidden') && report.network?.browserDelayMs >= limits.hiddenDelayMs) matches.push('hidden');
  if (detail.renderOverlay >= limits.overlayMs) matches.push('overlay');
  if (graphics.firstCapture === true && graphics.newPrograms >= limits.shaderNewPrograms) matches.push('shader');
  if (detail.worldDynamics >= limits.worldDynamicsMs) matches.push('world');
  if (report.reason === 'network' && (rtt >= limits.networkRttMs || server.tickGapMaxMs >= limits.serverTickGapMs)) matches.push('network');
  if (!matches.length && report.work?.stages?.render > 0) matches.push('render');
  return { cause: issues.length ? 'invalid' : matches[0] ?? 'unknown', signatures: matches, issues };
}

function enrich(event) {
  if (event.event === 'perf_spike') {
    const r = event.report ?? {};
    const s = event.server ?? {};
    const browser = typeof r.browser === 'string' ? r.browser.split(' · ')[0] : 'unknown';
    return { ...event, ...classify(r, s), reportId: r.id, clientId: r.id?.match(/^P-([0-9a-f]{8})-\d+$/)?.[1] ?? null,
      serverId: s.id, build: r.build ?? 'unknown', schema: r.version ?? null,
      staleBots: finite(s.botStaleCount) && s.botStaleCount >= 2 && finite(s.botDecisionAgeMs) && s.botDecisionAgeMs >= 1000,
      frameMs: finite(r.frameMs) ? r.frameMs : null,
      rttMs: finite(r.version === 2 ? r.network?.rttMs : r.rttMs) ? (r.version === 2 ? r.network.rttMs : r.rttMs) : null,
      width: r.graphics?.width ?? null, bloom: r.graphics?.bloom ?? null,
      browser: ['Chrome', 'Firefox', 'Safari', 'Brave', 'Edge'].includes(browser) ? browser : 'other', map: s.map ?? 'unknown' };
  }
  if (event.event === 'game_completed') {
    const s = event.server ?? {};
    // Le simulateur accélère les parties. L'export historique reste en temps réel.
    const speed = event.source === 'simulation' ? event.simulationSpeed ?? 1 : 1;
    const durationSeconds = (Date.parse(event.ts) - s.createdAt) / 1000 * speed;
    return { ...event, serverId: s.id, map: s.map ?? 'unknown', durationSeconds,
      shortWin: durationSeconds >= 0 && durationSeconds < limits.shortGameSeconds && s.map === 'vault' && s.score?.[0] === 3 && s.score?.[1] === 0,
      quarantined: s.quarantined === true };
  }
  return event;
}

module.exports = { classify, enrich, inspectReport, boundedBuild, boundedMap, BUILDS, CAUSES, limits };
