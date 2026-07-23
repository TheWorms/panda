#!/usr/bin/env python3
"""build-release.py — construit et signe une release de code de Panda.

Produit, dans un dossier de sortie (défaut : ./dist), les trois fichiers à
publier comme *assets* d'une release GitHub :

    panda.zip          l'archive du code (ce que panda-update installe)
    release.json       {"version", "sha256", "archive"}
    release.json.sig   signature Ed25519 base64 de release.json

Usage :  python3 tools/build-release.py [--out dist] [racine_du_dépôt]
Clé privée : ~/ca/panda-release.key   (surchargeable : RELEASE_KEY=…)
             passphrase demandée, ou RELEASE_PASS=… (CI).

La version vient de APP_VERSION dans app.py — bumpe-la AVANT de construire.
La signature est vérifiée juste après écriture (autotest) : si ce script
affiche ✅, un kiosk portant la clé publique correspondante acceptera la release.

Après publication, crée une release GitHub taguée v<version> et attache les
trois fichiers ; panda-update les récupère via
https://github.com/TheWorms/panda/releases/latest/download/.
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import sys
import zipfile

from cryptography.hazmat.primitives import serialization

# Ensemble « code » d'une release : identique à CODE_PATHS de install/panda-update
# et à ce que déploie install/install.sh.
CODE_PATHS = ["app.py", "registry.py", "addon_backends.py",
              "requirements.txt", "static", "registry"]


def app_version(repo):
    with open(os.path.join(repo, "app.py"), encoding="utf-8") as fh:
        m = re.search(r'APP_VERSION = "([\d.]+)"', fh.read())
    if not m:
        sys.exit("ERREUR : APP_VERSION introuvable dans app.py")
    return m.group(1)


def build_zip(repo, zip_path):
    """Zippe les chemins « code » du dépôt, chemins relatifs à la racine, triés
    (archive déterministe : mêmes entrées → mêmes octets à métadonnées près)."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in CODE_PATHS:
            src = os.path.join(repo, rel)
            if not os.path.exists(src):
                sys.exit(f"ERREUR : {rel} introuvable dans {repo}")
            if os.path.isfile(src):
                zf.write(src, rel)
            else:
                for root, dirs, files in os.walk(src):
                    dirs.sort()
                    for name in sorted(files):
                        full = os.path.join(root, name)
                        if os.path.islink(full):
                            sys.exit(f"ERREUR : lien symbolique interdit dans l'archive : {full}")
                        arc = os.path.relpath(full, repo)
                        zf.write(full, arc)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().lower()


def main():
    ap = argparse.ArgumentParser(description="Construit et signe une release Panda.")
    ap.add_argument("repo", nargs="?", default=".", help="racine du dépôt (défaut : .)")
    ap.add_argument("--out", default="dist", help="dossier de sortie (défaut : dist)")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    outdir = os.path.abspath(args.out)
    os.makedirs(outdir, exist_ok=True)

    key_path = os.path.expanduser(os.environ.get("RELEASE_KEY", "~/ca/panda-release.key"))
    if not os.path.isfile(key_path):
        sys.exit(f"ERREUR : clé privée introuvable ({key_path}) — RELEASE_KEY=… pour un autre chemin")

    version = app_version(repo)
    zip_path = os.path.join(outdir, "panda.zip")
    print(f"→ construction de {zip_path} (version {version})")
    build_zip(repo, zip_path)
    digest = sha256_file(zip_path)
    print(f"  sha256 = {digest}")

    meta = {"version": version, "sha256": digest, "archive": "panda.zip"}
    meta_bytes = (json.dumps(meta, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    meta_path = os.path.join(outdir, "release.json")
    with open(meta_path, "wb") as fh:
        fh.write(meta_bytes)

    pw = os.environ.get("RELEASE_PASS") or getpass.getpass("Passphrase de la clé de signature : ")
    try:
        key = serialization.load_pem_private_key(open(key_path, "rb").read(), password=pw.encode())
    except ValueError:
        sys.exit("ERREUR : passphrase incorrecte (ou clé corrompue)")

    sig = key.sign(meta_bytes)
    sig_path = meta_path + ".sig"
    with open(sig_path, "w", encoding="utf-8") as fh:
        fh.write(base64.b64encode(sig).decode() + "\n")

    # autotest : la publique dérivée doit vérifier ce qu'on vient d'écrire
    key.public_key().verify(base64.b64decode(open(sig_path).read().strip()), meta_bytes)

    print(f"✅ release {version} construite et signée dans {outdir}/ :")
    print(f"     panda.zip  release.json  release.json.sig")
    print("\nÉtape suivante : crée une release GitHub taguée "
          f"v{version} et attache ces trois fichiers.")


if __name__ == "__main__":
    main()
