#!/usr/bin/env bash
# patch-store-logo.sh — affiche le vrai logo SVG des addons NON installés
# dans le store, en le servant depuis le dépôt distant (zips/<id>/<logo>).
#
# Idempotent (détecte STORE_URL déjà présent), sauvegarde horodatée,
# validation node --check avant de garder le résultat.
#
# Usage : bash patch-store-logo.sh [/chemin/panda]

set -euo pipefail
REPO="${1:-/run/media/$(id -un)/Data/Git/panda}"
JS="$REPO/static/panda.js"
[ -f "$JS" ] || { echo "ERREUR : introuvable : $JS" >&2; exit 1; }

if grep -q "let STORE_URL=" "$JS"; then
  echo "Déjà patché (STORE_URL présent). Rien à faire."
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
cp "$JS" "$JS.bak-$TS"
echo "Sauvegarde : $JS.bak-$TS"

python3 - "$JS" <<'PY'
import io, re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
orig = s
n = {"decl":0,"feed":0,"helper":0,"use_list":0,"use_det":0}

# 1) déclaration du global, juste après STORE_CAT
decl_anchor = "let STORE_CAT={};   // id -> catégorie, alimenté depuis l'index (pour les installés du store)\n"
if decl_anchor in s:
    s = s.replace(decl_anchor,
        decl_anchor +
        "let STORE_URL='';   // base du store distant (logos des addons non installés)\n", 1)
    n["decl"] = 1

# 2) alimentation depuis d.store_url, avant le remplissage de STORE_CAT dans renderStoreList
feed_anchor = "  if(d&&d.addons)d.addons.forEach(a=>{if(a.category)STORE_CAT[a.id]=a.category;});\n"
if feed_anchor in s:
    s = s.replace(feed_anchor,
        "  if(d&&d.store_url)STORE_URL=d.store_url;\n" + feed_anchor, 1)
    n["feed"] = 1

# 3) helper commun, inséré juste avant storeItemNode
helper = (
"/* URL du logo d'un addon du store : depuis le kiosque s'il est installé,\n"
"   sinon depuis le store distant (zips/<id>/<logo>). Repli emoji via onerror. */\n"
"function storeLogoHtml(a,_logo,icoName,icoCol){\n"
"  if(!_logo)return ic(icoName,icoCol);\n"
"  const local=(a.status==='installe');\n"
"  const src=local\n"
"    ?('/addons/'+encodeURIComponent(a.addon||a.id)+'/ui/'+encodeURIComponent(_logo)+'?v='+encodeURIComponent(a.version||'0'))\n"
"    :(STORE_URL?(STORE_URL+'zips/'+encodeURIComponent(a.id)+'/'+encodeURIComponent(_logo))\n"
"               :('/addons/'+encodeURIComponent(a.addon||a.id)+'/ui/'+encodeURIComponent(_logo)));\n"
"  return '<img class=\"tilogo\" src=\"'+src+'\" alt=\"\" onerror=\"this.replaceWith(document.createRange().createContextualFragment(this.getAttribute(\\'data-fb\\')||\\'\\'))\" data-fb=\"'+ic(icoName,icoCol).replace(/\"/g,'&quot;')+'\">';\n"
"}\n"
)
marker = "/* Construit la carte/ligne d'un addon du store (réutilisé par section). */\n"
if marker in s and "function storeLogoHtml(" not in s:
    s = s.replace(marker, helper + marker, 1)
    n["helper"] = 1

# 4) point d'usage — liste (storeItemNode)
list_old = "  const _ico=_logo?('<img class=\"tilogo\" src=\"/addons/'+encodeURIComponent(a.addon||a.id)+'/ui/'+encodeURIComponent(_logo)+'?v='+encodeURIComponent(a.version||(by?by.ver:'')||'0')+'\" alt=\"\" onerror=\"this.replaceWith(document.createRange().createContextualFragment(this.getAttribute(\\'data-fb\\')||\\'\\'))\" data-fb=\"'+ic(icoName,icoCol).replace(/\"/g,'&quot;')+'\">'):ic(icoName,icoCol);\n"
list_new = "  const _ico=storeLogoHtml(a,_logo,icoName,icoCol);\n"
if list_old in s:
    s = s.replace(list_old, list_new, 1); n["use_list"] = 1

# 5) point d'usage — détail (openAddonDetail)
det_old = "  const _dico=_dlogo?('<img class=\"tilogo\" src=\"/addons/'+encodeURIComponent(a.addon||a.id)+'/ui/'+encodeURIComponent(_dlogo)+'?v='+encodeURIComponent(a.version||(by?by.ver:'')||'0')+'\" alt=\"\" onerror=\"this.replaceWith(document.createRange().createContextualFragment(this.getAttribute(\\'data-fb\\')||\\'\\'))\" data-fb=\"'+ic(icoName,icoCol).replace(/\"/g,'&quot;')+'\">'):ic(icoName,icoCol);\n"
det_new = "  const _dico=storeLogoHtml(a,_dlogo,icoName,icoCol);\n"
if det_old in s:
    s = s.replace(det_old, det_new, 1); n["use_det"] = 1

open(p, "w", encoding="utf-8").write(s)
print("  déclaration STORE_URL   :", "OK" if n["decl"] else "!! NON APPLIQUÉ")
print("  alimentation store_url  :", "OK" if n["feed"] else "!! NON APPLIQUÉ")
print("  helper storeLogoHtml    :", "OK" if n["helper"] else "!! NON APPLIQUÉ")
print("  usage liste             :", "OK" if n["use_list"] else "!! NON APPLIQUÉ")
print("  usage détail            :", "OK" if n["use_det"] else "!! NON APPLIQUÉ")
if not all(n.values()):
    sys.stderr.write("\nAu moins une ancre n'a pas été trouvée — fichier peut-être déjà modifié.\n"
                     "Le fichier a été réécrit ; en cas de doute, restaure le .bak.\n")
    sys.exit(2)
PY

echo "── Vérification syntaxe ──"
if node --check "$JS"; then
  echo "node --check OK"
  echo "✓ Patch appliqué. Sauvegarde : $JS.bak-$TS"
else
  echo "!! node --check a ÉCHOUÉ — restauration de la sauvegarde" >&2
  cp "$JS.bak-$TS" "$JS"
  exit 1
fi
