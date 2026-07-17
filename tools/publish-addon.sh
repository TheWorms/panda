#!/usr/bin/env bash
# publish-addon.sh — publie un addon du repo panda vers le store Abeille.
#
# Usage :
#   ./tools/publish-addon.sh <id>                       # publie registry/<id>
#   ./tools/publish-addon.sh --set-version 0.1.0 <id>   # fixe la version puis publie
#   FORCE=1 ./tools/publish-addon.sh <id>               # republie une version existante
#
# Ce que fait le script :
#   1. (optionnel) écrit --set-version dans le manifeste (en Python, jamais sed)
#   2. valide l'addon avec validate-manifest.py --store (bloquant)
#   3. construit <id>-<version>.zip (contenu préfixé par <id>/,
#      sans __pycache__ ni *.pyc)
#   4. calcule le SHA-256 et met à jour index.json (réécrit en entier)
#   5. SIGNE l'index (Ed25519, sign-index.py — passphrase demandée)
#   6. commit + push dans le repo abeille
#
# Une version publiée est immuable : republier la même version exige FORCE=1
# (le bon réflexe est de bumper la version, ex. --set-version).

set -euo pipefail

PANDA_REPO="${PANDA_REPO:-/run/media/theworms/Data/Git/panda}"
STORE_REPO="${STORE_REPO:-/run/media/theworms/Data/Git/abeille}"
ADDONS_SRC="${ADDONS_SRC:-/run/media/theworms/Data/Git/addons-src}"
FORCE="${FORCE:-0}"

err() { printf 'ERREUR : %s\n' "$*" >&2; exit 1; }

SET_VERSION=""
POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --set-version) SET_VERSION="${2:-}"; shift 2 || err "--set-version attend X.Y.Z";;
    --set-version=*) SET_VERSION="${1#*=}"; shift;;
    -*) err "option inconnue : $1";;
    *) POS+=("$1"); shift;;
  esac
done
[ ${#POS[@]} -eq 1 ] || err "usage : $0 [--set-version X.Y.Z] <id-addon>"
ID="${POS[0]}"

# Source de l'addon : addons-src en priorité (les addons du store y vivent),
# repli sur panda/registry (addons encore dans le socle : base, services système).
if [ -d "$ADDONS_SRC/$ID" ]; then
  ADDON_DIR="$ADDONS_SRC/$ID"
elif [ -d "$PANDA_REPO/registry/$ID" ]; then
  ADDON_DIR="$PANDA_REPO/registry/$ID"
else
  err "addon introuvable : ni $ADDONS_SRC/$ID ni $PANDA_REPO/registry/$ID"
fi
VALIDATOR="$PANDA_REPO/tools/validate-manifest.py"

[ -d "$PANDA_REPO/.git" ]  || err "repo panda introuvable : $PANDA_REPO"
[ -d "$STORE_REPO/.git" ]  || err "repo abeille introuvable : $STORE_REPO (cloné ?)"
[ -f "$VALIDATOR" ]        || err "validateur introuvable : $VALIDATOR"
echo "── Source : $ADDON_DIR ──"

if [ -n "$SET_VERSION" ]; then
  printf '%s' "$SET_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
    || err "version invalide : $SET_VERSION (attendu X.Y.Z)"
  echo "── Version du manifeste fixée à $SET_VERSION ──"
  SET_VERSION="$SET_VERSION" ADDON_DIR="$ADDON_DIR" python3 <<'PY'
import json, os
p = os.path.join(os.environ["ADDON_DIR"], "manifest.json")
with open(p, encoding="utf-8") as fh:
    m = json.load(fh)
m["version"] = os.environ["SET_VERSION"]
with open(p, "w", encoding="utf-8") as fh:
    json.dump(m, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
fi

echo "── Validation (mode store) ──"
python3 "$VALIDATOR" --store "$ADDON_DIR" || err "validation échouée, publication annulée"

echo "── Synchronisation du repo abeille ──"
git -C "$STORE_REPO" pull --rebase

echo "── Construction du paquet + index ──"
ADDON_DIR="$ADDON_DIR" STORE_REPO="$STORE_REPO" ID="$ID" FORCE="$FORCE" python3 <<'PY'
import hashlib
import json
import os
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

addon_dir = Path(os.environ["ADDON_DIR"])
store = Path(os.environ["STORE_REPO"])
addon_id = os.environ["ID"]
force = os.environ["FORCE"] == "1"

EXCLUDED_DIRS = {"__pycache__"}
EXCLUDED_SUFFIXES = {".pyc"}
# changelog.txt : métadonnée du dépôt (à côté du zip, comme Kodi), pas du code
EXCLUDED_NAMES = {".DS_Store", "changelog.txt"}

manifest = json.loads((addon_dir / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]

# structure Kodi-like : zips/<id>/<id>-<version>.zip
addon_zdir = store / "zips" / addon_id
addon_zdir.mkdir(parents=True, exist_ok=True)
zip_name = f"{addon_id}-{version}.zip"
zip_path = addon_zdir / zip_name
package = f"zips/{addon_id}/{zip_name}"   # chemin relatif inscrit dans l'index

if zip_path.exists() and not force:
    sys.exit(
        f"ERREUR : {package} existe déjà — une version publiée est immuable.\n"
        f"Bumpe la version (ou --set-version), ou FORCE=1 pour écraser."
    )

# Zip déterministe : contenu préfixé par <id>/, fichiers triés
files = sorted(
    p for p in addon_dir.rglob("*")
    if p.is_file()
    and not EXCLUDED_DIRS.intersection(p.relative_to(addon_dir).parts)
    and p.suffix not in EXCLUDED_SUFFIXES
    and p.name not in EXCLUDED_NAMES
)
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for f in files:
        zf.write(f, arcname=f"{addon_id}/{f.relative_to(addon_dir)}")

sha256 = hashlib.sha256(zip_path.read_bytes()).hexdigest()

# changelog.txt : copié à côté du zip + contenu remonté dans l'index
changelog = ""
src_cl = addon_dir / "changelog.txt"
if src_cl.is_file():
    changelog = src_cl.read_text(encoding="utf-8")
    (addon_zdir / "changelog.txt").write_text(changelog, encoding="utf-8")

# icône : nom d'emoji du manifeste (rendu par ic() dans le style courant côté UI)
tile0 = (manifest.get("tiles") or [{}])[0]
icon = tile0.get("icon", "📦")
color = tile0.get("color", "#2dd4bf")

# index.json : réécrit en entier, entrée de l'addon remplacée
index_path = store / "index.json"
if index_path.exists():
    index = json.loads(index_path.read_text(encoding="utf-8"))
else:
    index = {"updated": None, "addons": []}

entry = {
    "id": addon_id,
    "name": manifest["name"],
    "version": version,
    "kiosk_api": manifest["kiosk_api"],
    "type": manifest["type"],
    "category": manifest.get("category", ""),
    "description": manifest.get("description", ""),
    "icon": icon,
    "color": color,
    "requires": manifest.get("requires", []),
    "changelog": changelog,
    "package": package,
    "sha256": sha256,
    "size": zip_path.stat().st_size,
}
index["addons"] = [a for a in index["addons"] if a["id"] != addon_id] + [entry]
index["addons"].sort(key=lambda a: a["id"])
index["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

index_path.write_text(
    json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

print(f"  paquet  : {package} ({zip_path.stat().st_size} octets, {len(files)} fichiers)")
print(f"  sha256  : {sha256}")
print(f"  icône   : {icon}" + ("  + changelog" if changelog else ""))
print(f"  index   : {len(index['addons'])} addon(s) au catalogue")
PY

VERSION=$(python3 -c "import json,sys; print(json.load(open('$ADDON_DIR/manifest.json'))['version'])")

echo "── Signature de l'index ──"
python3 "$PANDA_REPO/tools/sign-index.py" "$STORE_REPO/index.json"

echo "── Commit + push ──"
git -C "$STORE_REPO" add "index.json" "index.json.sig" "zips/$ID"
if git -C "$STORE_REPO" diff --cached --quiet; then
  echo "rien à publier (aucun changement)"
else
  git -C "$STORE_REPO" commit -m "publish: $ID $VERSION"
  git -C "$STORE_REPO" push
fi

echo "✓ $ID $VERSION publié sur Abeille"
