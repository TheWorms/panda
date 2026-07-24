#!/usr/bin/env bash
# patch-publish-logo.sh — fait copier logo.svg dans zips/<id>/ par publish-addon.sh
# (à côté du zip, comme changelog.txt) pour que le store serve le logo des
# addons NON installés.
#
# Idempotent, sauvegarde horodatée, validation `bash -n` avant de garder.
# Aucun nano / sed -i manuel : insertion scriptée sur ancre.
#
# Usage : bash patch-publish-logo.sh [/chemin/panda]

set -euo pipefail
REPO="${1:-/run/media/$(id -un)/Data/Git/panda}"
SH="$REPO/tools/publish-addon.sh"
[ -f "$SH" ] || { echo "ERREUR : introuvable : $SH" >&2; exit 1; }

if grep -q "src_logo = addon_dir / logo" "$SH"; then
  echo "Déjà patché (copie du logo présente). Rien à faire."
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
cp "$SH" "$SH.bak-$TS"
echo "Sauvegarde : $SH.bak-$TS"

SH="$SH" python3 <<'PY'
import os, re, sys
p = os.environ["SH"]
s = open(p, encoding="utf-8").read()
lines = s.splitlines(keepends=True)

# ancre : la ligne qui définit `logo` dans le heredoc Python (indentation quelconque)
pat = re.compile(r'^(\s*)logo = manifest\.get\("logo"\)')
idx = ind = None
for i, ln in enumerate(lines):
    m = pat.match(ln)
    if m:
        idx, ind = i, m.group(1)
        break

if idx is None:
    sys.stderr.write(
        "ERREUR : ancre `logo = manifest.get(\"logo\")` introuvable.\n"
        "Le fichier n'a PAS été modifié. Vérifie tools/publish-addon.sh.\n")
    sys.exit(2)

# fragment ré-indenté sur la même profondeur que l'ancre
body = [
    "",
    "# logo : copié à côté du zip pour être servable par le store à distance.",
    "# Un addon NON installé n'a pas de /addons/<id>/ui/ sur le kiosque ; le",
    "# store doit donc pouvoir tirer le SVG depuis zips/<id>/<logo>.",
    "if logo:",
    "    src_logo = addon_dir / logo",
    "    if src_logo.is_file():",
    "        (addon_zdir / src_logo.name).write_bytes(src_logo.read_bytes())",
]
fragment = "".join((ind + b if b else "") + "\n" for b in body)

lines.insert(idx + 1, fragment)      # juste APRÈS la ligne d'ancre
open(p, "w", encoding="utf-8").write("".join(lines))
print(f"  fragment inséré après la définition de `logo` (indentation « {ind!r} »).")
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
