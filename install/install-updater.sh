#!/usr/bin/env bash
# =============================================================================
#  Panda — pose l'outil de mise à jour signée « panda-update » + son sudoers.
#
#  Idempotent : relançable sans risque. Utilisable seul sur une machine déjà
#  installée (pas besoin de rejouer tout install.sh) :
#      bash install/install-updater.sh
#
#  Lance-moi avec ton utilisateur normal (pas root) : j'utilise `sudo` au
#  besoin, comme install.sh.
# =============================================================================
set -euo pipefail

DIR=/opt/panda
BIN=/usr/local/bin/panda-update
SUDOERS=/etc/sudoers.d/panda-update
SRC="$(cd "$(dirname "$0")/.." && pwd)"          # racine du dépôt
SELF="$SRC/install/panda-update"

[[ "$(id -un)" != "root" ]] || { echo "Lance-moi avec ton utilisateur normal, pas root."; exit 1; }
[[ -f "$SELF" ]] || { echo "ERREUR : $SELF introuvable (dépôt incomplet ?)"; exit 1; }

# Utilisateur applicatif = propriétaire de /opt/panda (défaut : utilisateur courant).
USER_NAME="$(stat -c %U "$DIR" 2>/dev/null || id -un)"
echo "==> panda-update — utilisateur applicatif : $USER_NAME"

# 1. Dépendance : cryptography pour l'interpréteur SYSTÈME (root), car le script
#    tourne sous /usr/bin/python3 et non sous le venv de l'app (sécurité).
if ! /usr/bin/python3 -c "import cryptography" 2>/dev/null; then
  echo "==> installation de python3-cryptography (interpréteur système)"
  sudo apt-get install -y -qq python3-cryptography
fi

# 2. Pose du script : root:root, 0755, non inscriptible par l'app.
echo "==> installation de $BIN"
sudo install -o root -g root -m 0755 "$SELF" "$BIN"

# 3. Entrée sudoers dédiée : l'utilisateur app lance EXACTEMENT ce chemin, sans
#    argument, NOPASSWD. Écriture atomique + validation visudo avant activation.
echo "==> sudoers $SUDOERS"
TMP="$(mktemp)"
printf '%s ALL=(root) NOPASSWD: /usr/bin/systemd-run --unit=panda-update --collect %s\n' "$USER_NAME" "$BIN" > "$TMP"
if sudo visudo -cf "$TMP" >/dev/null; then
  sudo install -o root -g root -m 0440 "$TMP" "$SUDOERS"
  rm -f "$TMP"
else
  rm -f "$TMP"
  echo "ERREUR : entrée sudoers invalide — rien installé."; exit 1
fi

# 4. Dossier des sauvegardes (root, 0700).
sudo mkdir -p /var/backups/panda
sudo chmod 700 /var/backups/panda

echo "✅ panda-update installé. Vérification :"
sudo -n "$BIN" --help >/dev/null 2>&1 || true   # le script ne prend pas d'argument ; simple existence
echo "   $BIN  ($(sudo stat -c '%U:%G %a' "$BIN"))"
echo "   $SUDOERS  ($(sudo stat -c '%a' "$SUDOERS"))"
echo ""
echo "Rappel : la mise à jour ne fonctionnera qu'une fois la clé publique de"
echo "release embarquée (tools/gen-release-keys.py → PANDA_RELEASE_PUBKEY dans"
echo "app.py ET RELEASE_PUBKEY dans install/panda-update) et une release signée"
echo "publiée (tools/build-release.py). Voir docs/self-update.md."
