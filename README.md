# brevet-ffvl

Outils autour du vol libre FFVL. Ce dépôt contient plusieurs projets indépendants :

| Projet | Description | Dossier |
| --- | --- | --- |
| **QCM FFVL** | Scraper du QCM officiel des brevets de pilote (→ CSV) **+** site statique de consultation/filtrage des questions. | `scrape_qcm_ffvl.py`, [`qcm-site/`](qcm-site/) |
| **Carte des balises météo** | Application web qui place les balises météo FFVL sur une carte avec leurs relevés vent/température en temps réel. | `server.js`, `public/`, `src/` |
| **Suivi de vol en direct** | Reçoit le livetracking de XCTrack, affiche une page `/live` partageable et prévient quelqu'un (WhatsApp…) au décollage / à l'atterrissage. | `src/live/`, `public/live.*` |

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

---

# 3. Suivi de vol en direct + notification (XCTrack)

Le même serveur Node sait recevoir le **livetracking de XCTrack** : il publie une
page `/live` que **n'importe qui** peut ouvrir (ta copine, des amis…) et envoie
un **message WhatsApp avec le lien direct** quand tu décolles, puis quand tu te
poses.

XCTrack sait pousser sa position toutes les ~60 s vers n'importe quel serveur
compatible **LiveTrack24** ; on en fournit un, donc pas besoin de compte XContest.

```
Téléphone (XCTrack) ──LiveTrack24──▶ /track.php (ce serveur)
                                        │
                       page publique ◀──┤── notification WhatsApp / ntfy / webhook
                       /live (carte)    │      « 🪂 Michel vient de décoller … »
```

## Mise en route

1. **Héberge le serveur sur une URL publique.** GitHub Pages ne suffit pas (c'est
   statique) : XCTrack doit pouvoir *appeler* le serveur. N'importe quel petit
   hébergeur Node convient (Render, Fly.io, Railway, un VPS…). Lance simplement
   `node server.js` ; le port par défaut est `3000`.

2. **Configure les notifications** (`.env`, voir [`.env.example`](.env.example)) :
   - `PILOT_NAME` — ton nom affiché.
   - `WHATSAPP_RECIPIENTS` — WhatsApp **gratuit** via
     [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/).
     **Chaque** destinataire (ta copine, des amis…) doit, **une seule fois**,
     enregistrer le numéro **+34 644 51 95 23** et lui envoyer sur WhatsApp le
     message exact **« I allow callmebot to send me messages »** ; il répond avec
     une **`apikey`**. Tu mets ensuite `numero:apikey` (numéro avec indicatif pays
     **sans le `+`**), séparés par des virgules pour plusieurs personnes :
     `33612345678:123456,33698765432:654321`.
     *(Cette autorisation unique est imposée par WhatsApp/Meta — impossible de
     l'éviter pour du WhatsApp gratuit ; ensuite le destinataire ne fait plus
     jamais rien.)*
   - (option) `NTFY_TOPIC` pour une notif push libre, `NOTIFY_WEBHOOK_URL` pour
     un webhook JSON générique.

3. **Configure XCTrack** : *Préférences → Livetracking* → activer le livetracking,
   choisir le protocole **LiveTrack24**, et mettre comme **serveur** l'hôte de ton
   déploiement (ex. `your-host.example.com`, sans `http://`). Le login/mot de passe
   ne sont pas vérifiés par ce serveur, mets ce que tu veux. XCTrack peut envoyer
   le nom de ta voile (`vname`), il sera utilisé comme nom de pilote.

4. **Partage le lien.** Au décollage, le message WhatsApp contient l'URL
   `…/live?flight=…`. La page `/live` toute seule affiche automatiquement le vol
   en cours, donc tu peux aussi épingler `https://ton-host/live` une fois pour
   toutes.

## Déploiement gratuit sur Render (recommandé)

[Render](https://render.com) héberge le serveur gratuitement, **sans carte
bancaire**. Le dépôt contient un blueprint [`render.yaml`](render.yaml) :

1. Crée un compte Render, puis **New → Blueprint** et choisis ce dépôt → **Apply**.
   Render lit `render.yaml` et crée le service (offre *free*).
2. Dans le service → onglet **Environment**, renseigne :
   - `PILOT_NAME` = ton nom,
   - `WHATSAPP_RECIPIENTS` = `numero:apikey` (clé CallMeBot, voir ci-dessus).
3. Tu obtiens une URL `https://<nom>.onrender.com`. Mets `<nom>.onrender.com`
   (sans `https://`) comme **serveur LiveTrack24** dans XCTrack, et partage
   `https://<nom>.onrender.com/live`.

> ⏰ **Mise en veille.** L'offre gratuite endort le service après 15 min
> d'inactivité ; le 1er paquet le réveille en ~1 min (notif légèrement
> retardée). Pour l'éviter, crée un ping gratuit toutes les 10 min vers
> `https://<nom>.onrender.com/` sur [cron-job.org](https://cron-job.org) — ça
> reste dans le quota gratuit (un seul service 24/7).

*(Autres hébergeurs gratuits possibles : Google Cloud Run ou Fly.io — sans mise
en veille mais carte bancaire requise ; ou un tunnel Tailscale Funnel /
Cloudflare Tunnel depuis une machine allumée chez toi.)*

## Tester sans téléphone

Lance le serveur, puis simule un vol (envoie les paquets LiveTrack24 décollage →
points → atterrissage) :

```bash
node server.js
# dans un autre terminal :
node scripts/simulate-flight.js
# → ouvre l'URL /live?flight=… affichée, tu verras la trace avancer
```

Pour vérifier aussi l'envoi des notifications sans WhatsApp, pointe un webhook
local : `NOTIFY_WEBHOOK_URL=http://localhost:4555 node server.js`.

## Comment ça marche

```
src/live/
  livetrack24.js   réception protocole LiveTrack24 (/track.php, /client.php),
                   détection décollage (vitesse/déplacement) et atterrissage
  store.js         vols + traces en mémoire (persistés dans data/live-sessions.json)
  notify.js        canaux de notif : WhatsApp (CallMeBot), ntfy, webhook
public/live.html · live.js · live.css   page publique de suivi (Leaflet)
scripts/simulate-flight.js              simulateur de vol pour tester
```

- Endpoints serveur : `GET /track.php` & `/client.php` (ingestion XCTrack),
  `GET /api/live` (vols actifs) / `?flight=ID` (trace complète), page `/live`.
- « Décollage » = première position réellement en mouvement (vitesse sol
  ≥ `TAKEOFF_SPEED_KMH`, ou déplacement/gain d'altitude), pas juste l'appli
  ouverte au déco. « Atterrissage » = paquet de fin XCTrack, ou plus aucun point
  pendant `LANDING_TIMEOUT_MIN`.
- Aucune authentification : c'est **ton** serveur, ne publie pas l'URL d'ingestion
  inutilement. Les notifications ne partent que si au moins un canal est configuré.
