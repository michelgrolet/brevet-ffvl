#!/usr/bin/env bash
# Régénère les données du site à partir de la source officielle FFVL.
# Lance le scraper du dépôt et écrit le JSON dans qcm-site/data/.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"

python3 "$repo_root/scrape_qcm_ffvl.py" \
  -o /tmp/qcm_ffvl_refresh.csv \
  --json "$here/data/qcm_ffvl.json"

rm -f /tmp/qcm_ffvl_refresh.csv
echo "Données mises à jour : $here/data/qcm_ffvl.json"
