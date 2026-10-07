'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseExport } = require('../src/export-parser');

const input = process.argv[2] ?? 'data/admin-export-2026-09-20_26.log';
const output = process.argv[3] ?? 'artifacts';
const raw = fs.readFileSync(input);
const { events, audit } = parseExport(raw.toString('utf8'));
fs.mkdirSync(output, { recursive: true });
const write = (name, text) => {
  const target = path.join(output, name);
  // Conserver l'inode et la position Alloy si l'export n'a pas changé.
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === text) return;
  fs.writeFileSync(`${target}.tmp`, text);
  fs.renameSync(`${target}.tmp`, target);
};
write('history.jsonl', events.map((event) => JSON.stringify(event)).join('\n') + '\n');
write('audit.jsonl', audit.map((event) => JSON.stringify(event)).join('\n') + '\n');
const counts = {};
for (const row of audit) counts[row.status] = (counts[row.status] ?? 0) + 1;
const summary = { input, sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length,
  inputLines: raw.toString('utf8').split('\n').length - 1, records: audit.length, counts,
  timezone: 'Europe/Paris', first: events[0]?.ts, last: events.at(-1)?.ts };
write('quality.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (counts.rejected || counts.conflict) process.exitCode = 1;
