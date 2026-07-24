#!/usr/bin/env bash
# bump-version.sh — change APP_VERSION dans app.py (remplacement scripté, jamais nano/sed -i).
# Usage : bash bump-version.sh <X.Y.Z> [/chemin/panda]

set -euo pipefail
NEW="${1:?usage: bump-version.sh X.Y.Z [repo]}"
REPO="${2:-/run/media/$(id -un)/Data/Git/panda}"
APP="$REPO/app.py"

printf '%s' "$NEW" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "version invalide : $NEW"; exit 1; }
[ -f "$APP" ] || { echo "app.py introuvable : $APP"; exit 1; }

TS=$(date +%Y%m%d-%H%M%S)
cp "$APP" "$APP.bak-$TS"

NEW="$NEW" APP="$APP" python3 <<'PY'
import os, re, sys
p, new = os.environ["APP"], os.environ["NEW"]
s = open(p, encoding="utf-8").read()
m = re.search(r'^APP_VERSION = "([^"]+)"', s, re.M)
if not m:
    sys.exit("ERREUR : ligne APP_VERSION introuvable")
old = m.group(1)
if old == new:
    print(f"déjà en {new}, rien à faire"); sys.exit(0)
s = s[:m.start()] + f'APP_VERSION = "{new}"' + s[m.end():]
open(p, "w", encoding="utf-8").write(s)
print(f"APP_VERSION : {old} → {new}")
PY

python3 -c "import ast,sys; ast.parse(open('$APP',encoding='utf-8').read()); print('app.py : syntaxe OK')" \
  || { echo "!! syntaxe cassée — restauration"; cp "$APP.bak-$TS" "$APP"; exit 1; }
echo "Sauvegarde : $APP.bak-$TS"
