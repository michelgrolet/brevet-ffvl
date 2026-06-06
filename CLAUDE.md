# CLAUDE.md

Guidance for Claude Code working in this repository.

## Git workflow (standing preference)

- After completing work, **always auto-merge it into `main`** so the changes
  land there without waiting for a manual merge.
- Concretely: commit on the working branch, push it, open a PR with `main` as
  the base, then merge the PR — use GitHub auto-merge when required checks are
  configured, otherwise merge directly. The end state is the change on `main`.
- Before merging, confirm the branch is up to date with `main`; if it has
  diverged, rebase/refresh it rather than reverting work already on `main`.
- This is the default for every task unless the user says otherwise.

## Project overview

This repo (`brevet-ffvl`) bundles three independent FFVL free-flight tools.

1. **QCM FFVL** — `scrape_qcm_ffvl.py` scrapes the official pilot-brevet quiz
   into `qcm_ffvl.csv` / `qcm_ffvl.json`; `qcm-site/` is a static (vanilla
   HTML/CSS/JS) site to browse/filter questions and a revision / spaced-
   repetition mode (`qcm-site/revise.*`, `nuages.*` for the clouds page).
2. **Carte des balises météo** — `server.js` + `public/` + `src/` put FFVL
   weather beacons on a Leaflet map with live wind/temperature
   (`src/sources/*` are the data sources; `src/normalize.js` normalizes them).
3. **Suivi de vol en direct** — `src/live/*` and `public/live.*` ingest XCTrack
   livetracking, serve a shareable `/live` page, and notify on
   takeoff/landing (WhatsApp via `src/live/whatsapp-qr.js`, `notify.js`).

- `scripts/build-static.js` builds the static site; deployed via GitHub Pages
  (`.github/workflows/pages.yml`) with `/` → QCM site and `/balise/` → map.
- Node 18+, zero npm runtime dependencies.
