#!/usr/bin/env python3
"""insta-sync — synchronisation Instagram pour le kiosk Panda.

Lit la configuration de l'addon « instagram » dans /opt/panda/config.json
(champs : login, targets, media, path) et lance instaloader avec la session
importée. Conçu pour un déclenchement MANUEL (pas de timer) via :

    sudo systemctl start insta-sync.service      # suivi : journalctl -u insta-sync -f

Traductions :
  targets  :saved    -> cible « :saved »,  dossier « <path>/saved »
           :profile  -> cible « <login> », dossier « <path>/<login> »
  media    all       -> photos + vidéos
           photos    -> --no-videos
           videos    -> --post-filter is_video (ne garde que les posts vidéo)

« Seulement les nouvelles » = --fast-update (instaloader s'arrête au 1er média
déjà présent).

Usage :
    insta-sync.py [--dry-run]   # --dry-run : affiche la commande sans l'exécuter
"""
import json
import os
import subprocess
import sys

CONFIG = "/opt/panda/config.json"
INSTALOADER = os.path.expanduser("~/.local/bin/instaloader")


def main():
    dry = "--dry-run" in sys.argv[1:]

    try:
        with open(CONFIG, encoding="utf-8") as f:
            mod = json.load(f).get("modules", {}).get("instagram", {})
    except (OSError, ValueError) as e:
        sys.exit(f"config illisible : {e}")

    login = (mod.get("login") or "").strip()
    targets = (mod.get("targets") or ":saved").strip()
    media = (mod.get("media") or "all").strip()
    path = os.path.expanduser((mod.get("path") or "~/instagram").rstrip("/"))

    if not login:
        sys.exit("aucun identifiant configuré (⚙ Instagram → « Identifiant »)")

    session = os.path.expanduser(f"~/.config/instaloader/session-{login}")
    if not os.path.exists(session):
        sys.exit(f"session absente : {session}\n"
                 f"  génère-la d'abord (import depuis le navigateur).")

    os.makedirs(path, exist_ok=True)

    # cible + nom de dossier propre
    if targets == ":saved":
        target, dirname = ":saved", "saved"
    elif targets == ":profile":
        target, dirname = login, login
    else:                                   # cible libre (profil public)
        target, dirname = targets, targets.lstrip(":").replace("/", "_")

    args = [INSTALOADER,
            "--sessionfile", session,
            "--login", login,
            "--dirname-pattern", os.path.join(path, dirname),
            "--fast-update",                 # seulement les nouvelles
            "--quiet"]

    if media == "photos":
        # pas de vidéos → inutile de récupérer leurs vignettes
        args += ["--no-videos", "--no-video-thumbnails"]
    elif media == "videos":
        # vidéos seules, MAIS on garde l'image de couverture pour l'aperçu
        args += ["--post-filter", "is_video"]
    # media == "all" : photos + vidéos + vignettes (aperçus assurés)

    args.append(target)

    print("cible      :", target)
    print("dossier    :", os.path.join(path, dirname))
    print("médias     :", media)
    print("commande   :", " ".join(args))

    if dry:
        print("[dry-run] rien n'a été exécuté.")
        return 0

    print("--- instaloader ---", flush=True)
    return subprocess.run(args).returncode


if __name__ == "__main__":
    sys.exit(main())
