# QCM FFVL — site de consultation

Site statique pour **consulter et filtrer toutes les questions** du QCM officiel
des brevets de pilote FFVL, avec les bonnes réponses mises en évidence.

Aucune compilation, aucune dépendance : du HTML/CSS/JS pur. Les données sont
embarquées dans `data/qcm_ffvl.json` (généré par le scraper du dépôt).

## Fonctionnalités

- Filtrage par **examen / niveau** (Brevet Initial, Brevet de Pilote, Brevet de
  Pilote Confirmé, Qualification Treuil)
- Filtrage par **activité** (Parapente / Delta) et par **catégorie** (Météo,
  Mécavol, Pilotage…)
- **Recherche** plein texte (énoncé, réponses, code de question)
- Affichage des **bonnes réponses** (✓ vert) et des mauvaises (✗ rouge) avec les
  points, ou masquage pour s'entraîner

## Lancer en local

```bash
cd qcm-site
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/
```

> Un simple `open index.html` ne suffit pas : le `fetch()` du JSON nécessite un
> serveur HTTP (protocole `file://` bloqué par le navigateur).

## Mettre à jour les données

```bash
./refresh-data.sh        # relance le scraper et réécrit data/qcm_ffvl.json
```

## Déploiement GitHub Pages

Le workflow [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)
publie automatiquement le contenu de `qcm-site/` sur GitHub Pages à chaque push
sur `main`.

Pour l'activer : **Settings → Pages → Build and deployment → Source : GitHub
Actions** (une seule fois).

---

Données © FFVL — source : <https://qcm.ffvl.fr/> (projet
[jruffet/qcmffvl](https://github.com/jruffet/qcmffvl)). Consultation non officielle.
