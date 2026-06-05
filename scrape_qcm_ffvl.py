#!/usr/bin/env python3
"""Scraper pour le QCM officiel des brevets de pilote FFVL.

La page https://qcm.ffvl.fr/#/qcm est une application AngularJS qui charge
l'ensemble des questions depuis un unique fichier JSON :

    https://qcm.ffvl.fr/generated/qcm_ffvl.json

Ce script télécharge ce fichier et exporte toutes les données (questions,
réponses, points, catégories, activités, niveaux) dans un fichier CSV.

Aucune dépendance externe : uniquement la bibliothèque standard Python.

Usage :
    python3 scrape_qcm_ffvl.py                 # -> qcm_ffvl.csv
    python3 scrape_qcm_ffvl.py -o sortie.csv
    python3 scrape_qcm_ffvl.py --json data.json  # exporte aussi le JSON brut
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

DATA_URL = "https://qcm.ffvl.fr/generated/qcm_ffvl.json"

# Un User-Agent de navigateur est requis : le site est derrière Cloudflare et
# refuse (403) les requêtes avec un User-Agent par défaut comme celui d'urllib.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Nombre maximum de réponses observé sur une question (le QCM en compte au plus 5).
# Calculé dynamiquement à partir des données, avec ce minimum de sécurité.
DEFAULT_MAX_ANSWERS = 5


HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer": "https://qcm.ffvl.fr/",
}


def _fetch_urllib(url: str) -> bytes:
    """Récupère l'URL avec la bibliothèque standard."""
    request = urllib.request.Request(url, headers={**HEADERS, "Accept-Encoding": "gzip, deflate"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        if response.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return raw


def _fetch_curl(url: str) -> bytes:
    """Récupère l'URL avec curl (repli quand Cloudflare bloque urllib).

    Cloudflare empreinte la signature TLS (JA3) : urllib est souvent refusé (403)
    là où curl passe. On l'utilise donc en repli quand il est disponible.
    """
    curl = shutil.which("curl")
    if not curl:
        raise RuntimeError("curl introuvable pour le repli")
    cmd = [curl, "-fsSL", "--compressed", "--max-time", "60"]
    for key, value in HEADERS.items():
        cmd += ["-H", f"{key}: {value}"]
    cmd.append(url)
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace").strip() or f"curl a échoué ({result.returncode})")
    return result.stdout


def fetch_data(url: str = DATA_URL) -> dict:
    """Télécharge et décode le JSON du QCM FFVL.

    Essaie d'abord urllib, puis curl en repli si la requête est bloquée.
    """
    errors = []
    for name, fetcher in (("urllib", _fetch_urllib), ("curl", _fetch_curl)):
        try:
            raw = fetcher(url)
            return json.loads(raw.decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError, json.JSONDecodeError) as exc:
            errors.append(f"  - {name} : {exc}")

    sys.exit("Impossible de récupérer les données :\n" + "\n".join(errors))


def flatten(data: dict) -> tuple[list[str], list[dict]]:
    """Transforme le JSON en lignes plates prêtes pour le CSV.

    Une ligne = une question. Les réponses sont étalées en colonnes
    answer_N_text / answer_N_pts / answer_N_correct.
    """
    questions = data.get("questions", [])
    max_answers = max((len(q.get("answers", [])) for q in questions), default=DEFAULT_MAX_ANSWERS)
    max_answers = max(max_answers, 1)

    fieldnames = [
        "code",
        "question",
        "categories",
        "activities",
        "levels",
        "num_answers",
        "num_correct",
        "correct_answers",
    ]
    for i in range(1, max_answers + 1):
        fieldnames += [f"answer_{i}_text", f"answer_{i}_pts", f"answer_{i}_correct"]

    rows: list[dict] = []
    for q in questions:
        answers = q.get("answers", [])
        correct = [a.get("text", "") for a in answers if a.get("pts", 0) > 0]
        row = {
            "code": q.get("code", ""),
            "question": q.get("question", ""),
            "categories": " | ".join(q.get("categories", [])),
            "activities": " | ".join(q.get("activities", [])),
            "levels": " | ".join(q.get("levels", [])),
            "num_answers": len(answers),
            "num_correct": len(correct),
            "correct_answers": " | ".join(correct),
        }
        for i, a in enumerate(answers, start=1):
            pts = a.get("pts", 0)
            row[f"answer_{i}_text"] = a.get("text", "")
            row[f"answer_{i}_pts"] = pts
            row[f"answer_{i}_correct"] = "1" if pts > 0 else "0"
        rows.append(row)

    return fieldnames, rows


def write_csv(path: str, fieldnames: list[str], rows: list[dict]) -> None:
    # utf-8-sig pour que les accents s'affichent correctement dans Excel.
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--output", default="qcm_ffvl.csv", help="Fichier CSV de sortie (défaut : qcm_ffvl.csv)")
    parser.add_argument("--json", metavar="FICHIER", help="Enregistre aussi le JSON brut téléchargé")
    parser.add_argument("--url", default=DATA_URL, help="URL source du JSON")
    args = parser.parse_args(argv)

    print(f"Téléchargement des données depuis {args.url} ...", file=sys.stderr)
    data = fetch_data(args.url)

    version = data.get("version", "?")
    questions = data.get("questions", [])
    print(f"Version du QCM : {version} — {len(questions)} questions", file=sys.stderr)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        print(f"JSON brut enregistré : {args.json}", file=sys.stderr)

    fieldnames, rows = flatten(data)
    write_csv(args.output, fieldnames, rows)
    print(f"CSV écrit : {args.output} ({len(rows)} lignes, {len(fieldnames)} colonnes)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
