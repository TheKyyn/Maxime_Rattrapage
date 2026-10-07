'use strict';

const { createHash } = require('node:crypto');
const { fmtLocal } = require('./telemetry');
const { enrich } = require('./classify');

function parseParisDate(text) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(text);
  if (!match) throw new Error('invalid_local_date');
  const [, month, day, year, hour, minute, second, period] = match;
  if (+year < 2000 || +year > 2100 || +hour < 1 || +hour > 12) throw new Error('invalid_local_date');
  const utc = Date.UTC(+year, +month - 1, +day, (+hour % 12) + (period === 'PM' ? 12 : 0), +minute, +second);
  // CET/CEST : on conserve seulement les candidats qui reproduisent exactement l'en-tête.
  const candidates = [1, 2].map((offset) => utc - offset * 3600_000).filter((ms) => fmtLocal(ms) === text);
  if (candidates.length !== 1) throw new Error(candidates.length ? 'ambiguous_local_date' : 'invalid_local_date');
  return new Date(candidates[0]).toISOString();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function parseExport(input) {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const headers = [];
  lines.forEach((line, i) => {
    const match = /^(Performance spike|Game completed) (\S+) · (.+)$/.exec(line);
    if (match) headers.push({ line: i, kind: match[1], id: match[2], date: match[3] });
  });
  const events = [], audit = [], seen = new Map();
  if (!headers.length) throw new Error('no_event_headers');
  if (lines.slice(0, headers[0].line).some((line) => line.trim())) throw new Error('unexpected_prefix');
  for (let i = 0; i < headers.length; i++) {
    const head = headers[i];
    const block = lines.slice(head.line + 1, headers[i + 1]?.line ?? lines.length);
    const raw = block.join('\n');
    const trace = { sourceLine: head.line + 1, headerId: head.id, headerDate: head.date };
    try {
      const jsonStart = block.findIndex((line) => line.trimStart().startsWith('{'));
      if (jsonStart < 0) throw new Error('missing_json');
      const payload = JSON.parse(block.slice(jsonStart).join('\n'));
      const isReport = head.kind === 'Performance spike';
      const report = isReport ? payload.report : undefined;
      const server = isReport ? payload.server : payload;
      if (!server || typeof server.id !== 'string' || (isReport && (!report || typeof report.id !== 'string'))) throw new Error('missing_identifier');
      const event = isReport ? 'perf_spike' : 'game_completed';
      const key = `${event}:${isReport ? report.id : server.id}`;
      const ts = parseParisDate(head.date);
      const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ ts, payload }))).digest('hex');
      const issues = [];
      if (head.id !== server.id) issues.push('header_id_mismatch');
      const summary = block.slice(0, jsonStart).join('\n').trim();
      if (isReport && summary !== `${report.reason} · ${report.frameMs}ms ${report.reason}`) issues.push('summary_mismatch');
      if (!isReport && summary !== `${server.map} · ${server.score?.[0]} - ${server.score?.[1]}`) issues.push('summary_mismatch');
      if (seen.has(key)) {
        const first = seen.get(key);
        audit.push({ ...trace, key, status: first.fingerprint === fingerprint ? 'duplicate' : 'conflict', firstLine: first.sourceLine, issues });
        continue;
      }
      seen.set(key, { fingerprint, sourceLine: trace.sourceLine });
      const normalized = enrich({ ts, event, source: 'historical', ...trace, ...(isReport ? { report } : {}), server });
      normalized.qualityIssues = issues;
      events.push(normalized);
      audit.push({ ...trace, key, status: 'accepted', issues: [...issues, ...(normalized.issues ?? [])] });
    } catch (error) {
      audit.push({ ...trace, status: 'rejected', error: error.message, excerpt: raw.slice(0, 200) });
    }
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts) || a.sourceLine - b.sourceLine);
  return { events, audit };
}

module.exports = { parseParisDate, parseExport };
