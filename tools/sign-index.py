#!/usr/bin/env python3
"""sign-index.py — signe un index.json du store Abeille (Ed25519).

Usage :  python3 sign-index.py <chemin/index.json>
Clé privée : ~/ca/abeille-signing.key (surchargeable : SIGNING_KEY=…)
Produit    : <chemin/index.json>.sig  (signature base64 des octets du fichier)

La signature est vérifiée immédiatement après écriture (autotest) : si ce
script dit ✅, un kiosk avec la clé publique correspondante acceptera l'index.
"""
import base64, getpass, os, sys
from cryptography.hazmat.primitives import serialization

if len(sys.argv) != 2:
    sys.exit("usage : sign-index.py <chemin/index.json>")
index_path = sys.argv[1]
if not os.path.isfile(index_path):
    sys.exit(f"ERREUR : {index_path} introuvable")
key_path = os.path.expanduser(os.environ.get("SIGNING_KEY", "~/ca/abeille-signing.key"))
if not os.path.isfile(key_path):
    sys.exit(f"ERREUR : clé privée introuvable ({key_path}) — SIGNING_KEY=… pour un autre chemin")

pw = os.environ.get("SIGNING_PASS") or getpass.getpass("Passphrase de la clé de signature : ")
try:
    key = serialization.load_pem_private_key(open(key_path, "rb").read(), password=pw.encode())
except ValueError:
    sys.exit("ERREUR : passphrase incorrecte (ou clé corrompue)")

blob = open(index_path, "rb").read()
sig = key.sign(blob)
sig_path = index_path + ".sig"
with open(sig_path, "w", encoding="utf-8") as fh:
    fh.write(base64.b64encode(sig).decode() + "\n")

# autotest : la publique dérivée doit vérifier ce qu'on vient d'écrire
key.public_key().verify(base64.b64decode(open(sig_path).read().strip()), blob)
print(f"✅ signé : {sig_path}")
