#!/usr/bin/env bash
# publish-github-release.sh — construit ET publie une release signée sur GitHub
# (canal Stable). Réutilise les 3 fichiers déjà signés s'ils existent pour la
# version courante (ex. après un publish-forgejo-release.sh) ; sinon les
# reconstruit. La signature ne dépend pas de l'hébergeur : les mêmes 3
# fichiers sont valables sur Forgejo comme sur GitHub.
#
# Usage :
#   GITHUB_REPO=TheWorms/panda bash tools/publish-github-release.sh
#
# Le jeton n'est jamais passé en argument : lu depuis GITHUB_TOKEN si déjà
# exporté, sinon demandé de façon masquée. Portée requise : "repo" (dépôt
# public : "public_repo" suffit) — jeton DISTINCT de celui de Forgejo.
set -euo pipefail
cd "$(dirname "$0")/.."

GITHUB_REPO="${GITHUB_REPO:?définis GITHUB_REPO, ex. TheWorms/panda}"
API_BASE="${GITHUB_API_BASE:-https://api.github.com}"
UPLOAD_BASE="${GITHUB_UPLOAD_BASE:-https://uploads.github.com}"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  read -rsp "Jeton GitHub (repo) : " GITHUB_TOKEN
  echo
fi

VERSION=$(python3 -c "import re; print(re.search(r'APP_VERSION = \"([^\"]+)\"', open('app.py',encoding='utf-8').read()).group(1))")
TAG="v${VERSION}"

echo "=== 1. Fichiers signés ==="
NEED_BUILD=1
if [ -f dist/panda.zip ] && [ -f dist/release.json ] && [ -f dist/release.json.sig ]; then
  DIST_VERSION=$(python3 -c "import json; print(json.load(open('dist/release.json',encoding='utf-8'))['version'])" 2>/dev/null || echo "")
  if [ "$DIST_VERSION" = "$VERSION" ]; then
    echo "→ dist/ déjà signé pour la version ${VERSION}, réutilisation (pas de re-signature)."
    NEED_BUILD=0
  fi
fi
if [ "$NEED_BUILD" = "1" ]; then
  echo "→ reconstruction (dist/ absent ou version différente)"
  python3 tools/build-release.py
fi

for f in panda.zip release.json release.json.sig; do
  [ -f "dist/$f" ] || { echo "❌ dist/$f absent — build-release.py a-t-il échoué ?"; exit 1; }
done
echo "→ version ${VERSION} (tag ${TAG})"

AUTH_HDR=(-H "Authorization: token ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "=== 2. Vérification : une release existe-t-elle déjà pour ce tag ? ==="
EXIST_CODE=$(curl -s -o /tmp/gh-existing.json -w '%{http_code}' "${AUTH_HDR[@]}" \
  "${API_BASE}/repos/${GITHUB_REPO}/releases/tags/${TAG}")
if [ "$EXIST_CODE" = "200" ]; then
  ASSETS=$(python3 -c "import json; print([a['name'] for a in json.load(open('/tmp/gh-existing.json'))['assets']])")
  echo "❌ une release ${TAG} existe déjà sur GitHub (assets : ${ASSETS})."
  echo "   Une version publiée est immuable — bump app.py avant de republier."
  rm -f /tmp/gh-existing.json
  exit 1
fi
rm -f /tmp/gh-existing.json

echo "=== 3. Création de la release ${TAG} ==="
HTTP_CODE=$(curl -s -o /tmp/gh-create.json -w '%{http_code}' -X POST \
  "${API_BASE}/repos/${GITHUB_REPO}/releases" "${AUTH_HDR[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"tag_name\":\"${TAG}\",\"target_commitish\":\"main\",\"name\":\"${TAG}\",\"draft\":false,\"prerelease\":false}")
if [ "$HTTP_CODE" != "201" ]; then
  echo "❌ échec de création de la release (HTTP ${HTTP_CODE})."
  [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ] \
    && echo "   Jeton invalide ou sans portée 'repo' / 'public_repo'."
  echo "   Réponse GitHub : $(cat /tmp/gh-create.json 2>/dev/null)"
  rm -f /tmp/gh-create.json
  exit 1
fi
RELEASE_ID=$(python3 -c "import json; print(json.load(open('/tmp/gh-create.json'))['id'])") || {
  echo "❌ réponse GitHub inattendue (pas d'id de release)."; rm -f /tmp/gh-create.json; exit 1; }
rm -f /tmp/gh-create.json
echo "→ release créée, id ${RELEASE_ID}"

echo "=== 4. Upload des 3 fichiers ==="
# GitHub attend le contenu BRUT en corps de requête (pas de multipart, contrairement
# à Forgejo) sur l'hôte dédié uploads.github.com, avec le nom en paramètre de requête.
for f in panda.zip release.json release.json.sig; do
  echo "  → dist/$f"
  case "$f" in
    *.zip) CT="application/zip" ;;
    *) CT="application/octet-stream" ;;
  esac
  CODE=$(curl -s -o /tmp/gh-upload.json -w '%{http_code}' -X POST \
    "${UPLOAD_BASE}/repos/${GITHUB_REPO}/releases/${RELEASE_ID}/assets?name=${f}" \
    "${AUTH_HDR[@]}" -H "Content-Type: ${CT}" --data-binary "@dist/${f}")
  if [ "$CODE" != "201" ]; then
    echo "❌ échec upload de $f (HTTP $CODE) : $(cat /tmp/gh-upload.json 2>/dev/null)"
    rm -f /tmp/gh-upload.json; exit 1
  fi
done
rm -f /tmp/gh-upload.json

echo "=== 5. Vérification finale ==="
curl -s "${AUTH_HDR[@]}" "${API_BASE}/repos/${GITHUB_REPO}/releases/tags/${TAG}" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
names=[a['name'] for a in d['assets']]
print('tag       :', d['tag_name'])
print('assets    :', names)
assert set(names)=={'panda.zip','release.json','release.json.sig'}, 'assets incomplets !'
print('✅ release', d['tag_name'], 'publiée avec les 3 fichiers.')
"
