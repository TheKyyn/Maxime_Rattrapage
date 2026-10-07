# UE03 — Observabilité d’un jeu multijoueur

Le service fourni reçoit des rapports clients et simule des parties. Ce projet ajoute une CI/CD, la collecte des logs, les métriques et trois tableaux de bord Grafana. Le rapport analyse les incidents présents dans l’export fourni.

## Démarrer

Prérequis : Docker Engine et Docker Compose v2. Les images sont épinglées par digest et disponibles pour arm64 et amd64. Laisser environ 2 Go de mémoire à Docker.

```sh
docker compose up --build
```

L’import historique se termine normalement avec le code 0. Attendre environ une minute pour l’arrivée des derniers logs et deux minutes pour les premiers taux Prometheus.

| Accès | Adresse |
|---|---|
| Grafana | http://localhost:3000 — `admin` / `ue03-local-demo` |
| API | http://localhost:8080/healthz |
| Métriques | http://localhost:8080/metrics |
| Prometheus / alertes | http://localhost:9090/alerts |
| Loki | http://localhost:3100/ready |

Les ports sont exposés uniquement sur la boucle locale. Le mot de passe de démonstration n’est pas adapté à un déploiement public. Pour le remplacer sur un volume neuf : `GRAFANA_PASSWORD=... docker compose up --build`. Un volume Grafana existant conserve son compte.

Dans Grafana, ouvrir le dossier **UE03 Observabilité** :

- **Santé du service** : trafic synthétique en direct, disponibilité, débit, erreurs, latence, mémoire, alertes.
- **Performance côté joueur** : fenêtre historique fixée aux vraies dates, signatures, build et cohorte haute résolution/bloom.
- **Activité et intégrité** : parties, victoires courtes, bots périmés et rapports incohérents.

Les liens « historique » et « en direct » changent à la fois la fenêtre de temps et le jeu de données. L’historique s’arrête le 27 septembre à 00:10, heure de Paris, pour conserver les fins de partie qui débordent après minuit.

```sh
docker compose stop        # pause, conserve les données
docker compose up -d       # reprise
docker compose down       # retire les conteneurs, conserve les volumes
```

`docker compose down -v` efface les données locales : à réserver à une remise à zéro volontaire.

## Vérifier et reproduire l’analyse

Pour les commandes hors Docker : Node.js >=22.13, npm et Python >=3.9 avec tzdata/zoneinfo (Python standard, SQLite avec JSON1).

```sh
npm ci --ignore-scripts
npm run verify
npm run import:history
npm run analyze
python3 scripts/verify-stack.py
```

`artifacts/quality.json` décrit l’import ; `history.jsonl` contient les événements normalisés et `audit.jsonl` conserve les décisions d’import avec les lignes sources. `analysis.sqlite` et `analysis.json` sont reconstruits à partir des requêtes nommées dans `docs/queries.sql`. Ils sont ignorés par Git, car entièrement reproductibles.

Résultat attendu : **2 944 blocs = 2 889 événements uniques + 55 doublons**. Les 2 889 événements se répartissent en 2 110 rapports et 779 fins de partie. Les 70 rapports incohérents restent dans les logs, mais sont exclus des statistiques de performance.

Vérifier les alertes avec leurs 21 scénarios :

```sh
docker run --rm --entrypoint /bin/promtool \
  -v "$PWD/config/prometheus:/rules:ro" -w /rules \
  prom/prometheus:v3.15.0 test rules tests.yml
```

## Architecture et choix

```text
Simulation + API → fichier JSONL → Alloy → Loki → Grafana
              └→ /metrics → Prometheus ────────→ Grafana
Export brut → import/tri/déduplication → JSONL → Alloy → Loki
                                  └→ audit + SQLite → rapport
```

- **Alloy** lit les fichiers sans accès au socket Docker. Ses positions et les données de Loki, Prometheus et Grafana persistent dans des volumes distincts. Un import identique conserve le contenu et l’inode du JSONL pour éviter une rotation inutile. Un export différent doit être ingéré dans un jeu de données distinct ou après une remise à zéro volontaire, car les fenêtres d’écriture hors ordre de Loki restent actives.
- **Loki** indexe seulement `service_name`, `dataset`, `event`, `source`. Identifiants, navigateur, build et valeurs numériques restent dans le JSON. Aucun label par joueur/partie/URL arbitraire.
- **Prometheus** mesure le service en fonctionnement ; les anciens événements ne sont pas transformés en compteurs à la date du replay. Les sources `simulation` et `ingest` sont séparées.
- Les builds inconnues sont regroupées sous `other`. Les méthodes et routes HTTP sont bornées ; les URL inconnues deviennent `unmatched`. Les erreurs JSON sont comptées avant le parseur HTTP.
- L’image applicative a deux étapes, uniquement les dépendances de production, un utilisateur non root, une racine en lecture seule et aucun privilège ajouté. Un contrôle de santé vérifie réellement `/healthz`.
- Les règles sont expliquées dans le rapport et testées. Aucun destinataire externe d’alertes n’est configuré : elles sont consultables dans Prometheus et Grafana.

Le générateur de charge fourni provoque volontairement des rapports overlay, hidden, réseau et des corps invalides. En excluant les onglets cachés, la proportion d’overlay attendue avoisine 25 % : l’alerte `OverlayRegression` peut donc être active pour `source="ingest"` en fonctionnement nominal de la démo. Cela ne constitue pas un incident réel de production.

## CI et images

`.github/workflows/ci.yml` exécute : lint → tests → import/analyse → tests Prometheus → image → scan Trivy CRITICAL → publication GHCR. Un échec empêche la publication. L’image publiée est `ghcr.io/thekyyn/maxime_rattrapage:sha-<SHA complet du commit>`.

Le workflow dispose de trois scénarios manuels :

- `normal` : validation complète, puis publication sur `main`.
- `test-failure` : le test dédié échoue réellement et bloque le job image.
- `critical-vulnerability` : ajout de lodash 4.17.11 dans une image jetable ; le scan détecte CVE-2019-10744 et sort avec le code 1. Cette image n’est jamais publiée ni déployée.

Reproduire les deux blocages localement :

```sh
UE03_DEMO_FAIL=1 npm test
# attendu : code 1

docker build -f ci/Dockerfile.vulnerable -t ue03-critical-demo:local .
sh ci/scan-image.sh ue03-critical-demo:local artifacts/ci/vulnerable
# attendu : code 1 et rapport trivy.json avec CVE critique

sh ci/scan-image.sh ue03-telemetry:local artifacts/ci/normal
# attendu : code 0 ; le scan ne supprime pas les vulnérabilités non critiques
```

Les scans varient avec les bases de vulnérabilités ; les preuves datées dans `evidence/ci/` montrent les exécutions locales observées. Les archives Docker intermédiaires restent dans `artifacts/ci/` et ne sont pas livrées.

**État : validation locale effectuée, publication GitHub en attente.** Après le push, vérifier l’exécution normale, lancer les deux scénarios d’échec et conserver leurs URLs dans `evidence/ci/runs.md`.

## Contenu du rendu

- `rapport.pdf` : analyse, postmortem, justifications, captures et limites.
- `config/grafana/dashboards/*.json` : exports versionnables des trois tableaux.
- `evidence/` : captures, sorties de tests, scans et vérifications de la stack.
- `docs/queries.sql` : chaque constat chiffré du rapport est lié à une requête nommée.
- `demo.mp4` : enregistrement de la démonstration, à ajouter avant de créer le ZIP.
- `docs/demo.md` : parcours de démonstration en moins de quatre minutes.
- `git.txt` : lien du dépôt à placer dans le ZIP.

Les scripts de simulation `telemetry.js`, `fleet.js` et `prng.js` viennent du support de l’épreuve. L’export brut est conservé dans `data/`.

Après ajout de la vidéo et des résultats Actions, lancer `python3 scripts/package.py`. L’archive est écrite dans le dossier parent. Elle exclut `.git`, `node_modules`, `artifacts` et les données des volumes.
