'use strict';
const fs = require('node:fs');
const path = require('node:path');

const P = { type: 'prometheus', uid: 'prometheus' };
const L = { type: 'loki', uid: 'loki' };
const histTime = { from: '2026-09-19T22:00:00.000Z', to: '2026-09-26T22:10:00.000Z' };
const histRange = '604800s';
const liveTime = { from: 'now-15m', to: 'now' };
const selector = '{dataset="$dataset",event="perf_spike"}';
const games = '{dataset="$dataset",event="game_completed"}';
let id = 0;
function panel(title, type, datasource, expr, x, y, w, h, extra = {}) {
  const target = datasource.uid === 'loki' ? { queryType: ['stat','bargauge','table'].includes(type) ? 'instant' : 'range' } : { instant: type === 'stat' };
  return { id: ++id, title, type, datasource, gridPos: { x, y, w, h },
    targets: [{ refId: 'A', datasource, expr, ...target, legendFormat: '{{cause}}{{map}}{{status}}{{build}}{{browser}}{{clientId}}' }],
    fieldConfig: { defaults: { ...(type === 'bargauge' ? {min:0} : {}), color: type === 'stat' || type === 'bargauge' ? { mode: 'fixed', fixedColor: 'blue' } : { mode: 'palette-classic' }, thresholds: { mode: 'absolute', steps: [{ color: 'blue', value: null }] } }, overrides: [] },
    options: type === 'stat' ? { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, textMode: 'auto', colorMode: 'value', graphMode: 'none' } :
      type === 'timeseries' ? { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } } :
      type === 'logs' ? { showTime: true, wrapLogMessage: true, sortOrder: 'Descending', showLabels: false, enableLogDetails: true } :
      { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: true }, orientation: 'horizontal', displayMode: 'basic', namePlacement: 'top', textMode: 'value_and_name' }, ...extra };
}
function unit(p, value) { p.fieldConfig.defaults.unit = value; return p; }
function note(title, text) { return { id: ++id, type: 'text', title, gridPos: { x:0,y:0,w:24,h:3 }, options: { mode:'markdown',content:text } }; }
function base(uid, title, description, time, panels, historical = false) {
  return { uid, title, description, schemaVersion:39, version:1, editable:false, timezone:'Europe/Paris', tags:['UE03'], time,
    refresh: historical ? '' : '10s', panels, annotations:{list:[]},
    templating:{list: historical ? [{type:'custom',name:'dataset',label:'Données',query:'historical,live',current:{text:'historical',value:'historical'},options:[{text:'historical',value:'historical',selected:true},{text:'live',value:'live',selected:false}]}] : []},
    links: [{title:'Santé du service',type:'link',url:'/d/ue03-service'},
      {title:'Performance — historique',type:'link',url:'/d/ue03-performance?from=1789855200000&to=1790460600000&var-dataset=historical'},
      {title:'Activité — historique',type:'link',url:'/d/ue03-integrite?from=1789855200000&to=1790460600000&var-dataset=historical'},
      ...(historical ? [{title:'Ce tableau en direct',type:'link',url:`/d/${uid}?from=now-15m&to=now&var-dataset=live`}] : [])] };
}
const health = base('ue03-service','UE03 · Santé du service','Service local et charge synthétique ; métriques HTTP RED.', liveTime, [
  note('Que mesure cette vue ?', '**Service en direct** · Charge générée localement. Les métriques HTTP sont collectées par Prometheus.'),
  panel('API disponible ?', 'stat', P, 'up{job="telemetry"}',0,3,4,4),
  unit(panel('Quel débit de requêtes ?', 'stat', P, 'game:api_request_rate:5m',4,3,5,4),'reqps'),
  unit(panel('Quel délai au p95 ?', 'stat', P, 'game:api_latency_p95:5m',9,3,5,4),'s'),
  unit(panel('Quel taux de 5xx ?', 'stat', P, 'game:api_error_ratio:5m',14,3,5,4),'percentunit'),
  panel('Combien de parties ?', 'stat', P, 'game_active',19,3,5,4),
  unit(panel('Comment évolue le trafic par statut ?', 'timeseries', P, 'sum by (status) (rate(game_http_requests_total{route!="/healthz"}[1m]))',0,7,12,8),'reqps'),
  unit(panel('La charge ralentit-elle l’API ?', 'timeseries', P, 'game:api_latency_p95:5m',12,7,12,8),'s'),
  panel('Quelles signatures sont reçues en direct ?', 'timeseries', P, 'sum by (cause) (rate(game_reports_total[1m]))',0,15,12,8),
  unit(panel('Quelle mémoire utilise le processus ?', 'timeseries', P, 'telemetry_process_resident_memory_bytes',12,15,12,8),'bytes'),
  panel('Quelles alertes sont actives ?', 'table', P, 'ALERTS{alertstate="firing"}',0,23,24,6,{description:'Alertes Prometheus. Le générateur local peut déclencher OverlayRegression.',targets:[{refId:'A',datasource:P,expr:'ALERTS{alertstate="firing"}',instant:true,format:'table'}],options:{showHeader:true}}),
]);
const cohort = selector+' | json cause="cause", build="build", width="width", bloom="bloom" | cause!="invalid" | width >= 2560 | bloom="true" | __error__=""';
const denom = `sum by (build) (count_over_time(${cohort} [$__range]))`;
const numer = `sum by (build) (count_over_time(${cohort} | cause="overlay" [$__range]))`;
const performance = base('ue03-performance','UE03 · Performance côté joueur','Rapports échantillonnés, signatures et cohorte haute résolution/bloom.',histTime,[
  note('Comment lire ces résultats ?', 'Les proportions concernent les **rapports de pics reçus**. La cohorte étudiée regroupe les rapports cohérents avec une largeur ≥ 2 560 px et bloom actif.'),
  panel('Combien de rapports ?', 'stat', L, `sum(count_over_time(${selector} [$__range]))`,0,3,6,4),
  panel('Combien d’incohérences ?', 'stat', L, `sum(count_over_time(${selector} | json cause="cause" | cause="invalid" [$__range]))`,6,3,6,4),
  panel('Combien de signatures overlay ?', 'stat', L, `sum(count_over_time(${selector} | json cause="cause" | cause="overlay" [$__range]))`,12,3,6,4),
  panel('Combien d’onglets masqués ?', 'stat', L, `sum(count_over_time(${selector} | json cause="cause" | cause="hidden" [$__range]))`,18,3,6,4),
  panel('Quand les signatures apparaissent-elles ?', 'timeseries', L, `sum by (cause) (count_over_time(${selector} | json cause="cause" [1h]))`,0,7,14,9,{interval:'1h',description:'Comptage par heure ; la catégorie invalid reste visible mais exclue des statistiques de performance.'}),
  panel('Quelles signatures dominent ?', 'bargauge', L, `sum by (cause) (count_over_time(${selector} | json cause="cause" [$__range]))`,14,7,10,9),
  unit(panel('Quelle part d’overlay dans la cohorte par build ?', 'bargauge', L, `((${numer}) or ((${denom}) * 0)) / (${denom})`,0,16,14,9,{description:'Cohorte : largeur ≥2560, bloom actif, rapports cohérents. La build -6 ne contient que 6 rapports dans cette cohorte : ne pas conclure à une amélioration.'}),'percentunit'),
  panel('Quels navigateurs ont signalé l’overlay ?', 'bargauge', L, `sum by (browser) (count_over_time(${selector} | json cause="cause", browser="browser" | cause="overlay" [$__range]))`,14,16,10,9),
  panel('Quelles traces étayent la régression ?', 'logs', L, `${selector} | json | cause="overlay" | line_format "build={{.build}} client={{.clientId}} frame={{.frameMs}}ms rtt={{.rttMs}}ms largeur={{.width}} bloom={{.bloom}} ligne={{.sourceLine}}"`,0,25,24,10,{description:'Ouvrir les détails de la ligne pour examiner report.work.details.renderOverlay, les timings et le serveur.'}),
],true);
const integrity = base('ue03-integrite','UE03 · Activité et intégrité','Parties, bots, répétitions et qualité des rapports.',histTime,[
  note('Quels signaux exigent une investigation ?', 'Victoires courtes, retards de bots et rapports incohérents : **trois signaux à examiner séparément**. Ils ne suffisent pas à prouver une triche.'),
  panel('Combien de parties terminées ?', 'stat', L, `sum(count_over_time(${games} [$__range]))`,0,3,6,4),
  panel('Combien de victoires courtes ?', 'stat', L, `sum(count_over_time(${games} | json shortWin="shortWin" | shortWin="true" [$__range]))`,6,3,6,4),
  panel('Combien de retards de bots ?', 'stat', L, `sum(count_over_time(${selector} | json staleBots="staleBots" | staleBots="true" [$__range]))`,12,3,6,4),
  panel('Combien d’incohérences ?', 'stat', L, `sum(count_over_time(${selector} | json cause="cause" | cause="invalid" [$__range]))`,18,3,6,4),
  panel('Quand les parties se terminent-elles ?', 'timeseries', L, `sum by (map) (count_over_time(${games} | json map="map" [1h]))`,0,7,12,9,{interval:'1h'}),
  panel('Quand les victoires courtes se concentrent-elles ?', 'timeseries', L, `sum(count_over_time(${games} | json shortWin="shortWin" | shortWin="true" [1h]))`,12,7,12,9,{interval:'1h'}),
  panel('Sur quelles cartes les bots ont-ils du retard ?', 'timeseries', L, `sum by (map) (count_over_time(${selector} | json staleBots="staleBots", map="map" | staleBots="true" [1h]))`,0,16,12,9,{interval:'1h'}),
  panel('Quels clients envoient des données incohérentes ?', 'table', L, `sum by (clientId) (count_over_time(${selector} | json cause="cause", clientId="clientId" | cause="invalid" [$__range]))`,12,16,12,9,{description:'clientId reste un champ JSON extrait à la requête, jamais un label indexé Loki ou Prometheus.',options:{showHeader:true},transformations:[{id:'organize',options:{excludeByName:{Time:true},renameByName:{clientId:'Client',Value:'Rapports incohérents','Value #A':'Rapports incohérents'}}}]}),
  panel('Quelles parties examiner pour le farming ?', 'logs', L, `${games} | json | shortWin="true" | line_format "partie={{.serverId}} carte={{.map}} durée={{.durationSeconds}}s quarantaine={{.quarantined}} ligne={{.sourceLine}}"`,0,25,24,10),
],true);
const out = path.join(__dirname, '..', 'config/grafana/dashboards');
for (const d of [health,performance,integrity]) {
  for (const p of d.panels) {
    if (p.title === 'API disponible ?') {
      p.fieldConfig.defaults.color = { mode: 'thresholds' };
      p.fieldConfig.defaults.thresholds.steps = [{ color: 'red', value: null }, { color: 'green', value: 1 }];
    }
    if (p.title === 'Quelle part d’overlay dans la cohorte par build ?') p.fieldConfig.defaults.max = 1;
    if (p.title === 'La charge ralentit-elle l’API ?') p.targets[0].legendFormat = 'P95';
    if (p.title === 'Quelle mémoire utilise le processus ?') p.targets[0].legendFormat = 'Mémoire';
  }
  fs.writeFileSync(path.join(out,d.uid+'.json'),JSON.stringify(d,null,2)+'\n');
}
console.log('3 dashboards écrits. Fenêtre historique :',histTime,'durée requêtes QA :',histRange);
