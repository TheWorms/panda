#!/usr/bin/env bash
# promote-addon.sh — promeut un addon TESTÉ du store privé (Forgejo) vers le
# store public (abeille-public → miroir GitHub).
#
# Usage :  ./tools/promote-addon.sh <id>
#
# Ce que fait le script :
#   1. lit l'entrée <id> dans l'index du store PRIVÉ (la version testée)
#   2. copie le paquet correspondant vers le store PUBLIC
#   3. vérifie le sha256 du paquet copié
#   4. remplace l'entrée <id> dans l'index public (réécrit en entier)
#   5. SIGNE l'index public (Ed25519 — passphrase demandée)
#   6. commit + push → le miroir GitHub se synchronise tout seul
#
# La promotion est idempotente : re-promouvoir la même version ne change rien.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
_LOAD_SECRET="${PR1V8TE_LIB:-$SCRIPT_DIR/lib/load-secret.sh}"
[ -f "$_LOAD_SECRET" ] || _LOAD_SECRET="$SCRIPT_DIR/lib/load-secret.sh"
source "$_LOAD_SECRET"
PRIV="${ABEILLE_PRIV:-$HOME/Git/abeille}"
PUB="${ABEILLE_PUB:-$HOME/Git/abeille-public}"
# compat : chemins historiques si ~/Git n'existe pas
[[ -d "$PRIV" ]] || PRIV="/run/media/$(id -un)/Data/Git/abeille"
[[ -d "$PUB"  ]] || PUB="/run/media/$(id -un)/Data/Git/abeille-public"

ID="${1:?usage: promote-addon.sh <id-addon>}"
[[ -f "$PRIV/index.json" ]] || { echo "ERREUR : index privé introuvable ($PRIV)"; exit 1; }
[[ -f "$PUB/index.json"  ]] || { echo "ERREUR : index public introuvable ($PUB)"; exit 1; }

# 1+2+3+4 — extraction, copie, vérification, index (Python, jamais sed)
RES=$(PRIV="$PRIV" PUB="$PUB" ID="$ID" python3 <<'PY'
import json, os, shutil, hashlib, datetime, sys
priv, pub, aid = os.environ["PRIV"], os.environ["PUB"], os.environ["ID"]
idx_priv = json.load(open(os.path.join(priv, "index.json"), encoding="utf-8"))
entry = next((a for a in idx_priv["addons"] if a.get("id") == aid), None)
if entry is None:
    sys.exit(f"ERREUR : « {aid} » absent de l'index privé")
pkg = entry["package"]
src = os.path.join(priv, pkg)
dst = os.path.join(pub, pkg)
if not os.path.isfile(src):
    sys.exit(f"ERREUR : paquet introuvable : {src}")
os.makedirs(os.path.dirname(dst), exist_ok=True)
shutil.copy2(src, dst)
sha = hashlib.sha256(open(dst, "rb").read()).hexdigest()
if sha != entry["sha256"]:
    os.remove(dst)
    sys.exit(f"ERREUR : sha256 divergent après copie ({aid})")
# fichiers frères (logo.svg, changelog.txt) posés à côté du zip par
# publish-addon.sh : à copier aussi, sinon le store public/GitHub ne les a pas.
_srcdir = os.path.dirname(src)
_dstdir = os.path.dirname(dst)
for _sib in ("logo.svg", "changelog.txt"):
    _sp = os.path.join(_srcdir, _sib)
    if os.path.isfile(_sp):
        shutil.copy2(_sp, os.path.join(_dstdir, _sib))
idx_pub = json.load(open(os.path.join(pub, "index.json"), encoding="utf-8"))
before = next((a for a in idx_pub["addons"] if a.get("id") == aid), None)
if before and before.get("version") == entry["version"]:
    print(f"déjà à jour : {aid} {entry['version']}")
    sys.exit(0)
idx_pub["addons"] = [a for a in idx_pub["addons"] if a.get("id") != aid] + [entry]
idx_pub["addons"].sort(key=lambda a: a["id"])
idx_pub["updated"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
with open(os.path.join(pub, "index.json"), "w", encoding="utf-8") as fh:
    json.dump(idx_pub, fh, ensure_ascii=False, indent=2)
old = f" (remplace {before['version']})" if before else " (nouveau)"
print(f"promu : {aid} {entry['version']}{old} · {pkg}")
PY
) || { echo "$RES"; exit 1; }
echo "$RES"
[[ "$RES" == déjà* ]] && exit 0

# 5 — signature de l'index public (la même clé signe privé et public)
export SIGNING_PASS="${SIGNING_PASS:-$(load_secret abeille-signing-passphrase "Passphrase de la clé Abeille (abeille-signing.key)")}"
python3 "$SCRIPT_DIR/sign-index.py" "$PUB/index.json"

# 6 — commit + push (le miroir GitHub suit automatiquement)
cd "$PUB"
VER=$(python3 -c "import json;print(next(a['version'] for a in json.load(open('index.json'))['addons'] if a['id']=='$ID'))")
git add index.json index.json.sig "zips/$ID/" 2>/dev/null || git add -A
git commit -m "promote: $ID $VER" >/dev/null
git push origin main
echo "✅ $ID $VER en ligne — le miroir GitHub se synchronise."
