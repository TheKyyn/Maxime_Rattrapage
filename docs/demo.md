# Parcours de démonstration

Durée visée : 3 min 40. Lancer la stack quelques minutes avant la prise pour laisser les graphiques se remplir. Préparer les onglets Grafana et les résultats CI.

| Temps | Manipulation | Point à expliquer |
|---|---|---|
| 0:00–0:25 | `docker compose up --build -d`, puis `docker compose ps --all` | Les six services restent actifs. L'import `history` se termine avec le code 0. |
| 0:25–0:50 | Ouvrir Santé du service et actualiser | Disponibilité, débit, latence et erreurs de l'API sous charge. |
| 0:50–1:10 | Ouvrir Performance côté joueur sur l'historique | 55 doublons retirés, 2 110 rapports, 70 incohérences conservées à part. |
| 1:10–1:50 | Descendre à la comparaison par build, puis ouvrir une trace | La part d'overlay dépasse 60 % dans la cohorte grande résolution/bloom à partir de la build du 24 septembre. |
| 1:50–2:25 | Ouvrir Activité et intégrité, puis le classement des clients | 83 victoires courtes, 91 rapports de retards de bots et un client aux 70 rapports incohérents. |
| 2:25–3:25 | Montrer le run normal, l'échec du test et le blocage Trivy | Les contrôles conditionnent la publication. Le tag GHCR contient le SHA du commit. |
| 3:25–3:40 | Revenir à la comparaison des builds | Conclusion sur l'overlay et renvoi aux requêtes et actions proposées dans le rapport. |

## Liens Grafana

- [Santé du service](http://localhost:3000/d/ue03-service?from=now-15m&to=now)
- [Performance historique](http://localhost:3000/d/ue03-performance?from=1789855200000&to=1790460600000&var-dataset=historical)
- [Activité historique](http://localhost:3000/d/ue03-integrite?from=1789855200000&to=1790460600000&var-dataset=historical)

Les liens historiques fixent la période et le sélecteur `dataset=historical`. Les proportions concernent les rapports reçus, pas l'ensemble des joueurs.

## Séquence CI

Après le push sur `main`, préparer trois exécutions du [workflow](https://github.com/TheKyyn/Maxime_Rattrapage/actions/workflows/ci.yml) : `normal`, `test-failure` et `critical-vulnerability`. Les deux derniers scénarios doivent échouer au contrôle prévu. Dans le rapport Trivy du troisième, montrer `CVE-2019-10744`, lodash 4.17.11 et la sévérité `CRITICAL`. Conserver les URL des runs dans `evidence/ci/runs.md`.

Si les runs distants ne sont pas encore disponibles, présenter cette séquence comme une validation locale :

```sh
UE03_DEMO_FAIL=1 npm test
printf 'Code de sortie : %s\n' "$?"
```

Montrer ensuite les rapports `evidence/ci/trivy-normal.json` et `evidence/ci/trivy-vulnerable.json`, accompagnés de `scan-normal.exit` et `scan-vulnerable.exit`. Résultats conservés : aucun critique/code 0 pour l'image applicative, CVE critique/code 1 pour l'image de démonstration. La publication GitHub et GHCR reste alors à vérifier avant le dépôt final.

Enregistrer le fichier retenu sous `demo.mp4`, contrôler une durée maximale de 240 secondes, puis reconstruire le ZIP avec `python3 scripts/package.py`.
