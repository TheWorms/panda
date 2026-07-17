"""Addon « corbeille » — fournisseur de service (lot E).

Service *headless* (aucune tuile) : il n'expose pas de routes HTTP mais une
API Python via ``provide(sdk)``, consommée par d'autres addons déclarant
``requires: ["corbeille"]`` puis appelant ``sdk.use("corbeille")``.

Modèle de stockage : une entrée = un fichier JSON horodaté sous
``data_dir/<source>/<id>.json``. Le champ ``source`` isole les usages
(``recettes``, ``instagram``, …) dans la même corbeille sans les mélanger.
Le ``data_dir`` est celui de la corbeille (le service stocke chez lui),
pas celui du consommateur — c'est le SDK de la corbeille qui est capturé ici.

API publique (objet retourné par provide) :
    put(source, id, payload)   -> dict entrée créée
    list(source=None)          -> [entrées] (toutes ou d'une source)
    get(source, id)            -> entrée | None
    restore(source, id)        -> payload (et retire l'entrée)
    purge(source=None)         -> nombre d'entrées supprimées
"""
import json
import os
import re
import time


_SAFE = re.compile(r"[^A-Za-z0-9._-]")


def _slug(s):
    """Composant de chemin sûr (jamais de séparateur ni de « .. »)."""
    s = _SAFE.sub("_", str(s))
    return s or "_"


class TrashAPI:
    """API publique de la corbeille. Capture le SDK de la corbeille : toutes
    les écritures vont dans SON data_dir, jamais dans celui du consommateur."""

    def __init__(self, sdk):
        self._sdk = sdk

    def _root(self, source):
        d = os.path.join(self._sdk.data_dir, _slug(source))
        os.makedirs(d, mode=0o700, exist_ok=True)
        return d

    def put(self, source, id, payload):
        """Dépose ``payload`` (JSON-sérialisable) sous (source, id)."""
        entry = {"source": str(source), "id": str(id),
                 "deleted_at": time.time(), "payload": payload}
        p = os.path.join(self._root(source), _slug(id) + ".json")
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(entry, fh, ensure_ascii=False)
        os.replace(tmp, p)   # écriture atomique
        self._sdk.log.info("corbeille: %s/%s déposé", source, id)
        return entry

    def get(self, source, id):
        p = os.path.join(self._root(source), _slug(id) + ".json")
        if not os.path.isfile(p):
            return None
        try:
            with open(p, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def list(self, source=None):
        base = self._sdk.data_dir
        if not os.path.isdir(base):
            return []
        sources = [_slug(source)] if source else sorted(os.listdir(base))
        out = []
        for src in sources:
            d = os.path.join(base, src)
            if not os.path.isdir(d):
                continue
            for f in sorted(os.listdir(d), reverse=True):
                if not f.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(d, f), encoding="utf-8") as fh:
                        out.append(json.load(fh))
                except (OSError, ValueError):
                    continue
        out.sort(key=lambda e: e.get("deleted_at", 0), reverse=True)
        return out

    def restore(self, source, id):
        """Retourne le payload et retire l'entrée de la corbeille."""
        p = os.path.join(self._root(source), _slug(id) + ".json")
        if not os.path.isfile(p):
            return None
        try:
            with open(p, encoding="utf-8") as fh:
                entry = json.load(fh)
        except (OSError, ValueError):
            return None
        try:
            os.remove(p)
        except OSError:
            pass
        self._sdk.log.info("corbeille: %s/%s restauré", source, id)
        return entry.get("payload")

    def purge(self, source=None):
        """Vide la corbeille (d'une source ou entière). Retourne le compte."""
        n = 0
        for e in self.list(source):
            p = os.path.join(self._root(e.get("source")),
                             _slug(e.get("id")) + ".json")
            try:
                os.remove(p)
                n += 1
            except OSError:
                pass
        return n


def provide(sdk):
    """Point d'entrée fournisseur (lot E) : rend l'API publique de la corbeille."""
    return TrashAPI(sdk)
