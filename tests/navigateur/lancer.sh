#!/usr/bin/env bash
# Les tests dans le navigateur : l'app construite (dist/) ouverte dans Chromium,
# contre une fausse base qui imite les fonctions de docs/DEPLOIEMENT.md.
#
#   tests/navigateur/lancer.sh                 toutes les suites (~10 min)
#   tests/navigateur/lancer.sh polltest solo   quelques suites
#
# Chaque suite repart d'une fausse base neuve : elle garde tout en mémoire, et ce
# qu'une suite y laisse fausserait la suivante. Code de sortie non nul au
# moindre échec.
set -u
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
cd "$RACINE" || exit 1

# Playwright, sans en faire une dépendance du projet (qui n'en a aucune) ; le
# navigateur est celui de l'environnement (/opt/pw-browsers/chromium).
# jsqr sert à relire les QR codes que l'app dessine.
if ! node --input-type=module -e "await import('playwright')" 2>/dev/null || [ ! -f node_modules/jsqr/dist/jsQR.js ]; then
  echo "Installation de Playwright et jsqr (hors projet)…"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save --silent playwright@1.63.0 jsqr@1.4.0 || exit 1
fi

node tools/bundle.js > /dev/null || exit 1

PIDS=()
arreter() { for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null; done; PIDS=(); }
trap 'arreter; kill "$SERVEUR" 2>/dev/null' EXIT

PORT=8099 node tools/serve.js > /dev/null 2>&1 &
SERVEUR=$!
sleep 0.6

if [ $# -gt 0 ]; then SUITES=("$@"); else
  SUITES=(); for f in "$ICI"/*.mjs; do n="$(basename "$f" .mjs)"; [ "$n" = fausse-base ] || SUITES+=("$n"); done
fi

ECHECS=0
for suite in "${SUITES[@]}"; do
  arreter
  node "$ICI/fausse-base.mjs" > /dev/null 2>&1 & PIDS+=($!)
  OLD=1 PORT=8124 node "$ICI/fausse-base.mjs" > /dev/null 2>&1 & PIDS+=($!)
  sleep 0.6
  printf '%-14s ' "$suite"
  sortie="$(timeout 900 node "$ICI/$suite.mjs" 2>&1)"
  ligne="$(printf '%s\n' "$sortie" | grep -E 'vérifications' | tail -1)"
  if [ -z "$ligne" ]; then
    ECHECS=$((ECHECS + 1))
    echo "ÉCHEC — $(printf '%s\n' "$sortie" | grep -E 'waiting for|Error' | head -1 | cut -c1-100)"
  else
    echo "$ligne"
    printf '%s\n' "$sortie" | grep 'ÉCHEC:' | head -5
    printf '%s\n' "$ligne" | grep -q '| 0 échecs' || ECHECS=$((ECHECS + 1))
  fi
done
arreter
echo
[ "$ECHECS" -eq 0 ] && echo "Tout passe." || echo "$ECHECS suite(s) en échec."
exit "$ECHECS"
