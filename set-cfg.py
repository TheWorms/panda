#!/usr/bin/env python3
"""set-cfg.py — injecte une valeur dans la config d'un addon Panda.

Écrit /opt/panda/config.json de façon ATOMIQUE (tmp + os.replace, jamais de
sed -i, préserve tout le reste du fichier). La valeur est saisie en invisible
(getpass) : colle ton token dans le terminal, il n'apparaît ni à l'écran ni
dans l'historique shell. config.json est relu à chaud par le service — pas de
redémarrage nécessaire.

Usage (depuis Gypaete, tty requis pour la saisie → « ssh -t ») :
  ssh -t user@panda.local 'python3 ~/set-cfg.py <addon>'            # affiche la config du module (secrets masqués)
  ssh -t user@panda.local 'python3 ~/set-cfg.py <addon> <clé>'     # saisie masquée (token/clé)
  ssh -t user@panda.local 'python3 ~/set-cfg.py <addon> <clé> -s'  # saisie visible (url, ville…)
  ssh -t user@panda.local 'python3 ~/set-cfg.py <addon> <clé> --del'  # supprime la clé
"""
import getpass
import json
import os
import shutil
import sys
import tempfile

CONFIG = "/opt/panda/config.json"


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
            shutil.copymode(CONFIG, tmp)   # préserve les permissions d'origine
        except OSError:
            pass
        os.replace(tmp, CONFIG)            # bascule atomique
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _mask(k, v):
    s = str(v)
    if any(x in k.lower() for x in ("token", "key", "pass", "secret")):
        return (s[:4] + "…" + s[-4:]) if len(s) > 8 else "***"
    return s


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit("usage: set-cfg.py <addon> [<clé> [-s | --del]]")
    addon = args[0]
    d = _load()
    mods = d.setdefault("modules", {})

    # aucun 2e argument : afficher la config actuelle du module (secrets masqués)
    if len(args) == 1:
        cur = mods.get(addon)
        if not cur:
            print(f"(aucune config pour « {addon} »)")
            return
        for k, v in cur.items():
            print(f"  {addon}.{k} = {_mask(k, v)}")
        return

    key = args[1]
    flags = args[2:]

    if "--del" in flags:
        if mods.get(addon, {}).pop(key, None) is None:
            print(f"(rien à supprimer : {addon}.{key} absent)")
            return
        _save(d)
        print(f"✓ {addon}.{key} supprimé. Pris en compte à chaud.")
        return

    prompt = f"valeur pour {addon}.{key} : "
    if "-s" in flags or "--show" in flags:
        val = input(prompt).strip()
    else:
        val = getpass.getpass(prompt + "(collez, invisible) ").strip()
    if not val:
        sys.exit("valeur vide — abandon (rien écrit).")

    mods.setdefault(addon, {})[key] = val
    _save(d)
    print(f"✓ {addon}.{key} enregistré ({len(val)} caractère·s). "
          f"Relu à chaud, pas de redémarrage.")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError:
        sys.exit(f"introuvable : {CONFIG}")
    except PermissionError:
        sys.exit(f"permission refusée sur {CONFIG} — relance en sudo si besoin.")
