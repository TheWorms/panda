#!/usr/bin/env bash
# Sauvegarde des données de Panda : config/état (data/), apps du store
# (addons/) et clé de session (secret.key). À lancer sur le Pi.
# Produit panda-data-AAAA-MM-JJ.tar.gz, à passer à install.sh --data.
set -euo pipefail
DIR=/opt/panda
OUT="panda-data-$(date +%F).tar.gz"
cd "$DIR"
tar czf "/tmp/$OUT" data addons secret.key 2>/dev/null || tar czf "/tmp/$OUT" data addons
mv "/tmp/$OUT" "$HOME/$OUT"
echo "✅ Sauvegarde : $HOME/$OUT"
echo "   Rapatrie-la : scp $(whoami)@$(hostname -I | awk '{print $1}'):~/$OUT ."
