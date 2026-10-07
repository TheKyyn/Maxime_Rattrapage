# Parcours de démonstration

Durée visée : 3 min 40. Lancer la stack quelques minutes avant la prise pour laisser les graphiques se remplir. Préparer les onglets Grafana et les résultats CI.

| Temps | Manipulation | Point à expliquer |
|---|---|---|
| 0:00–0:20 | Terminal | Compose démarre l’ensemble ; history termine avec le code 0. |
| 0:20–0:45 | Onglet 1 — Grafana : Santé du service | Métriques en direct du service sous charge. |
| 0:45–1:05 | Onglet 2 — Grafana : Performance, en haut | 55 doublons retirés, 2 110 rapports, 70 incohérences écartées des calculs. |
| 1:05–1:45 | Onglet 2 — Comparaison des builds, puis une trace | Hausse de l’overlay dès la build du 24 septembre dans le groupe grande résolution/bloom. |
| 1:45–2:20 | Onglet 3 — Grafana : Activité et intégrité | 83 victoires courtes, 91 rapports de retards de bots, 70 rapports incohérents. |
| 2:20–2:35 | Onglet 1 — Grafana : alertes, en bas | Expliquer l’alerte réellement affichée et son origine simulée. |
| 2:35–2:50 | Onglet 4 — GitHub : scénario normal | Contrôles réussis, image publiée avec le SHA du commit. |
| 2:50–3:05 | Onglet 5 — GitHub : test en échec | Échec volontaire du test ; job image ignoré. |
| 3:05–3:25 | Onglet 6 — GitHub : scan critique, puis VS Code | Vulnérabilité critique ; publication bloquée ; rapport Trivy conservé. |
| 3:25–3:40 | Onglet 2 — Retour à la comparaison des builds | Cause probable et actions proposées dans le rapport. |

## Liens Grafana

- [Santé du service](http://localhost:3000/d/ue03-service?from=now-15m&to=now)
- [Performance historique](http://localhost:3000/d/ue03-performance?from=1789855200000&to=1790460600000&var-dataset=historical)
- [Activité historique](http://localhost:3000/d/ue03-integrite?from=1789855200000&to=1790460600000&var-dataset=historical)

Les liens historiques fixent la période et le sélecteur `dataset=historical`. Les proportions concernent les rapports reçus, pas l'ensemble des joueurs. Le total de 262 overlays concerne toutes les configurations. La cohorte haute résolution avec bloom en compte 249.

## Alertes en direct

L'état des alertes dépend de la simulation au moment de la prise. `OverlayRegression` avec `source="ingest"` peut venir des rapports envoyés par le générateur de charge. `ServerTickDegraded` avec `source="simulation"` vient des incidents `tickDegraded` de `src/fleet.js`, qui augmentent l'intervalle entre les ticks serveur.

Montrer l'état affiché. Si aucune alerte n'est active, ouvrir [les règles Prometheus](http://localhost:9090/alerts) pour montrer leur présence. Les alertes portent sur le trafic en direct, pas sur l'export historique.

## Séquence CI

Les trois exécutions à montrer sont :

- [Normal](https://github.com/TheKyyn/Maxime_Rattrapage/actions/runs/37634572207) : ouvrir le job `image`, puis la publication GHCR réussie.
- [Test défaillant](https://github.com/TheKyyn/Maxime_Rattrapage/actions/runs/37634867100) : ouvrir `validate` et l'étape `Run npm test`. Le job `image` est ignoré.
- [Vulnérabilité critique](https://github.com/TheKyyn/Maxime_Rattrapage/actions/runs/37634872199) : ouvrir `image` et le scan Trivy en échec. La publication est ignorée.

Dans `evidence/ci/github/critical-vulnerability/trivy.json`, montrer `CVE-2019-10744`, lodash 4.17.11 et la sévérité `CRITICAL`. Les rapports du scanner et les journaux GitHub sont conservés dans `evidence/ci/github/`. Le récapitulatif et le tag GHCR sont dans `evidence/ci/runs.md`. Le scan recherche uniquement les vulnérabilités `CRITICAL` et bloque la publication s’il en détecte une.

Enregistrer le fichier retenu sous `demo.mp4`, contrôler une durée maximale de 240 secondes, puis reconstruire le ZIP avec `python3 scripts/package.py`.
