# brevet-ffvl

Outils autour du vol libre FFVL. Ce dépôt contient deux projets indépendants :

| Projet | Description | Dossier |
| --- | --- | --- |
| **QCM FFVL** | Scraper du QCM officiel des brevets de pilote (→ CSV) **+** site statique de consultation/filtrage des questions. | `scrape_qcm_ffvl.py`, [`qcm-site/`](qcm-site/) |
| **Carte des balises météo** | Application web qui place les balises météo FFVL sur une carte avec leurs relevés vent/température en temps réel. | `server.js`, `public/`, `src/` |

## GitHub Pages

Un unique site Pages est publié par [`.github/workflows/pages.yml`](.github/workflows/pages.yml) :

- **`/`** → site QCM FFVL (consultation des questions)
- **`/balise/`** → carte des balises météo

---

# 1. QCM FFVL

## Scraper → CSV

`scrape_qcm_ffvl.py` télécharge le QCM officiel (<https://qcm.ffvl.fr/#/qcm>, une
SPA AngularJS qui charge tout depuis `https://qcm.ffvl.fr/generated/qcm_ffvl.json`)
et exporte l'intégralité des données en CSV. Bibliothèque standard uniquement.

```bash
python3 scrape_qcm_ffvl.py                    # -> qcm_ffvl.csv
python3 scrape_qcm_ffvl.py -o sortie.csv
python3 scrape_qcm_ffvl.py --json brut.json   # exporte aussi le JSON brut
```

Le site est derrière Cloudflare (403 sur urllib via l'empreinte TLS) : le script
envoie un User-Agent de navigateur et bascule automatiquement sur `curl`.

**Format CSV** — une ligne par question : `code`, `question`, `categories`,
`activities`, `levels`, `num_answers`, `num_correct`, `correct_answers`, puis
`answer_N_text` / `answer_N_pts` / `answer_N_correct` (jusqu'à 5). Encodage
UTF-8 BOM pour Excel.

## Site de consultation

[`qcm-site/`](qcm-site/) — site statique (HTML/CSS/JS pur) pour parcourir et
filtrer toutes les questions par examen/niveau, activité, catégorie et recherche
plein texte, bonnes réponses mises en évidence. Voir
[`qcm-site/README.md`](qcm-site/README.md).

---

# 2. Carte des balises météo FFVL en temps réel

A small web app that puts FFVL weather beacons (**balises**) on a map with their
live wind / temperature readings. Zero npm dependencies — just Node 18+ and a
Leaflet frontend.

## Quick start

```bash
node server.js          # runs with bundled sample data on http://localhost:3000
```

Open <http://localhost:3000>. You'll see ~8 demo balises in France, each drawn as
a wind arrow (colour = wind strength, arrow = direction the wind comes from).

## Data sources

The server hides all data-fetching behind one cached endpoint (`/api/balises`)
and returns a single normalized balise shape (see `src/normalize.js`). Pick the
source with the `DATA_SOURCE` env var:

| `DATA_SOURCE` | What it does | Needs |
| --- | --- | --- |
| `mock` *(default)* | Reads `data/sample-balises.json`. Runs fully offline. | nothing |
| `ffvl` | **Recommended.** Calls the official FFVL Open Data API and merges the balise list with live measurements. | a free API key |
| `scrape` | **Fallback.** Scrapes `balisemeteo.com` HTML directly. Fragile. | nothing |

```bash
DATA_SOURCE=ffvl FFVL_API_KEY=xxxxxxxx node server.js
DATA_SOURCE=scrape node server.js
```

### Recommended: official FFVL API

balisemeteo.com is the FFVL beacon network, and the FFVL publishes an official
**Open Data API** that returns exactly what this app needs as JSON — far more
robust than scraping. Endpoints used (`src/sources/ffvl-api.js`):

- `https://data.ffvl.fr/api/?base=balises&r=list&mode=json&key=KEY` — balises + GPS
- `https://data.ffvl.fr/api/?base=balises&r=releves_meteo&mode=json&key=KEY` — live measurements

The old public placeholder key is **disabled**; request a free key by emailing
**informatique@ffvl.fr** (describe your app). Data is reusable with attribution
(*"Source : FFVL"*). Put the key in `.env` (gitignored) — it stays server-side
and is never exposed to the browser.

### Fallback: scraping balisemeteo.com

`src/sources/balisemeteo-scrape.js` loads the site's index page for balise
coordinates and each balise page for live values.

> ⚠️ **The scraper's regex patterns were not validated against the live site**,
> because balisemeteo.com returns HTTP 503 to datacenter/CI traffic. The first
> time you run it from a normal network, if the status bar shows `0 balises`,
> adjust the `PATTERNS` block at the top of that file to match the real HTML.
> Prefer the official API whenever you can.

## How it fits together

```
public/            Leaflet frontend (index.html, app.js, style.css)
server.js          zero-dep static host + cached /api/balises proxy
src/normalize.js   the common balise shape every source returns
src/sources/
  mock.js          bundled sample data
  ffvl-api.js      official FFVL Open Data API  (key)
  balisemeteo-scrape.js  HTML scraper           (no key, fragile)
data/sample-balises.json
```

Adding a new source = drop a module exposing `async fetchBalises()` that returns
normalized balises, and register it in `server.js`.

## Notes

- The proxy caches upstream data for `CACHE_TTL_MS` (default 60s) and serves
  stale data if an upstream refresh fails, so the map degrades gracefully.
- Respect the source: don't poll faster than balises update (~1–5 min) and keep
  the FFVL attribution visible (it's in the map footer).
