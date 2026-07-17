#!/usr/bin/env python3
"""gen-store-keys.py — génère la paire de clés Ed25519 de signature du store.

La clé PRIVÉE (chiffrée par passphrase) ne quitte JAMAIS le poste d'admin.
La clé PUBLIQUE est embarquée dans Panda : c'est elle qui vérifie.

Usage :  python3 gen-store-keys.py [dossier]     (défaut : ~/ca)
Produit :  abeille-signing.key  (privée, chiffrée, 600)
           abeille-signing.pub  (publique, base64, à commiter dans panda)
"""
import base64, getpass, os, stat, sys
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

outdir = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/ca")
os.makedirs(outdir, exist_ok=True)
priv_path = os.path.join(outdir, "abeille-signing.key")
pub_path = os.path.join(outdir, "abeille-signing.pub")

for p in (priv_path, pub_path):
    if os.path.exists(p):
        sys.exit(f"REFUS : {p} existe déjà — je n'écrase jamais une clé de signature.\n"
                 f"Si tu veux VRAIMENT régénérer (les kiosks devront recevoir la\n"
                 f"nouvelle clé publique), supprime les fichiers d'abord.")

pw1 = getpass.getpass("Passphrase de la clé privée : ")
pw2 = getpass.getpass("Confirme la passphrase      : ")
if pw1 != pw2:
    sys.exit("Les deux saisies diffèrent — rien n'a été créé.")
if len(pw1) < 8:
    sys.exit("Passphrase trop courte (8 caractères minimum) — rien n'a été créé.")

key = Ed25519PrivateKey.generate()
priv_pem = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.BestAvailableEncryption(pw1.encode()),
)
pub_raw = key.public_key().public_bytes(
    serialization.Encoding.Raw, serialization.PublicFormat.Raw
)
pub_b64 = base64.b64encode(pub_raw).decode()

with open(priv_path, "wb") as fh:
    fh.write(priv_pem)
os.chmod(priv_path, stat.S_IRUSR | stat.S_IWUSR)  # 600
with open(pub_path, "w", encoding="utf-8") as fh:
    fh.write(pub_b64 + "\n")

print(f"✅ clé privée  : {priv_path}  (chiffrée, 600 — NE JAMAIS copier ailleurs)")
print(f"✅ clé publique : {pub_path}")
print(f"   contenu (à embarquer dans panda) : {pub_b64}")
print("\n⚠️  SAUVEGARDE : si cette clé privée est perdue, plus aucune publication")
print("   ne pourra être signée — les kiosks en mode strict refuseront tout.")
print("   Range une copie chiffrée hors de Gypaete (ex. gestionnaire de mots de passe).")
