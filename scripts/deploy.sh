#!/usr/bin/env bash
# Déploiement de Carnet sur GitHub Pages (branche gh-pages).
#
#   scripts/deploy.sh v28 "Message de commit"
#
# Le message peut être multi-ligne (trailers compris). Étapes, dans l'ordre :
#   1. cache du service worker aligné sur la version demandée (public/sw.js) ;
#   2. lint, tests, build — un échec arrête tout avant le moindre push ;
#   3. commit sur main, rebase sur origin, push ;
#   4. copie de dist/ dans une worktree gh-pages SANS suppression : les anciens
#      assets restent en place, car Pages sert index.html avec un cache de
#      10 min qui peut encore référencer la version précédente ;
#   5. vérification en ligne : sw.js annonce la version, et chaque asset
#      référencé par l'index servi répond 200.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"

VERSION="${1:-}"; MSG="${2:-}"
[[ "$VERSION" =~ ^v[0-9]+$ ]] || { echo "usage : $0 vNN \"message\"" >&2; exit 2; }
[[ -n "$MSG" ]] || { echo "message de commit manquant" >&2; exit 2; }
SITE="https://sylvainherbin.github.io/carnet"
WT="../carnet-gh"

echo "== 1. service worker → carnet-$VERSION"
sed -i "s/const CACHE = 'carnet-v[0-9]*'/const CACHE = 'carnet-$VERSION'/" public/sw.js
grep -q "const CACHE = 'carnet-$VERSION'" public/sw.js

echo "== 2. lint, tests, build"
npx oxlint src
npm test
npm run build

echo "== 3. commit et push main"
git add -A
if git diff --cached --quiet; then echo "rien à committer sur main"; else git commit -q -F <(printf '%s\n' "$MSG"); fi
git pull -q --rebase origin main
git push -q origin main

echo "== 4. gh-pages (sans suppression)"
[[ -e "$WT" ]] && git worktree remove --force "$WT"
git fetch -q origin gh-pages
git branch -f gh-pages origin/gh-pages
git worktree add -q "$WT" gh-pages
rsync -a --exclude .git dist/ "$WT"/
( cd "$WT" && git add -A && { git diff --cached --quiet && echo "gh-pages déjà à jour" || { git commit -q -m "Déploiement $VERSION" && git push -q origin gh-pages; }; } )
git worktree remove "$WT"

echo "== 5. vérification en ligne"
ok=0
for i in $(seq 1 36); do
  if curl -fsS "$SITE/sw.js" | grep -q "carnet-$VERSION"; then ok=1; break; fi
  sleep 10
done
[[ $ok = 1 ]] || { echo "sw.js n'annonce toujours pas carnet-$VERSION après 6 min" >&2; exit 1; }
echo "sw.js : carnet-$VERSION en ligne"
index=$(curl -fsS "$SITE/")
assets=$(grep -o 'assets/[^"]*' <<<"$index" | sort -u)
[[ -n "$assets" ]] || { echo "aucun asset référencé par l'index servi ?" >&2; exit 1; }
for a in $assets; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/$a")
  echo "$code $a"
  [[ "$code" = 200 ]] || { echo "asset manquant" >&2; exit 1; }
done
# les assets du build local doivent aussi être servis, même si l'index en cache est l'ancien
for f in dist/assets/*; do
  a="assets/$(basename "$f")"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/$a")
  [[ "$code" = 200 ]] || { echo "$code $a (build local) — asset manquant" >&2; exit 1; }
done
echo "déploiement $VERSION vérifié"
