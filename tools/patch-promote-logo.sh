#!/usr/bin/env bash
# patch-promote-logo.sh — fait copier logo.svg (et changelog.txt) vers
# abeille-public lors de la promotion, pas seulement le zip.
#
# promote-addon.sh ne copie que entry["package"] (le zip) via shutil.copy2.
# Le logo.svg posé à côté du zip par publish-addon.sh n'est donc PAS porté
# vers le store public → carte en emoji sur le kiosque même après promotion.
# Ce patch ajoute la copie des fichiers frères (logo.svg, changelog.txt)
# présents dans le dossier zips/<id>/ du store privé.
#
# Idempotent, sauvegarde horodatée, validation `bash -n`. Aucun nano / sed -i.
#
# Usage : bash patch-promote-logo.sh [/chemin/panda]

set -euo pipefail
REPO="${1:-/run/media/$(id -un)/Data/Git/panda}"
SH="$REPO/tools/promote-addon.sh"
[ -f "$SH" ] || { echo "ERREUR : introuvable : $SH" >&2; exit 1; }

if grep -q "fichiers frères" "$SH" || grep -q "sibling" "$SH"; then
  echo "Déjà patché (copie des fichiers frères présente). Rien à faire."
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
cp "$SH" "$SH.bak-$TS"
echo "Sauvegarde : $SH.bak-$TS"

SH="$SH" python3 <<'PY'
import os, sys
p = os.environ["SH"]
s = open(p, encoding="utf-8").read()

# ancre : juste après la copie du zip + vérification du sha256 dans le heredoc
# Python. On insère la copie des fichiers frères APRÈS le bloc de vérif sha.
anchor = '''if sha != entry["sha256"]:
    os.remove(dst)
    sys.exit(f"ERREUR : sha256 divergent après copie ({aid})")
'''

if anchor not in s:
    sys.stderr.write(
        "ERREUR : ancre (vérif sha256) introuvable dans promote-addon.sh.\n"
        "Le fichier n'a PAS été modifié.\n")
    sys.exit(2)

fragment = '''# fichiers frères (logo.svg, changelog.txt) posés à côté du zip par
# publish-addon.sh : à copier aussi, sinon le store public/GitHub ne les a pas.
_srcdir = os.path.dirname(src)
_dstdir = os.path.dirname(dst)
for _sib in ("logo.svg", "changelog.txt"):
    _sp = os.path.join(_srcdir, _sib)
    if os.path.isfile(_sp):
        shutil.copy2(_sp, os.path.join(_dstdir, _sib))
'''

s = s.replace(anchor, anchor + fragment, 1)
open(p, "w", encoding="utf-8").write(s)
print("  copie des fichiers frères insérée après la vérification sha256.")
PY

echo "── Vérification syntaxe ──"
if bash -n "$SH"; then
  echo "bash -n OK"
  echo "✓ Patch appliqué. Sauvegarde : $SH.bak-$TS"
else
  echo "!! bash -n a ÉCHOUÉ — restauration de la sauvegarde" >&2
  cp "$SH.bak-$TS" "$SH"
  exit 1
fi
