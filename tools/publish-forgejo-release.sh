#!/usr/bin/env bash
# publish-forgejo-release.sh — construit ET publie une release signée sur Forgejo
# en une seule commande : build-release.py, puis création de la release + upload
# des 3 fichiers via l'API REST Forgejo.
#
# Usage :
#   FORGEJO_URL=https://192.168.0.230:3000 FORGEJO_REPO=theworms/panda \
#   bash tools/publish-forgejo-release.sh
#
# Le jeton n'est jamais passé en argument (visible dans l'historique shell /
# `ps`) : il est lu depuis la variable FORGEJO_TOKEN si déjà exportée, sinon
# demandé de façon masquée. Utilise un jeton à portée write:repository —
# DISTINCT du jeton read:repository configuré côté Panda pour le canal beta.
set -euo pipefail
cd "$(dirname "$0")/.."

FORGEJO_URL="${FORGEJO_URL:?définis FORGEJO_URL, ex. https://192.168.0.230:3000}"
FORGEJO_REPO="${FORGEJO_REPO:?définis FORGEJO_REPO, ex. theworms/panda}"
FORGEJO_URL="${FORGEJO_URL%/}"

if [ -z "${FORGEJO_TOKEN:-}" ]; then
  read -rsp "Jeton Forgejo (write:repository) : " FORGEJO_TOKEN
  echo
fi

echo "=== 1. Construction et signature de la release ==="
python3 tools/build-release.py

VERSION=$(python3 -c "import re; print(re.search(r'APP_VERSION = \"([^\"]+)\"', open('app.py',encoding='utf-8').read()).group(1))")
TAG="v${VERSION}"
echo "→ version détectée : ${VERSION} (tag ${TAG})"

for f in panda.zip release.json release.json.sig; do
  [ -f "dist/$f" ] || { echo "❌ dist/$f absent — build-release.py a-t-il échoué ?"; exit 1; }
done

API="${FORGEJO_URL}/api/v1/repos/${FORGEJO_REPO}"

echo "=== 2. Vérification : le tag existe-t-il déjà ? ==="
EXISTING=$(curl -sk -H "Authorization: token ${FORGEJO_TOKEN}" \
  -o /dev/null -w '%{http_code}' "${API}/releases/tags/${TAG}")
if [ "$EXISTING" = "200" ]; then
  echo "❌ une release ${TAG} existe déjà sur Forgejo."
  echo "   Bump la version dans app.py avant de republier (une version publiée est immuable)."
  exit 1
fi

echo "=== 3. Création de la release ${TAG} ==="
HTTP_CODE=$(curl -sk -o /tmp/forgejo-create-resp.json -w '%{http_code}' -X POST "${API}/releases" \
  -H "Authorization: token ${FORGEJO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"tag_name\":\"${TAG}\",\"target_commitish\":\"main\",\"name\":\"${TAG}\",\"draft\":false,\"prerelease\":false}")
RESP=$(cat /tmp/forgejo-create-resp.json 2>/dev/null)
if [ "$HTTP_CODE" != "201" ]; then
  echo "❌ échec de création de la release (HTTP ${HTTP_CODE})."
  if [ "$HTTP_CODE" = "401" ]; then
    echo "   Jeton invalide ou sans droit d'écriture (write:repository requis)."
  fi
  echo "   Réponse Forgejo : ${RESP:-<vide>}"
  rm -f /tmp/forgejo-create-resp.json
  exit 1
fi
RELEASE_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['id'])" /tmp/forgejo-create-resp.json) || {
  echo "❌ réponse Forgejo inattendue (pas d'id de release) : ${RESP}"; rm -f /tmp/forgejo-create-resp.json; exit 1; }
rm -f /tmp/forgejo-create-resp.json
echo "→ release créée, id ${RELEASE_ID}"

echo "=== 4. Upload des 3 fichiers ==="
for f in panda.zip release.json release.json.sig; do
  echo "  → dist/$f"
  CODE=$(curl -sk -o /tmp/forgejo-upload-resp.json -w '%{http_code}' \
    -X POST "${API}/releases/${RELEASE_ID}/assets?name=${f}" \
    -H "Authorization: token ${FORGEJO_TOKEN}" \
    -F "attachment=@dist/${f}")
  if [ "$CODE" != "201" ]; then
    echo "❌ échec upload de $f (HTTP $CODE) :"; cat /tmp/forgejo-upload-resp.json; exit 1
  fi
done
rm -f /tmp/forgejo-upload-resp.json

echo "=== 5. Vérification finale ==="
curl -sk -H "Authorization: token ${FORGEJO_TOKEN}" "${API}/releases/tags/${TAG}" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
names=[a['name'] for a in d['assets']]
print('tag       :', d['tag_name'])
print('assets    :', names)
assert set(names)=={'panda.zip','release.json','release.json.sig'}, 'assets incomplets !'
print('✅ release', d['tag_name'], 'publiée avec les 3 fichiers.')
"
