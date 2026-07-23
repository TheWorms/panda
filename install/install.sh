#!/usr/bin/env bash
# =============================================================================
#  Panda — installation kiosk sur Raspberry Pi (Debian 13 « trixie » / RPi OS)
#  Écran tactile HDMI 1024×600.
#
#  Modèle : le service `panda` sert l'app Flask (gunicorn) ; le service
#  `panda-kiosk` lance **labwc** (compositeur Wayland) sur tty1, qui démarre
#  Chromium en mode --app plein écran + Squeekboard (clavier tactile).
#
#  À exécuter SUR le Pi, avec VOTRE utilisateur (pas root ; sudo au besoin) :
#      bash install.sh
#
#  Options :
#      NO_KIOSK=1   -> service Flask seul (pas d'affichage)
#      NO_SPLASH=1  -> n'installe pas le thème Plymouth
#      NO_CLIP=1    -> n'installe pas wl-clip-persist (évite la toolchain Rust)
# =============================================================================
set -euo pipefail

APP=panda
DIR=/opt/$APP
PORT=8090
USER_NAME="$(id -un)"
UID_NUM="$(id -u)"
SRC="$(cd "$(dirname "$0")/.." && pwd)"     # racine du dépôt (install/ est dedans)
NO_KIOSK="${NO_KIOSK:-0}"
NO_SPLASH="${NO_SPLASH:-0}"
NO_CLIP="${NO_CLIP:-0}"

[[ "$USER_NAME" != "root" ]] || { echo "Lance-moi avec ton utilisateur normal, pas root."; exit 1; }
echo "==> Panda — installation (utilisateur : $USER_NAME, UID $UID_NUM)"

# --- 1. Dépendances système -------------------------------------------------
echo "==> Paquets système"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-pip curl locales \
  network-manager bluez rfkill \
  pipewire wireplumber pipewire-pulse alsa-utils \
  wlr-randr ca-certificates python3-cryptography
if [[ "$NO_KIOSK" != 1 ]]; then
  sudo apt-get install -y -qq labwc seatd squeekboard chromium \
    fonts-noto-color-emoji
  [[ "$NO_SPLASH" != 1 ]] && sudo apt-get install -y -qq plymouth plymouth-themes
fi

# Locale FR (interface + géoloc)
if ! locale -a 2>/dev/null | grep -qi "fr_FR.utf8"; then
  sudo sed -i 's/^# *fr_FR.UTF-8/fr_FR.UTF-8/' /etc/locale.gen
  sudo locale-gen
fi

# --- 2. Fichiers application (préserve data/, addons/, secret.key) ----------
echo "==> Application → $DIR"
sudo mkdir -p "$DIR"
sudo cp "$SRC"/app.py "$SRC"/registry.py "$SRC"/addon_backends.py "$SRC"/requirements.txt "$DIR"/
sudo rm -rf "$DIR"/static.new "$DIR"/registry.new
sudo cp -r "$SRC"/static "$DIR"/static.new && sudo rm -rf "$DIR"/static && sudo mv "$DIR"/static.new "$DIR"/static
sudo cp -r "$SRC"/registry "$DIR"/registry.new && sudo rm -rf "$DIR"/registry && sudo mv "$DIR"/registry.new "$DIR"/registry
sudo mkdir -p "$DIR"/data "$DIR"/addons
sudo chown -R "$USER_NAME":"$USER_NAME" "$DIR"

# --- 3. Environnement Python -----------------------------------------------
echo "==> venv + dépendances Python"
[[ -d "$DIR"/venv ]] || python3 -m venv "$DIR"/venv
"$DIR"/venv/bin/pip install -q --upgrade pip
"$DIR"/venv/bin/pip install -q -r "$DIR"/requirements.txt

# --- 4. Sudoers (commandes système pilotées par le kiosk) ------------------
echo "==> sudoers"
sudo tee /etc/sudoers.d/panda-system >/dev/null <<EOF
$USER_NAME ALL=(root) NOPASSWD: /usr/bin/nmcli, /usr/bin/bluetoothctl, /usr/sbin/rfkill, /usr/bin/timedatectl
EOF
sudo chmod 440 /etc/sudoers.d/panda-system
sudo visudo -cf /etc/sudoers.d/panda-system >/dev/null

# --- 4b. Outil de mise à jour signée (panda-update) ------------------------
# Idempotent, réutilisable seul via install/install-updater.sh.
echo "==> outil de mise à jour signée (panda-update)"
bash "$SRC/install/install-updater.sh"

# --- 5. Service Flask -------------------------------------------------------
echo "==> service panda (Flask/gunicorn)"
sudo tee /etc/systemd/system/panda.service >/dev/null <<EOF
[Unit]
Description=Panda (Flask)
After=network-online.target
Wants=network-online.target
[Service]
User=$USER_NAME
WorkingDirectory=$DIR
Environment=XDG_RUNTIME_DIR=/run/user/$UID_NUM
Environment=REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
ExecStart=$DIR/venv/bin/gunicorn -k gthread -w 2 --threads 12 -t 90 -b 0.0.0.0:$PORT app:app
Restart=on-failure
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now panda
sleep 3

if [[ "$NO_KIOSK" == 1 ]]; then
  echo "==> NO_KIOSK : service Flask seul."
  curl -fsS "http://127.0.0.1:$PORT/healthz" && echo " ✅ Panda répond sur :$PORT"
  exit 0
fi

# --- 6. Lanceur Chromium ----------------------------------------------------
echo "==> lanceur /usr/local/bin/panda-kiosk"
sudo tee /usr/local/bin/panda-kiosk >/dev/null <<'EOF'
#!/usr/bin/env bash
# Attend Flask, puis lance Chromium en mode --app maximisé (PAS --kiosk :
# nécessaire pour que Squeekboard s'affiche au-dessus et que la page se
# redimensionne quand le clavier apparaît).
set -u
BASE="http://127.0.0.1:8090"; URL="$BASE/?kiosk=1"
for i in $(seq 1 60); do curl -fsS -o /dev/null "$BASE/healthz" && break; sleep 1; done
P="$HOME/.config/panda-chromium"; mkdir -p "$P/Default"
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$P/Default/Preferences" 2>/dev/null || true
rm -rf "$P/Default/Cache" "$P/Default/Code Cache" "$P/GrShaderCache" "$HOME/.cache/chromium" 2>/dev/null || true
exec /usr/bin/chromium \
  --app="$URL" --start-maximized --ozone-platform=wayland --enable-wayland-ime \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --disable-features=TranslateUI,Translate --no-first-run --fast --fast-start \
  --disable-translate --lang=fr-FR --check-for-update-interval=31536000 \
  --disk-cache-size=1 --aggressive-cache-discard --user-data-dir="$P" \
  --touch-events=enabled --enable-features=OverlayScrollbar \
  --overscroll-history-navigation=0
EOF
sudo chmod +x /usr/local/bin/panda-kiosk

# --- 7. Configuration labwc -------------------------------------------------
echo "==> config labwc (~/.config/labwc)"
mkdir -p "$HOME/.config/labwc"
cat > "$HOME/.config/labwc/environment" <<EOF
XDG_RUNTIME_DIR=/run/user/$UID_NUM
WLR_DRM_NO_ATOMIC=1
XCURSOR_SIZE=1
EOF
cat > "$HOME/.config/labwc/rc.xml" <<'EOF'
<?xml version="1.0"?>
<labwc_config>
  <core><gap>0</gap><adaptiveSync>no</adaptiveSync></core>
  <theme><dropShadows>no</dropShadows><titlebar><layout></layout></titlebar></theme>
  <windowRules>
    <windowRule identifier="*" serverDecoration="no" skipTaskbar="yes">
      <action name="Maximize"/>
    </windowRule>
  </windowRules>
  <touch mapToOutput="HDMI-A-1"/>
</labwc_config>
EOF
# autostart : clavier + kiosk (+ presse-papier persistant si dispo)
{
  if [[ "$NO_CLIP" != 1 && -x "$HOME/.cargo/bin/wl-clip-persist" ]]; then
    echo "$HOME/.cargo/bin/wl-clip-persist --clipboard regular &"
  fi
  echo "squeekboard &"
  echo "/usr/local/bin/panda-kiosk &"
} > "$HOME/.config/labwc/autostart"

# --- 8. Splash Plymouth (optionnel) ----------------------------------------
if [[ "$NO_SPLASH" != 1 && -d "$SRC/splash-panda" ]]; then
  echo "==> thème Plymouth « panda »"
  sudo cp -r "$SRC/splash-panda" /usr/share/plymouth/themes/panda
  sudo plymouth-set-default-theme -R panda 2>/dev/null || sudo plymouth-set-default-theme panda || true
fi

# --- 9. Service kiosk (labwc sur tty1) -------------------------------------
echo "==> service panda-kiosk (labwc)"
sudo tee /etc/systemd/system/panda-kiosk.service >/dev/null <<EOF
[Unit]
Description=Panda kiosk (labwc + Chromium + clavier virtuel)
After=panda.service systemd-user-sessions.service
Wants=panda.service
Conflicts=getty@tty1.service
[Service]
User=$USER_NAME
TTYPath=/dev/tty1
PAMName=login
Environment=LANG=fr_FR.UTF-8
Environment=LANGUAGE=fr_FR
Environment=LC_ALL=fr_FR.UTF-8
Environment=XDG_RUNTIME_DIR=/run/user/$UID_NUM
ExecStart=/usr/bin/labwc
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable panda-kiosk
echo ""
echo "✅ Installation terminée. Redémarre pour lancer le kiosk : sudo reboot"
curl -fsS "http://127.0.0.1:$PORT/healthz" && echo " — Panda répond déjà sur :$PORT"
