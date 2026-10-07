#!/usr/bin/env python3
"""Vérifie les services, les volumes historiques et les requêtes Grafana."""
import base64
import datetime as dt
import json
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence'
OUT.mkdir(exist_ok=True)

def get(port, path, params=None):
    if params:
        path += '?' + urllib.parse.urlencode(params)
    request = urllib.request.Request(f'http://127.0.0.1:{port}{path}')
    if port == 3000:
        auth = base64.b64encode(('admin:' + os.environ.get('GRAFANA_PASSWORD', 'ue03-local-demo')).encode()).decode()
        request.add_header('Authorization', 'Basic ' + auth)
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{port} {path}: {error.code} {error.read().decode()[:600]}') from error

health = get(8080, '/healthz')
assert health['status'] == 'ok'
assert get(3000, '/api/health')['database'] == 'ok'
targets = get(9090, '/api/v1/targets')['data']['activeTargets']
assert any(t['labels']['job'] == 'telemetry' and t['health'] == 'up' for t in targets)
# Les derniers blocs de logs historiques sont envoyés sous 30 secondes.
for attempt in range(45):
    historical = get(3100, '/loki/api/v1/query', {'query':'sum by (event) (count_over_time({dataset="historical"}[8d]))', 'time':'2026-09-27T00:00:00Z'})
    counts = {r['metric']['event']: int(r['value'][1]) for r in historical['data']['result']}
    if counts == {'perf_spike':2110, 'game_completed':779}:
        break
    time.sleep(2)
else:
    raise AssertionError(f'Historique incomplet : {counts}')
checks = []
for file in sorted((ROOT / 'config/grafana/dashboards').glob('*.json')):
    dashboard = json.loads(file.read_text())
    published = get(3000, '/api/dashboards/uid/' + dashboard['uid'])
    assert published['dashboard']['title'] == dashboard['title']
    hist = bool(dashboard['templating']['list'])
    start = dt.datetime.fromisoformat(dashboard['time']['from'].replace('Z','+00:00')).timestamp() if hist else time.time()-900
    end = dt.datetime.fromisoformat(dashboard['time']['to'].replace('Z','+00:00')).timestamp() if hist else time.time()
    for panel in dashboard['panels']:
        for target in panel.get('targets', []):
            expr = target['expr'].replace('$dataset','historical').replace('$__range',str(int(end-start))+'s')
            if target['datasource']['uid'] == 'loki':
                route = 'query_range' if target.get('queryType') == 'range' else 'query'
                params = {'query':expr, 'start':start, 'end':end, 'step':3600, 'limit':20} if route == 'query_range' else {'query':expr,'time':end}
                result = get(3100, '/loki/api/v1/' + route, params)
            else:
                result = get(9090, '/api/v1/query', {'query':expr})
            assert result['status'] == 'success', result
            rows = result['data']['result']
            assert panel['title'].endswith('?'), panel['title']
            checks.append({'dashboard':dashboard['uid'],'panel':panel['title'],'query':expr,'series':len(rows),
                           'points':sum(len(row.get('values', [])) for row in rows),
                           'values':[row.get('value') for row in rows] if panel['type']=='stat' else None})
            print('OK',dashboard['uid'],panel['title'],len(rows),'série(s)')
expected = {'Combien de rapports ?':2110,'Combien d’incohérences ?':70,'Combien de signatures overlay ?':262,
            'Combien d’onglets masqués ?':158,'Combien de parties terminées ?':779,
            'Combien de victoires courtes ?':83,'Combien de retards de bots ?':91}
for row in checks:
    if row['panel'] in expected:
        assert int(float(row['values'][0][1])) == expected[row['panel']], row
rules = get(9090, '/api/v1/rules')['data']['groups']
assert all(rule['health']=='ok' for group in rules for rule in group['rules'])
live = get(3100,'/loki/api/v1/query',{'query':'sum(count_over_time({dataset="live",event="http_request"}[5m]))'})
assert float(live['data']['result'][0]['value'][1]) > 0
proof = {'verifiedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'historicalCounts':counts,'checks':checks,
         'prometheusTargets':targets,'ruleCount':sum(len(g['rules']) for g in rules),'liveHttpRequests5m':live['data']['result'][0]['value'][1]}
(OUT / 'stack-verification.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
print('Volumes historiques, collecte live, règles et',len(checks),'requêtes vérifiées.')
