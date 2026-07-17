"""Registre d'addons du kiosk Panda — phase 1.

Source de vérité unique : un dossier de manifestes (``registry/`` tant que le
code des addons vit dans le noyau, ``/opt/panda/addons/`` à partir
de la phase 2). Ce module remplace les listes en dur ``ADDON_IDS`` et
``DEFAULT_CONFIG`` de ``app.py``, et fournit au frontend le catalogue que
``ADDONS[]`` contenait.

Un manifeste invalide est écarté et journalisé ; le kiosk démarre quand même.
"""
import json
import logging
import os

log = logging.getLogger("kiosk.registry")

KIOSK_API_MAJOR = 1
# 1.3 — gel du contrat SDK v1 (Phase 3). Le SDK frontend (render/configPanel/
# background/unmount + api/toast/openService/ic/esc/rel/session/delMode/config/
# store/vk/open/notify) est figé : évolutions additives uniquement, chaque ajout
# incrémente cette mineure. Un helper publié ne change plus jamais de signature.
KIOSK_API_MINOR = 3

# Catégories figées de l'écran Applications. Un addon peut déclarer
# `category` (optionnel) ; s'il le fait, la valeur doit être l'une de
# celles-ci. Liste canonique partagée avec tools/validate-manifest.py.
CATEGORIES = ("Maison", "Quotidien", "Services", "Médias", "Outils")

# Sections de paramètres appartenant au noyau — jamais des addons.
CORE_SECTIONS = {"wifi", "bluetooth", "maj"}

_HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY_DIR = os.environ.get("KIOSK_REGISTRY_DIR",
                              os.path.join(_HERE, "registry"))
# lot E : racine des répertoires persistants par addon (sdk.data_dir). Hors du
# dossier registry/, pour survivre au redéploiement du code (unzip -o).
DATA_DIR = os.environ.get("KIOSK_DATA_DIR", "/opt/panda/data")
# Store Abeille : les addons installés à distance vivent ici, hors de registry/
# (le socle) pour survivre au redéploiement du code. Un addon présent dans les
# deux racines l'emporte depuis ce dossier — le store gagne.
ADDONS_DIR = os.environ.get("KIOSK_ADDONS_DIR", "/opt/panda/addons")


def _validate(manifest, folder):
    """Contrôles du contrat, identiques à tools/validate-manifest.py.

    Retourne une liste d'erreurs (vide = valide). On revalide ici plutôt que
    de faire confiance au dépôt : le noyau est le dernier rempart.
    """
    errs = []
    for k in ("manifest_version", "id", "name", "version", "kiosk_api",
              "type", "tiles"):
        if k not in manifest:
            errs.append(f"champ obligatoire manquant : {k}")
    if errs:
        return errs

    if manifest["id"] != os.path.basename(os.path.normpath(folder)):
        errs.append(f"id « {manifest['id']} » ≠ nom du dossier")

    try:
        major, minor = manifest["kiosk_api"].lstrip("^").split(".")
        if int(major) != KIOSK_API_MAJOR:
            errs.append(f"kiosk_api {manifest['kiosk_api']} : majeure incompatible")
        elif int(minor) > KIOSK_API_MINOR:
            errs.append(f"kiosk_api {manifest['kiosk_api']} : mineure trop récente")
    except (ValueError, AttributeError):
        errs.append(f"kiosk_api illisible : {manifest.get('kiosk_api')!r}")

    tiles = manifest["tiles"]
    if not isinstance(tiles, list):
        errs.append("tiles doit être une liste")
        return errs
    # lot E : un addon `headless` (service invisible, ex. corbeille) n'a pas de
    # tuile. Sinon la contrainte historique s'applique : au moins une tuile.
    if not tiles and not manifest.get("headless"):
        errs.append("tiles doit être une liste non vide (sauf headless)")
        return errs
    if len(tiles) > 1 and any(not t.get("id") for t in tiles):
        errs.append("tiles : id explicite obligatoire dès qu'il y en a plusieurs")
    ids = [t.get("id") or manifest["id"] for t in tiles]
    if len(ids) != len(set(ids)):
        errs.append("tiles : identifiants en double")

    req = manifest.get("requires")
    if req is not None and (not isinstance(req, list)
                            or any(not isinstance(x, str) for x in req)):
        errs.append("requires doit être une liste d'identifiants (str)")

    cat = manifest.get("category")
    if cat is not None and cat not in CATEGORIES:
        errs.append(f"category « {cat} » hors liste : {', '.join(CATEGORIES)}")

    if manifest["type"] == "internal":
        for k in ("backend", "ui", "declarative"):
            if k in manifest:
                errs.append(f"type internal : `{k}` interdit (code dans le noyau)")

    if manifest["type"] == "code":
        ui = manifest.get("ui")
        backend = manifest.get("backend")
        if not ui and not backend:
            errs.append("type code : `ui` ou `backend` requis")
        if backend:
            entry = backend.get("entry", "")
            if not entry.endswith(".py"):
                errs.append(f"backend.entry invalide : {entry!r}")
            elif not os.path.isfile(os.path.join(folder, entry)):
                errs.append(f"backend.entry : fichier absent « {entry} »")
        if ui:
            entry = ui.get("entry", "")
            if not entry.endswith(".js"):
                errs.append(f"ui.entry invalide : {entry!r}")
            elif not os.path.isfile(os.path.join(folder, entry)):
                errs.append(f"ui.entry : fichier absent « {entry} »")

    # type declarative : bloc `declarative` obligatoire avec au moins une
    # requête — sinon _decl_exec lève KeyError au premier tap sur la tuile.
    if manifest["type"] == "declarative":
        decl = manifest.get("declarative")
        if not isinstance(decl, dict):
            errs.append("type declarative : bloc `declarative` manquant ou invalide")
        else:
            if not decl.get("request") and not decl.get("requests"):
                errs.append("type declarative : `declarative.request` (ou `requests`) requis")
            if "view" not in decl:
                errs.append("type declarative : `declarative.view` requis")
    return errs


def _scan_dir(path, registry, errors):
    """Scanne une racine de manifestes et fusionne dans registry/errors.

    Appelée une fois par racine (registry/ puis /opt/panda/addons/). Précédence :
    la dernière racine scannée l'emporte — un addon valide dans /opt/panda/addons/
    remplace la version du socle (le store gagne). Une version invalide ne
    détruit pas une version valide déjà chargée (robustesse) : l'erreur est
    journalisée et exposée, mais le kiosk garde l'addon qui fonctionne.
    """
    if not os.path.isdir(path):
        return
    for name in sorted(os.listdir(path)):
        folder = os.path.join(path, name)
        mpath = os.path.join(folder, "manifest.json")
        if not os.path.isfile(mpath):
            continue
        try:
            with open(mpath, encoding="utf-8") as fh:
                manifest = json.load(fh)
        except (json.JSONDecodeError, OSError) as e:
            errors[name] = [f"manifest.json illisible : {e}"]
            log.warning("addon %s écarté : %s", name, e)
            continue
        errs = _validate(manifest, folder)
        if errs:
            errors[name] = errs
            log.warning("addon %s écarté : %s", name, "; ".join(errs))
            continue
        manifest["_dir"] = folder
        registry[manifest["id"]] = manifest
        errors.pop(name, None)  # une version valide efface une erreur antérieure


def load(path=None):
    """Scanne le(s) dossier(s) de manifestes. Retourne (registry, erreurs).

    Par défaut, deux racines sont scannées dans l'ordre de précédence :
    ``registry/`` (le socle livré avec le code) puis ``/opt/panda/addons/``
    (les addons installés depuis le store Abeille). Passer ``path`` force une
    racine unique (utile en test).

    ``registry`` : dict {id: manifest} des addons valides. Chaque manifeste
    porte ``_dir`` = son dossier d'origine : le loader de backends et le service
    de fichiers UI en ont besoin, les addons pouvant vivre dans deux racines.
    ``erreurs``  : dict {id: [messages]} des addons écartés — exposé dans
    l'admin pour que l'échec soit visible, pas silencieux.
    """
    registry, errors = {}, {}
    roots = [path] if path is not None else [REGISTRY_DIR, ADDONS_DIR]
    if not os.path.isdir(roots[0]):
        log.error("registre introuvable : %s", roots[0])
        return registry, {"_registry": [f"dossier absent : {roots[0]}"]}
    for root in roots:
        _scan_dir(root, registry, errors)
    return registry, errors


def addon_ids(registry):
    """Liste blanche des identifiants — remplace ADDON_IDS.

    Inclut les sections noyau, comme l'ancienne liste : elles passent par
    les mêmes chemins de configuration (masquage, ordre).
    """
    return set(registry) | CORE_SECTIONS


def tiles(registry):
    """Aplati les manifestes en liste de tuiles — ce que ADDONS[] contenait.

    Clef de tuile : id de l'addon si tuile unique, sinon <addon>.<tuile>.
    """
    out = []
    for aid, m in registry.items():
        for t in m["tiles"]:
            tid = t.get("id") or aid
            key = aid if tid == aid else f"{aid}.{tid}"
            out.append({
                "id": key,
                "addon": aid,
                "nm": t["name"],
                "ic": t["icon"],
                "src": t.get("source", ""),
                "cc": t.get("color", "#2dd4bf"),
                "type": t.get("render", "generic"),
                "cat": t.get("category", "utils"),
                "category": m.get("category", ""),
                "source": ("store" if (m.get("_dir") or "").startswith(ADDONS_DIR)
                           else "socle"),
                "fleet": bool(t.get("fleet")),
                "ui": (m.get("ui") or {}).get("entry"),
                "bg": bool((m.get("ui") or {}).get("background")),
                "ver": m.get("version") or "",
                "decl": m.get("type") == "declarative",
            })
    return out


def default_installed(registry):
    """Tuiles installées par défaut, dans l'ordre d'origine — remplace
    DEFAULT_CONFIG['installed'] / ['order'] et le DEF du frontend."""
    marked = []
    for aid, m in registry.items():
        for t in m["tiles"]:
            if t.get("default_installed"):
                tid = t.get("id") or aid
                key = aid if tid == aid else f"{aid}.{tid}"
                marked.append((t.get("default_rank", 10_000), key))
    return [key for _, key in sorted(marked)]


def config_schema(registry):
    """{id: fields} — ce que CFG_SCHEMA contenait."""
    return {aid: m["config"]["fields"] for aid, m in registry.items()
            if m.get("config", {}).get("fields")}


def config_doc(registry):
    """{id: [label, url]} — ce que CFG_DOC contenait."""
    return {aid: [m["config"]["doc"]["label"], m["config"]["doc"]["url"]]
            for aid, m in registry.items()
            if m.get("config", {}).get("doc")}


def requires_map(registry):
    """{id: [dépendances]} — dépendances inter-addons (lot E), pour la
    résolution à l'installation et la garde à la désinstallation (frontend)."""
    return {aid: m["requires"] for aid, m in registry.items() if m.get("requires")}


def frontend_payload(registry, errors):
    """Ce que /api/registry sert au frontend, en un seul appel."""
    return {
        "ok": True,
        "sdk": f"{KIOSK_API_MAJOR}.{KIOSK_API_MINOR}",
        "tiles": tiles(registry),
        "defaults": default_installed(registry),
        "schema": config_schema(registry),
        "doc": config_doc(registry),
        "requires": requires_map(registry),
        "errors": {k: v for k, v in errors.items()},
    }
