#!/usr/bin/env bash
# =============================================================================
#  Panda 1.0.2 — installation autonome sur Raspberry Pi (Debian 13 « Trixie »)
#
#  Usage (en root) :
#    sudo bash install.sh                        # service Panda seul
#    sudo bash install.sh --with-kiosk           # + session écran labwc/Chromium
#    sudo bash install.sh --data panda-data.tar.gz   # + restauration des données
#    sudo bash install.sh --ca home-ca.crt      # + CA maison dans le système
#
#  Idempotent : relançable sans risque. Ne touche jamais data/, addons/ ni
#  secret.key existants (les données survivent aux réinstallations).
# =============================================================================
set -euo pipefail

KIOSK_USER="${KIOSK_USER:-panda}"
DIR=/opt/panda
PORT=8090
WITH_KIOSK=0
DATA_ARCHIVE=""
CA_FILE=""
HERE="$(cd "$(dirname "$0")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-kiosk) WITH_KIOSK=1; shift;;
    --data) DATA_ARCHIVE="$2"; shift 2;;
    --ca) CA_FILE="$2"; shift 2;;
    *) echo "option inconnue : $1"; exit 1;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Lance-moi en root : sudo bash install.sh"; exit 1; }
id "$KIOSK_USER" &>/dev/null || { echo "L'utilisateur $KIOSK_USER n'existe pas."; exit 1; }
echo "== Panda 1.0.2 → $DIR (user: $KIOSK_USER, port: $PORT) =="

# --- 1. Dépendances système --------------------------------------------------
echo "== [1/7] Paquets APT =="
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  python3 python3-venv python3-pip \
  network-manager bluez rfkill alsa-utils \
  wireplumber wlr-randr ddcutil libglib2.0-bin dbus \
  unzip curl ca-certificates
if [[ $WITH_KIOSK -eq 1 ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    chromium labwc squeekboard fonts-noto-color-emoji seatd
fi

# --- 2. Fichiers de l'application (préserve data/, addons/, secret.key) -----
echo "== [2/7] Fichiers vers $DIR =="
mkdir -p "$DIR"
cp "$HERE"/payload/app.py "$HERE"/payload/registry.py "$HERE"/payload/addon_backends.py \
   "$HERE"/payload/requirements.txt "$DIR"/
rm -rf "$DIR"/static.new "$DIR"/registry.new
cp -r "$HERE"/payload/static "$DIR"/static.new && rm -rf "$DIR"/static && mv "$DIR"/static.new "$DIR"/static
cp -r "$HERE"/payload/registry "$DIR"/registry.new && rm -rf "$DIR"/registry && mv "$DIR"/registry.new "$DIR"/registry
mkdir -p "$DIR"/data "$DIR"/addons

# --- 3. Restauration éventuelle des données ---------------------------------
if [[ -n "$DATA_ARCHIVE" ]]; then
  echo "== [3/7] Restauration de $DATA_ARCHIVE =="
  tar xzf "$DATA_ARCHIVE" -C "$DIR"    # contient data/, addons/, secret.key
else
  echo "== [3/7] Pas de restauration (installation vierge) =="
fi
chown -R "$KIOSK_USER":"$KIOSK_USER" "$DIR"
[[ -f "$DIR"/secret.key ]] && chmod 600 "$DIR"/secret.key || true

# --- 4. CA maison éventuelle -------------------------------------------------
if [[ -z "$CA_FILE" && -f "$HERE"/home-ca.crt ]]; then CA_FILE="$HERE"/home-ca.crt; fi
if [[ -n "$CA_FILE" ]]; then
  echo "== [4/7] CA → magasin système =="
  install -m 644 "$CA_FILE" /usr/local/share/ca-certificates/home-ca.crt
  update-ca-certificates >/dev/null
else
  echo "== [4/7] Pas de CA fournie (le Store Abeille en HTTPS maison en aura besoin) =="
fi

# --- 5. Environnement Python -------------------------------------------------
echo "== [5/7] venv + dépendances Python =="
[[ -d "$DIR"/venv ]] || sudo -u "$KIOSK_USER" python3 -m venv "$DIR"/venv
sudo -u "$KIOSK_USER" "$DIR"/venv/bin/pip install -q --upgrade pip
sudo -u "$KIOSK_USER" "$DIR"/venv/bin/pip install -q -r "$DIR"/requirements.txt

# --- 6. Sudoers + service systemd -------------------------------------------
echo "== [6/7] sudoers + panda.service =="
cat > /etc/sudoers.d/panda-kiosk <<EOF
# Commandes système pilotées par le kiosk Panda (heure, wifi, bluetooth, MAJ)
$KIOSK_USER ALL=(root) NOPASSWD: /usr/bin/timedatectl, /usr/bin/nmcli, /usr/sbin/rfkill, /usr/bin/rfkill, /usr/bin/bluetoothctl, /usr/bin/apt
EOF
chmod 440 /etc/sudoers.d/panda-kiosk
visudo -cf /etc/sudoers.d/panda-kiosk >/dev/null

cat > /etc/systemd/system/panda.service <<EOF
[Unit]
Description=Panda — kiosk domestique (Flask/gunicorn)
After=network-online.target
Wants=network-online.target

[Service]
User=$KIOSK_USER
WorkingDirectory=$DIR
Environment=REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
ExecStart=$DIR/venv/bin/gunicorn -k gthread --threads 8 -w 3 -b 0.0.0.0:$PORT app:app
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now panda
sleep 3

# --- 7. Session kiosk (écran) ------------------------------------------------
if [[ $WITH_KIOSK -eq 1 ]]; then
  echo "== [7/7] Session kiosk labwc + Chromium =="
  HOME_DIR=$(getent passwd "$KIOSK_USER" | cut -d: -f6)
  # autologin console sur tty1
  mkdir -p /etc/systemd/system/getty@tty1.service.d
  cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
  # lancement de labwc à l'ouverture de session tty1
  PROFILE="$HOME_DIR/.bash_profile"
  MARK="# panda-kiosk-autostart"
  grep -q "$MARK" "$PROFILE" 2>/dev/null || cat >> "$PROFILE" <<'EOF'
# panda-kiosk-autostart
if [[ -z "$WAYLAND_DISPLAY" && "$(tty)" == "/dev/tty1" ]]; then
  exec labwc
fi
EOF
  # autostart labwc : clavier virtuel + Chromium plein écran sur Panda
  mkdir -p "$HOME_DIR/.config/labwc"
  cat > "$HOME_DIR/.config/labwc/autostart" <<EOF
squeekboard &
chromium --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 \
  --ozone-platform=wayland http://127.0.0.1:$PORT &
EOF
  chown -R "$KIOSK_USER":"$KIOSK_USER" "$HOME_DIR/.config/labwc" 
  chown "$KIOSK_USER":"$KIOSK_USER" "$PROFILE"
  systemctl daemon-reload
  echo "   Session kiosk installée (autologin tty1 → labwc → Chromium)."
else
  echo "== [7/7] Session kiosk non demandée (--with-kiosk pour l'ajouter) =="
fi

# --- Contrôle final ----------------------------------------------------------
echo "== Contrôle =="
if curl -sf "http://127.0.0.1:$PORT/healthz"; then
  echo; echo "✅ Panda répond. Interface : http://$(hostname -I | awk '{print $1}'):$PORT"
  [[ $WITH_KIOSK -eq 1 ]] && echo "   Redémarre le Pi pour ouvrir la session écran : sudo reboot"
else
  echo "❌ /healthz ne répond pas — journalctl -u panda -n 50"
  exit 1
fi
