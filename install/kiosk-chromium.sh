#!/usr/bin/env bash
# Lance Chromium en mode kiosk plein écran sur l'interface.
# À utiliser quand un bureau/écran est présent (Panda, ou VM 703 avec X).
# Sur la 703 en test, tu peux simplement ouvrir l'URL dans un navigateur
# et redimensionner la fenêtre à 1024x600.
URL="${1:-http://panda.local:8090}"
exec chromium --kiosk --incognito --noerrdialogs --disable-infobars \
  --window-size=1024,600 --window-position=0,0 \
  --check-for-update-interval=31536000 "${URL}"
