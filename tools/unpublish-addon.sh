#!/usr/bin/env bash
# unpublish-addon.sh — retire un addon du store Abeille (staging).
#
# Usage :
#   ./tools/unpublish-addon.sh <id>
#
# Ce que fait le script (miroir exact de publish-addon.sh) :
#   1. retire l'entrée <id> de index.json (réécrit en entier, trié)
#   2. supprime le dossier zips/<id>/ (zip + changelog éventuel)
#   3. SIGNE l'index (Ed25519, sign-index.py — passphrase demandée)
#   4. commit + push dans le repo abeille
#
# À n'utiliser que sur le store de STAGING (abeille). Pour le store public
# (abeille-public), passer par le workflow de promotion habituel.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
_LOAD_SECRET="${PR1V8TE_LIB:-$SCRIPT_DIR/lib/load-secret.sh}"
[ -f "$_LOAD_SECRET" ] || _LOAD_SECRET="$SCRIPT_DIR/lib/load-secret.sh"
source "$_LOAD_SECRET"

PANDA_REPO="${PANDA_REPO:-$HOME/Git/panda}"
STORE_REPO="${STORE_REPO:-$HOME/Git/abeille}"
[ -d "$PANDA_REPO" ] || PANDA_REPO="/run/media/$(id -un)/Data/Git/panda"
[ -d "$STORE_REPO" ] || STORE_REPO="/run/media/$(id -un)/Data/Git/abeille"

err() { printf 'ERREUR : %s\n' "$*" >&2; exit 1; }

[ $# -eq 1 ] || err "usage : $0 <id-addon>"
ID="$1"

[ -d "$PANDA_REPO/.git" ] || err "repo panda introuvable : $PANDA_REPO"
[ -d "$STORE_REPO/.git" ] || err "repo abeille introuvable : $STORE_REPO"

echo "── Synchronisation du repo abeille ──"
git -C "$STORE_REPO" pull --rebase

echo "── Retrait de l'entrée « $ID » de l'index ──"
STORE_REPO="$STORE_REPO" ID="$ID" python3 <<'PY'
import json, os, sys, shutil
from datetime import datetime, timezone
from pathlib import Path

store = Path(os.environ["STORE_REPO"])
addon_id = os.environ["ID"]

index_path = store / "index.json"
if not index_path.exists():
    sys.exit("ERREUR : index.json introuvable")

index = json.loads(index_path.read_text(encoding="utf-8"))
before = len(index.get("addons", []))
present = any(a["id"] == addon_id for a in index["addons"])
if not present:
    sys.exit(f"ERREUR : aucun addon « {addon_id} » dans l'index (rien à retirer)")

# même logique que publish-addon.sh, mais on retire au lieu d'ajouter
index["addons"] = [a for a in index["addons"] if a["id"] != addon_id]
index["addons"].sort(key=lambda a: a["id"])
index["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
index_path.write_text(
    json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

# suppression du dossier zips/<id>/ (zip + changelog)
zdir = store / "zips" / addon_id
if zdir.is_dir():
    shutil.rmtree(zdir)
    print(f"  zips/{addon_id}/ supprimé")
else:
    print(f"  (pas de dossier zips/{addon_id}/)")

print(f"  index : {before} → {len(index['addons'])} addon(s) au catalogue")
PY

echo "── Signature de l'index ──"
export SIGNING_PASS="${SIGNING_PASS:-$(load_secret abeille-signing-passphrase "Passphrase de la clé Abeille (abeille-signing.key)")}"
python3 "$PANDA_REPO/tools/sign-index.py" "$STORE_REPO/index.json"

echo "── Commit + push ──"
git -C "$STORE_REPO" add -A -- "index.json" "index.json.sig" "zips/$ID" 2>/dev/null || \
  git -C "$STORE_REPO" add -A -- "index.json" "index.json.sig"
if git -C "$STORE_REPO" diff --cached --quiet; then
  echo "rien à retirer (aucun changement)"
else
  git -C "$STORE_REPO" commit -m "unpublish: $ID"
  git -C "$STORE_REPO" push
fi

echo "✓ $ID retiré d'Abeille"
