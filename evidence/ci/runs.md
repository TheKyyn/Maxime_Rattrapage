# Exécutions GitHub Actions

Contrôles du 7 octobre 2026 sur le commit `03a85e53c34ce0c2411eb2508f527f44d2f777b2`.

| Scénario | Résultat | Exécution |
|---|---|---|
| Normal | Lint, 18 tests, import, analyse et tests Prometheus réussis. Image construite, aucune vulnérabilité CRITICAL détectée, publication GHCR réussie. | [37634572207](https://github.com/TheKyyn/Maxime_Rattrapage/actions/runs/37634572207) |
| `test-failure` | 17 tests réussis et un échec volontaire. Le job `validate` échoue et le job `image` est ignoré. | [37634867100](https://github.com/TheKyyn/Maxime_Rattrapage/actions/runs/37634867100) |
| `critical-vulnerability` | Les tests réussissent. Trivy détecte CVE-2019-10744 dans lodash 4.17.11 et sort avec le code 1. La publication est ignorée, le rapport du scanner est conservé. | [37634872199](https://github.com/TheKyyn/Maxime_Rattrapage/actions/runs/37634872199) |

Les deux exécutions rouges correspondent aux échecs attendus pour démontrer le blocage du pipeline.

## Image publiée

```text
ghcr.io/thekyyn/maxime_rattrapage:sha-03a85e53c34ce0c2411eb2508f527f44d2f777b2
```

Digest du manifeste :

```text
sha256:e28baf516709ebe1bcc77e1a142e877e4b5718be1499a25eedd688f1a0b0cb8c
```

Le manifeste est accessible sans authentification. L'image contenant la dépendance vulnérable n'a pas été publiée.

## Fichiers conservés

- `github/normal/` : résultat de l'exécution, journal et rapport Trivy de l'image applicative.
- `github/test-failure/` : résultat et journal de l'échec du test.
- `github/critical-vulnerability/` : résultat, journal et rapport Trivy contenant la CVE critique.
- `github/published-image.json` : référence, digest et manifeste de l'image publiée.

Les fichiers `run.json` décrivent les jobs et leurs étapes. Les fichiers `run.log` sont les journaux récupérés dans Actions. Les deux `trivy.json` proviennent des artefacts des exécutions correspondantes.
