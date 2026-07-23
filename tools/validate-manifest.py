#!/usr/bin/env python3
"""validate-manifest.py — validateur officiel de manifeste d'addon Panda.

Utilisé à deux endroits :
  - côté Store (Gypaete) : à la publication, via publish-addon.sh
  - côté noyau (Panda)   : revalidation à l'installation (le noyau est le
    dernier rempart, il ne fait jamais confiance au dépôt)

Usage :
  validate-manifest.py <dossier-addon>            # valide un addon
  validate-manifest.py --all <dossier-registry>   # valide tous les addons
  validate-manifest.py --store <dossier-addon>    # mode publication (plus strict)

Codes de sortie : 0 = OK, 1 = au moins une erreur.

Le mode --store ajoute les règles propres à la publication :
  - type "internal" refusé (hors périmètre Store)
  - permissions.network obligatoire si type "code"
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Contrat noyau (doit rester aligné avec registry.py)
KIOSK_API_MAJOR = 1
KIOSK_API_MINOR = 3

# Catégories figées de l'écran Applications (doit rester aligné avec registry.py).
CATEGORIES = ("Maison", "Quotidien", "Services", "Médias", "Outils")

REQUIRED_FIELDS = ("manifest_version", "id", "name", "version", "kiosk_api", "type", "tiles")
VALID_TYPES = ("code", "declarative", "internal")

RE_ID = re.compile(r"^[a-z][a-z0-9_-]*$")
RE_VERSION = re.compile(r"^\d+\.\d+\.\d+$")
RE_KIOSK_API = re.compile(r"^\^(\d+)\.(\d+)$")


def validate_addon(addon_dir: Path, store_mode: bool = False):
    """Valide un dossier d'addon. Retourne (erreurs, avertissements)."""
    errors, warnings = [], []

    if not addon_dir.is_dir():
        return [f"dossier introuvable : {addon_dir}"], warnings

    manifest_path = addon_dir / "manifest.json"
    if not manifest_path.is_file():
        return ["manifest.json absent"], warnings

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"manifest.json invalide (JSON) : ligne {e.lineno}, {e.msg}"], warnings

    if not isinstance(manifest, dict):
        return ["manifest.json doit être un objet JSON"], warnings

    # Champs obligatoires
    for field in REQUIRED_FIELDS:
        if field not in manifest:
            errors.append(f"champ obligatoire manquant : {field}")
    if errors:
        return errors, warnings  # inutile d'aller plus loin sans les champs de base

    # id : format + cohérence avec le nom du dossier
    addon_id = manifest["id"]
    if not isinstance(addon_id, str) or not RE_ID.match(addon_id):
        errors.append(f"id invalide : {addon_id!r} (attendu : minuscules, chiffres, - ou _)")
    elif addon_id != addon_dir.name:
        errors.append(f"id ({addon_id!r}) ≠ nom du dossier ({addon_dir.name!r})")

    # name
    if not isinstance(manifest["name"], str) or not manifest["name"].strip():
        errors.append("name doit être une chaîne non vide")

    # version : semver strict X.Y.Z
    version = manifest["version"]
    if not isinstance(version, str) or not RE_VERSION.match(version):
        errors.append(f"version invalide : {version!r} (attendu : X.Y.Z)")

    # kiosk_api : format ^MAJOR.MINOR + compatibilité avec ce noyau
    kiosk_api = manifest["kiosk_api"]
    m = RE_KIOSK_API.match(kiosk_api) if isinstance(kiosk_api, str) else None
    if not m:
        errors.append(f"kiosk_api invalide : {kiosk_api!r} (attendu : ^MAJOR.MINOR, ex. ^1.2)")
    else:
        major, minor = int(m.group(1)), int(m.group(2))
        if major != KIOSK_API_MAJOR:
            errors.append(
                f"kiosk_api ^{major}.{minor} incompatible avec ce noyau "
                f"({KIOSK_API_MAJOR}.{KIOSK_API_MINOR}) : majeure différente"
            )
        elif minor > KIOSK_API_MINOR:
            errors.append(
                f"kiosk_api ^{major}.{minor} trop récent pour ce noyau "
                f"({KIOSK_API_MAJOR}.{KIOSK_API_MINOR})"
            )

    # type
    addon_type = manifest["type"]
    if addon_type not in VALID_TYPES:
        errors.append(f"type invalide : {addon_type!r} (attendu : {', '.join(VALID_TYPES)})")

    # tiles : liste d'objets — vide autorisé (addon sans tuile, ex. corbeille)
    tiles = manifest["tiles"]
    if not isinstance(tiles, list):
        errors.append("tiles doit être une liste")
    elif not all(isinstance(t, dict) for t in tiles):
        errors.append("chaque élément de tiles doit être un objet")
    elif not tiles:
        warnings.append("tiles vide (addon sans tuile)")
    else:
        # name/icon sont déréférencés sans repli par le noyau (registry.tiles) :
        # une tuile sans eux fait tomber tout /api/registry (KeyError).
        for t in tiles:
            if not t.get("name") or not t.get("icon"):
                errors.append("tiles : chaque tuile doit porter `name` et `icon`")
                break

    # category (optionnel) : si présent, doit appartenir à la liste figée
    cat = manifest.get("category")
    if cat is not None and cat not in CATEGORIES:
        errors.append(f"category « {cat} » hors liste : {', '.join(CATEGORIES)}")

    # Règles spécifiques au type "code"
    # NB : backend.py n'est PAS obligatoire — un addon "code" peut être
    # front-only (ex. calculatrice, jeux). Le noyau le tolère.
    if addon_type == "code":
        if not (addon_dir / "backend.py").is_file():
            warnings.append("type 'code' sans backend.py (addon front-only)")
        permissions = manifest.get("permissions")
        has_network = isinstance(permissions, dict) and "network" in permissions
        if not has_network:
            msg = "type 'code' : permissions.network non déclaré"
            if store_mode:
                errors.append(msg + " (obligatoire à la publication)")
            else:
                warnings.append(msg)

    # Règles spécifiques au type "declarative" : le bloc declarative est
    # obligatoire et doit porter au moins une requête (request/requests) —
    # sinon l'addon casse au premier tap (KeyError côté noyau).
    if addon_type == "declarative":
        decl = manifest.get("declarative")
        if not isinstance(decl, dict):
            errors.append("type 'declarative' : bloc 'declarative' manquant ou invalide")
        else:
            if not decl.get("request") and not decl.get("requests"):
                errors.append("type 'declarative' : 'declarative.request' (ou 'requests') requis")
            if "view" not in decl:
                errors.append("type 'declarative' : 'declarative.view' requis")

    # Règles spécifiques au mode publication
    if store_mode and addon_type == "internal":
        errors.append("type 'internal' : hors périmètre Store, publication refusée")

    return errors, warnings


def report(addon_dir: Path, errors, warnings) -> bool:
    """Affiche le résultat pour un addon. Retourne True si valide."""
    if errors:
        print(f"✗ {addon_dir.name}")
        for e in errors:
            print(f"    ERREUR : {e}")
    else:
        print(f"✓ {addon_dir.name}")
    for w in warnings:
        print(f"    attention : {w}")
    return not errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validateur de manifeste d'addon Panda")
    parser.add_argument("path", type=Path, help="dossier d'addon, ou registry/ avec --all")
    parser.add_argument("--all", action="store_true", help="valider tous les addons du dossier")
    parser.add_argument("--store", action="store_true", help="mode publication (plus strict)")
    args = parser.parse_args()

    if args.all:
        if not args.path.is_dir():
            print(f"ERREUR : dossier introuvable : {args.path}", file=sys.stderr)
            return 1
        addon_dirs = sorted(
            d for d in args.path.iterdir() if d.is_dir() and not d.name.startswith((".", "_"))
        )
        if not addon_dirs:
            print(f"ERREUR : aucun addon dans {args.path}", file=sys.stderr)
            return 1
        ok = True
        for d in addon_dirs:
            errors, warnings = validate_addon(d, store_mode=args.store)
            ok = report(d, errors, warnings) and ok
        return 0 if ok else 1

    errors, warnings = validate_addon(args.path, store_mode=args.store)
    return 0 if report(args.path, errors, warnings) else 1


if __name__ == "__main__":
    sys.exit(main())
