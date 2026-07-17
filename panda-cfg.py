#!/usr/bin/env python3
"""panda-cfg.py — menu interactif de configuration des addons Panda.

Une seule commande depuis Gypaete (tty requis pour la saisie masquée) :

    ssh -t user@panda.local 'python3 ~/panda-cfg.py'

Découvre les addons configurables depuis leurs manifestes
(/opt/panda/registry/<id>/manifest.json), affiche un menu, et écrit
/opt/panda/config.json de façon ATOMIQUE (jamais de sed -i, tout le reste du
fichier préservé). Les champs sensibles (token/clé/mot de passe) sont saisis
en invisible : colle ta valeur dans le terminal, elle n'apparaît pas.
config.json est relu à chaud par le service — aucun redémarrage.

Cuisine / KitchenOwl (Marmotte) : les 5 addons stock/congelateur/courses/
recettes/repas partagent la même connexion. Renseigne url/token/household
dans UN seul d'entre eux ; les autres suivent.
"""
import getpass
import json
import os
import shutil
import sys
import tempfile

CONFIG = os.environ.get("PANDA_CONFIG", "/opt/panda/config.json")
REGISTRY = os.environ.get("KIOSK_REGISTRY_DIR", "/opt/panda/registry")

SECRET_HINT = ("token", "key", "pass", "secret")


def _is_secret(field):
    return field.get("type") == "password" or any(
        h in field.get("key", "").lower() for h in SECRET_HINT)


def _load():
    with open(CONFIG, encoding="utf-8") as fh:
        return json.load(fh)


def _save(d):
    dirn = os.path.dirname(CONFIG) or "."
    fd, tmp = tempfile.mkstemp(dir=dirn, prefix=".cfg-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False, indent=2)
        try:
            shutil.copymode(CONFIG, tmp)
        except OSError:
            pass
        os.replace(tmp, CONFIG)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _discover():
    """Retourne [(id, name, [fields])] des addons ayant une config, triés."""
    out = []
    if not os.path.isdir(REGISTRY):
        return out
    for aid in sorted(os.listdir(REGISTRY)):
        mp = os.path.join(REGISTRY, aid, "manifest.json")
        if not os.path.isfile(mp):
            continue
        try:
            with open(mp, encoding="utf-8") as fh:
                m = json.load(fh)
        except (OSError, ValueError):
            continue
        fields = (m.get("config") or {}).get("fields") or []
        if fields:
            out.append((m["id"], m.get("name", m["id"]), fields))
    return out


def _fmt_value(field, cfg):
    """Valeur actuelle pour l'affichage (secrets masqués)."""
    k = field["key"]
    if k not in cfg:
        return "—"
    v = cfg[k]
    if _is_secret(field):
        s = str(v)
        return (s[:4] + "…" + s[-4:]) if len(s) > 8 else "défini"
    if field.get("type") == "toggle":
        return "oui" if (v is not False and v != "false") else "non"
    return str(v)


def _ask_value(field):
    """Saisit une nouvelle valeur selon le type. Retourne (set?, value)."""
    k, ftype = field["key"], field.get("type", "text")
    label = field.get("label", k)

    if ftype == "toggle":
        r = input(f"  {label} — activer ? [o/n, Entrée=annuler] : ").strip().lower()
        if r in ("o", "oui", "y", "yes"):
            return True, True
        if r in ("n", "non", "no"):
            return True, False
        return False, None

    if ftype == "select":
        opts = field.get("options", [])
        for i, o in enumerate(opts, 1):
            print(f"      {i}) {o[1] if isinstance(o, (list, tuple)) else o}")
        r = input("  choix [numéro, Entrée=annuler] : ").strip()
        if not r.isdigit() or not (1 <= int(r) <= len(opts)):
            return False, None
        o = opts[int(r) - 1]
        return True, (o[0] if isinstance(o, (list, tuple)) else o)

    prompt = f"  {label} "
    if _is_secret(field):
        val = getpass.getpass(prompt + "(collez, invisible ; Entrée=annuler) : ").strip()
    else:
        ph = field.get("placeholder")
        val = input(prompt + (f"[ex. {ph}] " if ph else "") + "(Entrée=annuler) : ").strip()
    if not val:
        return False, None
    return True, val


def _edit_addon(aid, name, fields):
    while True:
        d = _load()
        cfg = d.get("modules", {}).get(aid, {})
        print(f"\n─── {name} ({aid}) ───")
        for i, f in enumerate(fields, 1):
            lock = " 🔒" if _is_secret(f) else ""
            print(f"  {i}) {f.get('label', f['key'])}{lock} = {_fmt_value(f, cfg)}")
        print("  s) supprimer une clé    r) retour")
        c = input("Champ à modifier : ").strip().lower()
        if c in ("r", ""):
            return
        if c == "s":
            n = input("  numéro de la clé à supprimer : ").strip()
            if n.isdigit() and 1 <= int(n) <= len(fields):
                key = fields[int(n) - 1]["key"]
                d.setdefault("modules", {}).setdefault(aid, {}).pop(key, None)
                _save(d)
                print(f"  ✓ {aid}.{key} supprimé.")
            continue
        if not c.isdigit() or not (1 <= int(c) <= len(fields)):
            print("  (choix invalide)")
            continue
        field = fields[int(c) - 1]
        do, val = _ask_value(field)
        if not do:
            print("  (annulé)")
            continue
        d.setdefault("modules", {}).setdefault(aid, {})[field["key"]] = val
        _save(d)
        shown = _fmt_value(field, {field["key"]: val})
        print(f"  ✓ {aid}.{field['key']} = {shown}  (relu à chaud)")


def main():
    addons = _discover()
    if not addons:
        sys.exit(f"aucun addon configurable trouvé dans {REGISTRY}")
    while True:
        print("\n════════ Configuration des addons Panda ════════")
        for i, (aid, name, fields) in enumerate(addons, 1):
            print(f"  {i:2}) {name}  ({aid})")
        print("   q) quitter")
        c = input("Addon à configurer : ").strip().lower()
        if c in ("q", "quit", "quitter"):
            print("À bientôt.")
            return
        if not c.isdigit() or not (1 <= int(c) <= len(addons)):
            print("(choix invalide)")
            continue
        aid, name, fields = addons[int(c) - 1]
        _edit_addon(aid, name, fields)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\ninterrompu.")
    except FileNotFoundError:
        sys.exit(f"introuvable : {CONFIG}")
    except PermissionError:
        sys.exit(f"permission refusée sur {CONFIG} — relance en sudo si besoin.")
