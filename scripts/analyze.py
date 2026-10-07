#!/usr/bin/env python3
"""Rejoue les requêtes SQL documentées sur l'export normalisé (Python standard)."""
import datetime as dt
import json
import pathlib
import re
import sqlite3
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts'
OUT.mkdir(exist_ok=True)
db = sqlite3.connect(OUT / 'analysis.sqlite')
db.row_factory = sqlite3.Row
db.executescript('''
DROP VIEW IF EXISTS reports;
DROP VIEW IF EXISTS games;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS audit;
CREATE TABLE events(ts TEXT NOT NULL, local_ts TEXT NOT NULL, kind TEXT NOT NULL, source_line INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE audit(payload TEXT NOT NULL);
''')
for line in (OUT / 'history.jsonl').read_text().splitlines():
    event = json.loads(line)
    local = dt.datetime.fromisoformat(event['ts'].replace('Z', '+00:00')).astimezone(ZoneInfo('Europe/Paris')).isoformat()
    db.execute('INSERT INTO events VALUES (?,?,?,?,?)', (event['ts'], local, event['event'], event['sourceLine'], line))
for line in (OUT / 'audit.jsonl').read_text().splitlines():
    db.execute('INSERT INTO audit VALUES (?)', (line,))
db.executescript('''
CREATE VIEW reports AS SELECT ts,local_ts,source_line,payload,
 json_extract(payload,'$.reportId') id, json_extract(payload,'$.clientId') client,
 json_extract(payload,'$.serverId') server, json_extract(payload,'$.build') build,
 json_extract(payload,'$.schema') version, json_extract(payload,'$.cause') cause,
 json_extract(payload,'$.frameMs') frame_ms, json_extract(payload,'$.rttMs') rtt_ms,
 json_extract(payload,'$.width') width, json_extract(payload,'$.bloom') bloom,
 json_extract(payload,'$.browser') browser, json_extract(payload,'$.map') map,
 json_extract(payload,'$.report.work.details.renderOverlay') overlay_ms,
 json_extract(payload,'$.server.botStaleCount') bot_stale,
 json_extract(payload,'$.server.botDecisionAgeMs') bot_age_ms,
 json_extract(payload,'$.server.tickGapMaxMs') tick_gap_ms
FROM events WHERE kind='perf_spike';
CREATE VIEW games AS SELECT ts,local_ts,source_line,payload,
 json_extract(payload,'$.serverId') id, json_extract(payload,'$.map') map,
 json_extract(payload,'$.durationSeconds') duration_s,
 json_extract(payload,'$.shortWin') short_win,
 json_extract(payload,'$.quarantined') quarantined,
 json_extract(payload,'$.server.score[0]') score_a,
 json_extract(payload,'$.server.score[1]') score_b
FROM events WHERE kind='game_completed';
''')
queries = (ROOT / 'docs/queries.sql').read_text()
parts = re.split(r'^-- name: (\w+)\s*$', queries, flags=re.M)
results = {}
for name, sql in zip(parts[1::2], parts[2::2]):
    rows = [dict(row) for row in db.execute(sql.strip())]
    results[name] = {'sql': sql.strip(), 'rows': rows}
    print(f'{name}: {len(rows)} ligne(s)')
db.commit()
db.close()
(OUT / 'analysis.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
