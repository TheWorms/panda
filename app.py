"""
Kiosk Panda — application Flask (Phase 2).
Serveur = source unique : config + PIN vivent côté serveur.
Sécurité : session signée + PIN haché (werkzeug) + anti-bruteforce léger.
"""
import copy
import json
import os
import secrets
import socket
import re as _re
import glob
import lzma
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone, date as _date
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from functools import wraps

import psutil
psutil.cpu_percent(interval=None)  # amorce l'état delta dès l'import
import requests
import urllib3
from flask import Flask, send_from_directory, jsonify, request, session, Response
from werkzeug.security import generate_password_hash, check_password_hash

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
SECRET_FILE = os.path.join(BASE_DIR, "secret.key")

APP_VERSION = "1.10.0"
DEFAULT_PIN = "123456"
DEFAULT_ADMIN_PW = "admin"
# Store Abeille : URL racine (brute, IP directe — jamais via Caddy) où vivent
# index.json et les paquets. Surchargeable via la config (clé storeUrl) pour
# pointer un dépôt de test sans redéployer.
DEFAULT_STORE_URL = "https://raw.githubusercontent.com/TheWorms/abeille/main/"
# Clé publique Ed25519 (base64) du store officiel Abeille : authentifie
# index.json (signé par sign-index.py sur le poste d'admin ; la clé privée
# ne quitte jamais ce poste). En dur dans le socle : seule une modification
# du code (accès root) peut changer la racine de confiance du mode officiel.
STORE_OFFICIAL_PUBKEY = "8naRKWwUoxagk+OHZ9IdXGPcmsZGmmQo79BZXCEwa4c="
# Clé publique Ed25519 (base64) qui authentifie les *releases de code* (mise à
# jour de Panda lui-même) — distincte de la clé du store d'addons ci-dessus.
# Générée par tools/gen-release-keys.py ; la clé privée ne quitte jamais le
# poste du mainteneur. DOIT être identique à RELEASE_PUBKEY dans
# install/panda-update. Vide = mise à jour signée non configurée (fork sans
# release publiée) : la vérification et l'outil refusent alors proprement.
PANDA_RELEASE_PUBKEY = ""
ALLOWED_KEYS = {"installed", "hidden", "order", "railOn", "connBar", "theme", "ntp",
                "autolock", "lockEnabled", "names", "catOrder", "vkb", "agCals", "radioFav", "timers", "transFav", "delMode", "timerSound", "veille", "brightness", "rotation", "appCat", "catCustom", "catNames", "catColors", "catIcons", "fontScale", "volBar", "btAutoReconnect", "btKeepAlive", "lang", "browserPw", "iconStyle", "wifiInd", "btInd", "clockFmt", "clockSec", "dateFmt", "catHidden", "storeUrl", "storeToken", "storeCheck", "storeMode", "storePubkey", "storeNoSig", "veilleMode", "veilleOff", "font", "railMode", "timerDisplay"}
import registry as _registry

_REGISTRY, _REGISTRY_ERRORS = _registry.load()
ADDON_IDS = _registry.addon_ids(_REGISTRY)
_REG_DEFAULTS = _registry.default_installed(_REGISTRY)
DEFAULT_CONFIG = {
    "installed": list(_REG_DEFAULTS),
    "hidden": [], "order": list(_REG_DEFAULTS),
    "railOn": False, "railMode": "both", "connBar": True, "theme": "dark", "ntp": True, "autolock": 0, "lockEnabled": True,
    "modules": {}, "names": {}, "catOrder": [], "vkb": True, "agCals": {}, "radioFav": [], "transFav": [], "delMode": False, "timerSound": "", "timerDisplay": "text",
    "veille": 0, "veilleMode": "off", "veilleOff": 0, "brightness": 100, "rotation": "normal",
    "timers": [{"n": "Œuf coque", "s": 180}, {"n": "Œuf mollet", "s": 300},
               {"n": "Pâtes", "s": 600}, {"n": "Riz", "s": 660},
               {"n": "Thé vert", "s": 180}, {"n": "Infusion", "s": 300}],
}

# anti-bruteforce (en mémoire, par IP)
MAX_FAILS = 5
LOCK_SECS = 30
_fails = {}

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024   # coupe les POST géants avant parse (RAM du Pi)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"         # explicite (défense CSRF, POST same-origin only)
ADMIN_TTL = 900   # session admin : 15 min, redemande le mot de passe ensuite (kiosk mural)


def _secret():
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "rb") as fh:
            return fh.read()
    s = secrets.token_bytes(32)
    with open(SECRET_FILE, "wb") as fh:
        fh.write(s)
    os.chmod(SECRET_FILE, 0o600)
    return s


app.secret_key = _secret()


@app.after_request
def _sec_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return resp


# -- Backends d'addons « code » (lot D) : montés in-process, sous
#    /addons/<id>/api, chacun dans un try/except. Un backend défaillant est
#    écarté et journalisé ; le kiosk démarre quand même.
import addon_backends as _addon_backends

_ADDON_BACKENDS, _BACKEND_ERRORS = _addon_backends.load_backends(
    app, _REGISTRY,
    lambda aid: _load().get("modules", {}).get(aid, {}),
    requests, _registry.REGISTRY_DIR, _registry.DATA_DIR)


@app.before_request
def _guard_addon_backends():
    """Les routes de backend d'addon (/addons/<id>/api/...) et leurs fichiers
    d'interface (/addons/<id>/ui/..., contrat Phase 3) héritent de
    l'authentification du noyau. Un addon n'a pas à connaître require_auth :
    la protection est imposée ici, avant que sa route ne s'exécute."""
    p = request.path
    if (p.startswith("/addons/") and ("/api/" in p or "/ui/" in p)) \
            or p.startswith("/api/addons/"):
        if not (session.get("authed") or _is_open()):
            return jsonify(error="unauthorized"), 401


# Phase 3 — UI embarquée : extensions servies pour les interfaces d'addons.
_UI_EXT = (".js", ".css", ".svg", ".png", ".webp", ".woff2")


@app.route("/addons/<aid>/ui/<path:fname>")
def addon_ui_file(aid, fname):
    """Sert les fichiers d'interface d'un addon (contrat Phase 3, ui.entry).

    Chemins bornés, même défense que _safe_extract : id validé, extension
    whitelistée, realpath confiné au dossier de l'addon. Précédence identique
    au chargement des manifestes : le store (/opt/panda/addons) gagne sur le
    socle (registry/). Cache long côté navigateur : le loader ajoute
    ?v=<version du manifest>, donc chaque mise à jour d'addon change l'URL et
    invalide mécaniquement le cache Chromium.
    """
    if not _re.fullmatch(r"[a-z][a-z0-9-]*", aid or ""):
        return jsonify(error="addon invalide"), 400
    if not fname.lower().endswith(_UI_EXT):
        return jsonify(error="type de fichier refusé"), 403
    for root in (_registry.ADDONS_DIR, _registry.REGISTRY_DIR):
        base = os.path.realpath(os.path.join(root, aid))
        target = os.path.realpath(os.path.join(base, fname))
        if target.startswith(base + os.sep) and os.path.isfile(target):
            resp = send_from_directory(base, os.path.relpath(target, base))
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp
    return jsonify(error="introuvable"), 404


@app.route("/api/addons/<aid>/state", methods=["GET", "POST"])
def addon_ui_state(aid):
    """État UI persistant par addon (contrat Phase 3, sdk.store).

    Remplace l'ancien mécanisme des clés par addon dans ALLOWED_KEYS
    (agCals, radioFav, timers, transFav…) : chaque addon écrit son propre
    JSON dans DATA_DIR/<id>/ui-state.json, qui survit aux redéploiements.
    Écriture atomique, dernier écrivain gagnant (un seul kiosk)."""
    if not _re.fullmatch(r"[a-z][a-z0-9-]*", aid or ""):
        return jsonify(error="addon invalide"), 400
    folder = os.path.join(_registry.DATA_DIR, aid)
    path = os.path.join(folder, "ui-state.json")
    if request.method == "GET":
        try:
            with open(path, encoding="utf-8") as f:
                return jsonify(json.load(f))
        except (OSError, json.JSONDecodeError):
            return jsonify({})
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify(ok=False, reason="objet JSON attendu"), 400
    if len(json.dumps(payload)) > 65536:
        return jsonify(ok=False, reason="état trop volumineux (64 Ko max)"), 413
    os.makedirs(folder, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, path)
    return jsonify(ok=True)


def _ck(*parts):
    """Clé de cache incluant le secret : un identifiant erroné ne peut pas
    récupérer la réponse d'un identifiant valide."""
    import hashlib
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:24]


def _load():
    # deepcopy : les valeurs imbriquées (installed, order, modules…) sont
    # mutées en place ailleurs ; une copie superficielle polluerait le
    # DEFAULT_CONFIG global dès qu'une clé manque dans config.json.
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, encoding="utf-8") as fh:
                cfg.update(json.load(fh))
        except (OSError, json.JSONDecodeError):
            pass
    if "pin_hash" not in cfg:
        cfg["pin_hash"] = generate_password_hash(DEFAULT_PIN)
    if "admin_hash" not in cfg:
        cfg["admin_hash"] = generate_password_hash(DEFAULT_ADMIN_PW)
        _save(cfg)
    return cfg


def _save(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)


def _migrate_kitchenowl_cfg():
    """Lot F : recopie une fois la connexion KitchenOwl vers l'addon
    « kitchenowl ». Historiquement, les identifiants vivaient dans l'un des 5
    addons cuisine (« un seul suffit »). Le fournisseur kitchenowl lit SA
    propre config (bac à sable) : on l'amorce depuis l'ancien emplacement.

    Idempotent : ne fait rien si kitchenowl a déjà une url, ou si aucun addon
    cuisine n'est configuré. Exécuté une fois au démarrage du noyau.
    """
    cfg = _load()
    mods = cfg.get("modules", {})
    ko = mods.get("kitchenowl", {})
    if (ko.get("url") or "").strip():
        return  # déjà configuré : on ne touche pas
    for mid in ("stock", "congelateur", "courses", "recettes", "repas"):
        src = mods.get(mid, {})
        if (src.get("url") or "").strip() and (src.get("token") or "").strip():
            mods.setdefault("kitchenowl", {}).update({
                "url": src["url"], "token": src["token"],
                "household": src.get("household") or "",
            })
            cfg["modules"] = mods
            _save(cfg)
            app.logger.info("kitchenowl: config migrée depuis « %s »", mid)
            return


def _public(cfg):
    return {k: v for k, v in cfg.items()
            if k not in ("pin_hash", "admin_hash", "modules")}


def _is_open():
    """Verrouillage désactivé -> accès libre (pas de PIN demandé)."""
    try:
        return _load().get("lockEnabled", True) is False
    except Exception:
        return False


def require_auth(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not (session.get("authed") or _is_open()):
            return jsonify(error="unauthorized"), 401
        return fn(*a, **kw)
    return wrapper


def _is_admin():
    """Admin actif : session admin non expirée OU option 'accès sans mot de passe'.

    La session admin expire après ADMIN_TTL (kiosk mural : un déverrouillage
    ne doit pas rester acquis indéfiniment sur un écran accessible à tous)."""
    if _load().get("adminNoPw"):
        return True
    if not session.get("admin"):
        return False
    if time.time() - float(session.get("admin_ts") or 0) > ADMIN_TTL:
        session.pop("admin", None); session.pop("admin_ts", None)
        return False
    return True


def require_admin(fn):
    """Paramètres & secrets : toujours protégés, même si le PIN est désactivé."""
    @wraps(fn)
    def wrapper(*a, **kw):
        if not _is_admin():
            return jsonify(error="admin_required"), 403
        return fn(*a, **kw)
    return wrapper


def _lock_remaining(ip):
    rec = _fails.get(ip)
    if rec and rec["count"] >= MAX_FAILS:
        left = int(rec["until"] - time.time())
        if left > 0:
            return left
        _fails.pop(ip, None)
    return 0


@app.route("/")
def index():
    """Coquille HTML (scission 0.99.49) : servie SANS cache, avec APP_VERSION
    injectée dans les ?v= des assets. Les gros fichiers (panda.css, panda.js,
    icons.css) sont donc rechargés par Chromium à chaque nouvelle version du
    socle — plus jamais de purge de cache ni de reboot pour voir une mise à
    jour."""
    with open(os.path.join(STATIC_DIR, "index.html"), encoding="utf-8") as f:
        html = f.read().replace("__V__", APP_VERSION)
    resp = Response(html, mimetype="text/html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/healthz")
def healthz():
    return jsonify(status="ok", app="panda", version=APP_VERSION,
                   kiosk_api=f"{_registry.KIOSK_API_MAJOR}.{_registry.KIOSK_API_MINOR}")


@app.route("/api/session")
def api_session():
    cfg = _load()
    return jsonify(authed=bool(session.get("authed")) or _is_open(),
                   admin=_is_admin(),
                   admin_nopw=bool(cfg.get("adminNoPw")),
                   default_admin=check_password_hash(
                       cfg["admin_hash"], DEFAULT_ADMIN_PW),
                   locked=_lock_remaining(request.remote_addr),
                   theme=cfg.get("theme") or "dark")


@app.route("/api/pin/verify", methods=["POST"])
def api_pin_verify():
    ip = request.remote_addr
    wait = _lock_remaining(ip)
    if wait:
        return jsonify(ok=False, wait=wait)
    pin = (request.get_json(force=True, silent=True) or {}).get("pin", "")
    cfg = _load()
    if check_password_hash(cfg["pin_hash"], pin):
        session["authed"] = True
        _fails.pop(ip, None)
        return jsonify(ok=True)
    rec = _fails.setdefault(ip, {"count": 0, "until": 0})
    rec["count"] += 1
    if rec["count"] >= MAX_FAILS:
        rec["until"] = time.time() + LOCK_SECS
        return jsonify(ok=False, wait=LOCK_SECS)
    return jsonify(ok=False, remaining=MAX_FAILS - rec["count"])


@app.route("/api/admin/verify", methods=["POST"])
def api_admin_verify():
    ip = (request.remote_addr or "?") + ":admin"
    wait = _lock_remaining(ip)
    if wait:
        return jsonify(ok=False, wait=wait)
    pw = (request.get_json(force=True, silent=True) or {}).get("password", "")
    if check_password_hash(_load()["admin_hash"], pw):
        session["admin"] = True
        session["admin_ts"] = time.time()
        _fails.pop(ip, None)
        return jsonify(ok=True)
    rec = _fails.setdefault(ip, {"count": 0, "until": 0})
    rec["count"] += 1
    if rec["count"] >= MAX_FAILS:
        rec["until"] = time.time() + LOCK_SECS
        return jsonify(ok=False, wait=LOCK_SECS)
    return jsonify(ok=False, remaining=MAX_FAILS - rec["count"])


@app.route("/api/admin/nopw", methods=["POST"])
@require_auth
def api_admin_nopw():
    """Active (mot de passe requis) ou désactive l'accès admin sans mot de passe."""
    j = request.get_json(force=True, silent=True) or {}
    on = bool(j.get("on"))
    cfg = _load()
    if on:
        pw = (j.get("password") or "")
        if not check_password_hash(cfg["admin_hash"], pw):
            return jsonify(ok=False, reason="mot de passe incorrect"), 403
        cfg["adminNoPw"] = True
    else:
        cfg["adminNoPw"] = False
    _save(cfg)
    return jsonify(ok=True, adminNoPw=cfg["adminNoPw"])


@app.route("/api/admin/lock", methods=["POST"])
def api_admin_lock():
    session.pop("admin", None)
    return jsonify(ok=True)


@app.route("/api/admin/change", methods=["POST"])
@require_admin
def api_admin_change():
    j = request.get_json(force=True, silent=True) or {}
    old, new = j.get("old", ""), j.get("new", "")
    if not check_password_hash(_load()["admin_hash"], old):
        return jsonify(ok=False, error="Mot de passe actuel incorrect"), 400
    if not (isinstance(new, str) and len(new) >= 8):
        return jsonify(ok=False, error="8 caractères minimum"), 400
    cfg = _load()
    cfg["admin_hash"] = generate_password_hash(new)
    _save(cfg)
    return jsonify(ok=True)


@app.route("/api/pin/change", methods=["POST"])
@require_admin
def api_pin_change():
    new = (request.get_json(force=True, silent=True) or {}).get("new", "")
    if not (isinstance(new, str) and new.isdigit() and len(new) == 6):
        return jsonify(ok=False, error="Le code doit faire 6 chiffres"), 400
    cfg = _load()
    cfg["pin_hash"] = generate_password_hash(new)
    _save(cfg)
    return jsonify(ok=True)


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify(ok=True)


# ---------------------------------------------------------------- déclaratif
_DECL_CACHE = {}
_INTERP_RE = _re.compile(r"\$\{config\.([a-z][a-z0-9_]*)\}")
_NOW_RE = _re.compile(r"\$\{now\.(year|month|day)\}")


def _interp(node, cfg, missing):
    """Interpole ${config.x} et ${now.year|month|day} en profondeur
    (chaînes, dicts, listes). ${now.*} sert aux API qui exigent la date
    courante en paramètre (ex. Wallos get_monthly_cost)."""
    if isinstance(node, str):
        def rep(m):
            k = m.group(1)
            v = (cfg.get(k) or "").strip() if isinstance(cfg.get(k), str) else cfg.get(k)
            if not v:
                missing.add(k)
                return ""
            return str(v)
        node = _INTERP_RE.sub(rep, node)
        now = datetime.now()
        return _NOW_RE.sub(lambda m: str(getattr(now, m.group(1))), node)
    if isinstance(node, dict):
        return {k: _interp(v, cfg, missing) for k, v in node.items()}
    if isinstance(node, list):
        return [_interp(v, cfg, missing) for v in node]
    return node


def _host_of(v):
    v = (v or "").strip()
    if "://" in v:
        v = v.split("://", 1)[1]
    return v.split("/")[0].split("@")[-1].lower()


def _dotget(obj, path):
    """Extraction par chemin pointé : data.pages.list ; « $ » = racine
    (réponses dont la racine est directement la liste, ex. Kavita)."""
    if path == "$":
        return obj
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            cur = cur[int(part)] if int(part) < len(cur) else None
        else:
            return None
        if cur is None:
            return None
    return cur


def _decl_auth(auth, headers, params, kw, allowed, timeout):
    """Applique un bloc auth sur une requête. Retourne un message d'erreur
    ou None. Types : bearer, basic, header, query, token_exchange — ce
    dernier obtient un Bearer via une sous-requête décrite dans le
    manifeste (clé API -> JWT, ex. Kavita), hôte borné comme le reste."""
    t = auth.get("type", "none")
    if t == "bearer":
        headers["Authorization"] = "Bearer " + (auth.get("value") or "")
    elif t == "basic":
        kw["auth"] = (auth.get("user") or "", auth.get("password") or "")
    elif t == "header":
        headers[auth.get("name") or "X-Api-Key"] = auth.get("value") or ""
    elif t == "query":
        params[auth.get("name") or "key"] = auth.get("value") or ""
    elif t == "token_exchange":
        sub = auth.get("request") or {}
        surl = sub.get("url", "")
        if _host_of(surl) not in allowed:
            return f"hôte non autorisé par le manifeste : {_host_of(surl)}"
        try:
            r = requests.request(sub.get("method", "POST"), surl,
                                 headers=sub.get("headers"),
                                 params=sub.get("query"),
                                 json=sub.get("json") if sub.get("json") is not None else None,
                                 timeout=timeout)
        except requests.exceptions.RequestException as e:
            return f"échange de jeton : {type(e).__name__}"
        if r.status_code == 401:
            return "échange de jeton : clé refusée (401)"
        if r.status_code != 200:
            return f"échange de jeton : HTTP {r.status_code}"
        try:
            tok = _dotget(r.json(), auth.get("token_path", "token"))
        except ValueError:
            return "échange de jeton : réponse non-JSON"
        if not tok:
            return "échange de jeton : jeton absent"
        headers["Authorization"] = "Bearer " + str(tok)
    return None


def _decl_exec(aid, m, cfg_override=None):
    """Exécute le bloc declarative d'un manifeste : requête(s) -> extraction.

    Le noyau applique ici ce que le manifeste promet : réseau borné par
    permissions.network, secrets jamais renvoyés à l'écran, cache court.

    Contrat : `request` (objet, avec `extract` au niveau du bloc — motif
    Wiki.js, inchangé) ou `requests` (liste, chaque requête porte son
    `extract`, résultats fusionnés). `auth` au niveau du bloc s'applique à
    toutes les requêtes, une requête peut la surcharger.

    ``cfg_override`` : config à utiliser au lieu de la config sauvegardée
    (le bouton « Tester » teste les valeurs saisies, pas encore enregistrées).
    Le cache est court-circuité dans ce cas.
    """
    decl = m["declarative"]
    testing = cfg_override is not None
    cfg = cfg_override if testing else _load().get("modules", {}).get(aid, {})
    missing = set()
    raw = decl.get("requests") or decl["request"]
    reqs = _interp(raw if isinstance(raw, list) else [raw], cfg, missing)
    base_auth = _interp(decl["auth"], cfg, missing) if decl.get("auth") else None
    open_url = _interp(decl.get("open_url", ""), cfg, set())
    if missing:
        return {"ok": False,
                "reason": "config manquante : " + ", ".join(sorted(missing)),
                "open_url": open_url}

    # -- permission réseau : tout hôte appelé doit être couvert par le manifeste
    allowed = set()
    for h in (m.get("permissions", {}).get("network") or []):
        hh = _interp(h, cfg, set())
        if hh:
            allowed.add(_host_of(hh))

    ck = (aid, json.dumps(reqs, sort_keys=True, default=str))
    ttl = decl.get("cache_seconds", 120)
    c = _DECL_CACHE.get(ck)
    if c and not testing and time.time() - c[0] < ttl:
        return c[1]

    timeout = decl.get("timeout_seconds", 10)
    data = {}
    for req in reqs:
        url = req.get("url", "")
        if _host_of(url) not in allowed:
            return {"ok": False, "open_url": open_url,
                    "reason": f"hôte non autorisé par le manifeste : {_host_of(url)}"}
        headers = dict(req.get("headers") or {})
        params = dict(req.get("query") or {})
        kw = {}
        err = _decl_auth(req.get("auth") or base_auth or {"type": "none"},
                         headers, params, kw, allowed, timeout)
        if err:
            return {"ok": False, "reason": err, "open_url": open_url}
        try:
            r = requests.request(req.get("method", "GET"), url,
                                 headers=headers, params=params,
                                 json=req.get("json") if req.get("json") is not None else None,
                                 timeout=timeout, **kw)
        except requests.exceptions.RequestException as e:
            return {"ok": False, "reason": type(e).__name__, "open_url": open_url}

        if r.status_code != 200:
            msg = (decl.get("errors") or {}).get(str(r.status_code), f"HTTP {r.status_code}")
            return {"ok": False, "reason": msg, "open_url": open_url}
        try:
            j = r.json()
        except ValueError:
            return {"ok": False, "reason": "réponse non-JSON", "open_url": open_url}
        if isinstance(j, dict) and j.get("errors"):
            try:
                msg = j["errors"][0].get("message", "erreur API")
            except (KeyError, IndexError, AttributeError, TypeError):
                msg = "erreur API"
            return {"ok": False, "reason": msg, "open_url": open_url}
        if isinstance(j, dict) and j.get("success") is False:
            return {"ok": False, "reason": j.get("title") or "erreur API",
                    "open_url": open_url}

        extract = req.get("extract") or \
            (decl.get("extract") if len(reqs) == 1 else None) or {}
        for k, path in extract.items():
            data[k] = _dotget(j, path)

    # -- resolve : jointure par ID. Chaque règle transforme une liste de
    #    tables {id: libellé} (extraites en parallèle) en champ lisible sur
    #    les éléments d'une autre liste. Générique — motif Paperless (tags,
    #    correspondents résolus par ID sur les documents).
    for rule in (decl.get("resolve") or []):
        rows = data.get(rule.get("in"))
        table = data.get(rule.get("from"))
        if not isinstance(rows, list) or not isinstance(table, list):
            continue
        idk = rule.get("table_key", "id")
        lblk = rule.get("table_label", "name")
        lut = {r.get(idk): r.get(lblk) for r in table if isinstance(r, dict)}
        srck, dstk = rule.get("field"), rule.get("as") or rule.get("field")
        multi = bool(rule.get("multi"))
        for it in rows:
            if not isinstance(it, dict):
                continue
            v = it.get(srck)
            if multi:
                it[dstk] = ", ".join(str(lut.get(x)) for x in (v or [])
                                     if lut.get(x)) or ""
            else:
                it[dstk] = lut.get(v, "") if v is not None else ""
    # les tables de correspondance ne sont pas destinées à l'écran
    for rule in (decl.get("resolve") or []):
        data.pop(rule.get("from"), None)

    res = {"ok": True, "data": data, "open_url": open_url,
           "view": decl["view"]}
    if not testing:
        _DECL_CACHE[ck] = (time.time(), res)
    return res


@app.route("/api/decl/<aid>")
@require_auth
def api_decl(aid):
    m = _REGISTRY.get(aid)
    if not m or m.get("type") != "declarative":
        return jsonify({"ok": False, "reason": "addon déclaratif inconnu"}), 404
    return jsonify(_decl_exec(aid, m))


@app.route("/addons/<aid>/<path:fname>")
@require_auth
def addon_asset(aid, fname):
    """Sert les fichiers déclarés d'un addon : le module ui.js (ui.entry) et,
    si présent, le logo déclaré (manifest « logo »). Rien d'autre du dossier."""
    m = _REGISTRY.get(aid)
    if not m:
        return jsonify({"ok": False, "reason": "module inconnu"}), 404
    entry = (m or {}).get("ui", {}).get("entry")
    logo = m.get("logo")
    # logo éventuellement déclaré au niveau d'une tuile
    if not logo:
        for t in m.get("tiles", []):
            if t.get("logo"):
                logo = t["logo"]
                break
    folder = m.get("_dir") or os.path.join(_registry.REGISTRY_DIR, aid)
    if entry and fname == entry:
        return send_from_directory(folder, entry, mimetype="text/javascript")
    if logo and fname == logo:
        mt = "image/svg+xml" if fname.lower().endswith(".svg") else None
        return send_from_directory(folder, logo, mimetype=mt)
    return jsonify({"ok": False, "reason": "fichier non autorisé"}), 404


@app.route("/api/registry")
@require_auth
def api_registry():
    """Catalogue des addons — remplace les constantes en dur du frontend.
    Les erreurs de backend (lot D) rejoignent celles de manifeste : l'échec
    d'un addon reste visible dans l'admin, jamais silencieux."""
    payload = _registry.frontend_payload(_REGISTRY, _REGISTRY_ERRORS)
    for aid, msg in _BACKEND_ERRORS.items():
        payload["errors"].setdefault(aid, []).append(f"backend : {msg}")
    return jsonify(payload)


# ---------------------------------------------------------------------------
# Store Abeille : découverte / installation / désinstallation d'addons.
# Règles : admin uniquement. L'index et les paquets viennent d'un dépôt
# distant → tout ce qui en provient (id, nom de paquet, checksum, contenu du
# zip) est traité comme NON FIABLE. Le noyau est le dernier rempart : il
# revalide le manifeste après extraction, exactement comme au démarrage.
# ---------------------------------------------------------------------------
_ID_RE = _re.compile(r"^[a-z][a-z0-9_-]*$")
_VER_RE = _re.compile(r"^\d+\.\d+\.\d+$")


def _store_url():
    """URL racine du store, terminée par « / ».

    Le schéma est borné à http/https : toute autre valeur (file://, ftp://…)
    est ignorée au profit du défaut, pour ne pas détourner le fetch.
    """
    cfg = _load()
    if (cfg.get("storeMode") or "officiel").strip() != "perso":
        return DEFAULT_STORE_URL  # mode officiel : URL du socle, non surchargeable
    u = (cfg.get("storeUrl") or DEFAULT_STORE_URL).strip()
    if not (u.startswith("http://") or u.startswith("https://")):
        u = DEFAULT_STORE_URL
    return u if u.endswith("/") else u + "/"


def _store_token():
    """Jeton d'accès au dépôt (optionnel), pour un Abeille protégé."""
    cfg = _load()
    if (cfg.get("storeMode") or "officiel").strip() != "perso":
        return ""  # mode officiel : dépôt public, aucun jeton envoyé
    return (cfg.get("storeToken") or "").strip()


def _store_headers():
    """En-têtes des requêtes vers Abeille : Authorization si un jeton existe."""
    tok = _store_token()
    return {"Authorization": f"token {tok}"} if tok else {}


def _store_verify():
    """Vérification TLS du store.

    Abeille peut être servi en https avec un certificat de CA maison. Python
    `requests` vérifie via certifi (bundle figé) et ignore le trust store
    système ; on pointe donc vers le bundle CA système
    (/etc/ssl/certs/ca-certificates.crt), qui inclut la CA maison si elle a été
    installée (update-ca-certificates). À défaut, on garde le défaut certifi.
    """
    p = "/etc/ssl/certs/ca-certificates.crt"
    return p if os.path.exists(p) else True


def _semver(v):
    """« X.Y.Z » -> (x, y, z) pour comparaison. (0,0,0) si illisible."""
    try:
        return tuple(int(p) for p in str(v).split("."))
    except (ValueError, AttributeError):
        return (0, 0, 0)


def _kiosk_api_ok(spec):
    """Compatibilité du contrat, même règle que registry._validate."""
    try:
        major, minor = str(spec).lstrip("^").split(".")
        return (int(major) == _registry.KIOSK_API_MAJOR
                and int(minor) <= _registry.KIOSK_API_MINOR)
    except (ValueError, AttributeError):
        return False


def _store_pubkey():
    """Clé publique (base64) qui authentifie l'index du store.

    Mode « officiel » (défaut) : la clé du store Abeille, codée en dur dans
    le socle (STORE_OFFICIAL_PUBKEY). Mode « perso » : la clé fournie par
    l'utilisateur (storePubkey) — obligatoire, un store perso sans clé est
    refusé (mode strict).
    """
    cfg = _load()
    if (cfg.get("storeMode") or "officiel").strip() == "perso":
        return (cfg.get("storePubkey") or "").strip()
    return STORE_OFFICIAL_PUBKEY


def _verify_index_sig(blob, sig_b64):
    """Vérifie la signature Ed25519 de l'index (octets bruts). True si OK."""
    import base64
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PublicKey,
    )
    try:
        pub = Ed25519PublicKey.from_public_bytes(
            base64.b64decode(_store_pubkey()))
        pub.verify(base64.b64decode(sig_b64.strip()), blob)
        return True
    except Exception:
        return False


def _verify_release_sig(blob, sig_b64):
    """Vérifie la signature Ed25519 d'une release (release.json). True si OK.

    Même modèle que _verify_index_sig, mais avec la clé dédiée aux releases de
    code (PANDA_RELEASE_PUBKEY). Sans clé embarquée, aucune release n'est
    authentifiable : on refuse."""
    import base64
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PublicKey,
    )
    if not PANDA_RELEASE_PUBKEY:
        return False
    try:
        pub = Ed25519PublicKey.from_public_bytes(
            base64.b64decode(PANDA_RELEASE_PUBKEY))
        pub.verify(base64.b64decode(sig_b64.strip()), blob)
        return True
    except Exception:
        return False


def _installed():
    """{id: (version, source)} des addons chargés. source ∈ {socle, store}."""
    out = {}
    for aid, m in _REGISTRY.items():
        src = "store" if (m.get("_dir") or "").startswith(
            _registry.ADDONS_DIR) else "socle"
        out[aid] = (m.get("version", "0.0.0"), src)
    return out


def _fetch_index():
    """Récupère, AUTHENTIFIE puis parse index.json.

    Mode strict : l'index doit être accompagné d'index.json.sig (Ed25519),
    vérifiable par la clé du mode courant (_store_pubkey). Sans signature
    valide, rien n'est installable depuis le store. Garde-fou d'urgence :
    storeNoSig=true saute la vérification (dépannage uniquement — ne jamais
    laisser actif).
    Retourne (index|None, erreur|None)."""
    url = _store_url() + "index.json"
    try:
        r = requests.get(url, headers=_store_headers(), verify=_store_verify(), timeout=8)
        r.raise_for_status()
        blob = r.content
    except requests.RequestException as e:
        return None, f"dépôt injoignable : {e}"
    if not _load().get("storeNoSig"):
        if not _store_pubkey():
            return None, "store perso : clé publique manquante (mode strict)"
        try:
            rs = requests.get(url + ".sig", headers=_store_headers(),
                              verify=_store_verify(), timeout=8)
            rs.raise_for_status()
        except requests.RequestException as e:
            return None, f"signature de l'index introuvable : {e}"
        if not _verify_index_sig(blob, rs.text):
            return None, "signature de l'index invalide — store refusé"
    try:
        data = json.loads(blob.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None, "index.json illisible (JSON invalide)"
    if not isinstance(data, dict) or not isinstance(data.get("addons"), list):
        return None, "index.json : format inattendu"
    return data, None


def _safe_extract(zip_path, dest):
    """Extrait un zip <id>/… dans dest en refusant toute traversée de chemin.

    Le contenu attendu est préfixé par « <id>/ » (convention publish-addon.sh).
    Toute entrée dont le chemin résolu sort de dest est rejetée (zip-slip).
    """
    import zipfile
    dest_abs = os.path.realpath(dest)
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            if member.endswith("/"):
                continue
            target = os.path.realpath(os.path.join(dest_abs, member))
            if target != dest_abs and not target.startswith(dest_abs + os.sep):
                raise ValueError(f"entrée hors périmètre (zip-slip) : {member}")
        zf.extractall(dest_abs)


def _cross_index(index):
    """Croise l'index distant avec l'installé. Retourne la liste enrichie
    (id, name, …, status, installed_version, source), triée par nom.

    status ∈ {disponible, maj, installe, incompatible}. Partagé par
    /api/store/index (catalogue) et /api/store/updates (compteur de badge).
    """
    installed = _installed()
    items = []
    for a in index["addons"]:
        aid = a.get("id", "")
        if not _ID_RE.match(aid):
            continue  # entrée d'index malformée : ignorée en silence
        cur = installed.get(aid)
        if not _kiosk_api_ok(a.get("kiosk_api", "")):
            status = "incompatible"
        elif cur is None:
            status = "disponible"
        elif _semver(a.get("version")) > _semver(cur[0]):
            status = "maj"
        else:
            status = "installe"
        items.append({
            "id": aid,
            "name": a.get("name", aid),
            "description": a.get("description", ""),
            "version": a.get("version", ""),
            "kiosk_api": a.get("kiosk_api", ""),
            "type": a.get("type", ""),
            "category": a.get("category", ""),
            "requires": a.get("requires", []),
            "size": a.get("size"),
            "icon": a.get("icon", ""),
            "logo": a.get("logo", ""),
            "color": a.get("color", ""),
            "changelog": a.get("changelog", ""),
            "status": status,
            "installed_version": cur[0] if cur else None,
            "source": cur[1] if cur else None,
        })
    items.sort(key=lambda x: x["name"].lower())
    return items


@app.route("/api/store/index")
@require_admin
def api_store_index():
    """Catalogue distant croisé avec l'état local.

    Chaque addon reçoit un statut : disponible / installe / maj / incompatible.
    « source » indique si la version installée vient du socle ou du store
    (la désinstallation n'est permise que pour le store).
    """
    index, err = _fetch_index()
    if err:
        return jsonify({"ok": False, "reason": err}), 502
    return jsonify({"ok": True, "updated": index.get("updated"),
                    "store_url": _store_url(), "addons": _cross_index(index)})


@app.route("/api/store/updates")
@require_admin
def api_store_updates():
    """Compteur léger pour le badge : combien de MAJ et de nouveaux addons
    compatibles sont disponibles sur Abeille. Ne télécharge aucun paquet.
    En cas de dépôt injoignable, renvoie ok:False sans erreur bloquante
    (le badge reste simplement à zéro côté front)."""
    index, err = _fetch_index()
    if err:
        return jsonify({"ok": False, "reason": err, "maj": 0, "nouveaux": 0})
    items = _cross_index(index)
    maj = sum(1 for a in items if a["status"] == "maj")
    nouveaux = sum(1 for a in items if a["status"] == "disponible")
    return jsonify({"ok": True, "maj": maj, "nouveaux": nouveaux,
                    "total": maj + nouveaux, "updated": index.get("updated")})


def _deferred_restart():
    """Redémarre le service après la réponse HTTP (calqué sur api_power)."""
    import threading

    def later():
        time.sleep(1)
        _run(["sudo", "systemctl", "restart", "panda"], timeout=15)

    threading.Thread(target=later, daemon=True).start()


def _install_one_addon(aid, index):
    """Télécharge, vérifie et pose UN addon sur le disque (sans config ni restart).

    Retourne (ok: bool, reason: str). Chaîne : entrée d'index → download →
    checksum SHA-256 → extraction atomique → revalidation noyau → bascule
    atomique → cache. Toute étape qui échoue laisse l'existant intact.
    """
    import hashlib
    import tempfile

    entry = next((a for a in index["addons"] if a.get("id") == aid), None)
    if not entry:
        return False, f"{aid} : absent de l'index"
    version = entry.get("version", "")
    if not _VER_RE.match(version):
        return False, f"{aid} : version d'index invalide"
    if not _kiosk_api_ok(entry.get("kiosk_api", "")):
        return False, f"{aid} : kiosk_api {entry.get('kiosk_api')} incompatible"

    zip_name = f"{aid}-{version}.zip"
    allowed_packages = (f"zips/{aid}/{zip_name}", zip_name)
    package = entry.get("package") or f"zips/{aid}/{zip_name}"
    if package not in allowed_packages or ".." in package or package.startswith("/"):
        return False, f"{aid} : nom de paquet non conforme"
    sha_expected = (entry.get("sha256") or "").lower()
    if not _re.fullmatch(r"[0-9a-f]{64}", sha_expected):
        return False, f"{aid} : checksum absent ou malformé"

    addons_dir = _registry.ADDONS_DIR
    tmp_root = os.path.join(addons_dir, ".tmp")
    cache = os.path.join(addons_dir, ".cache")
    try:
        for d in (addons_dir, tmp_root, cache):
            os.makedirs(d, exist_ok=True)
    except OSError as e:
        return False, f"droits insuffisants sur {addons_dir} : {e}"

    url = _store_url() + package
    try:
        r = requests.get(url, headers=_store_headers(), verify=_store_verify(), timeout=30)
        r.raise_for_status()
        blob = r.content
    except requests.RequestException as e:
        return False, f"{aid} : téléchargement échoué : {e}"

    if hashlib.sha256(blob).hexdigest() != sha_expected:
        return False, f"{aid} : checksum invalide"

    staging = tempfile.mkdtemp(prefix=f"{aid}-", dir=tmp_root)
    zpath = os.path.join(staging, zip_name)   # basename : package peut contenir zips/<id>/
    try:
        with open(zpath, "wb") as fh:
            fh.write(blob)
        extract_dir = os.path.join(staging, "x")
        os.makedirs(extract_dir)
        try:
            _safe_extract(zpath, extract_dir)
        except Exception as e:
            return False, f"{aid} : extraction refusée : {e}"

        payload_dir = os.path.join(extract_dir, aid)
        if not os.path.isdir(payload_dir):
            return False, f"{aid} : le paquet ne contient pas {aid}/"

        reg, errs = _registry.load(path=extract_dir)
        if aid in errs:
            return False, f"{aid} : manifeste rejeté : " + "; ".join(errs[aid])
        if aid not in reg:
            return False, f"{aid} : manifeste invalide"

        target = os.path.join(addons_dir, aid)
        backup = os.path.join(tmp_root, f"{aid}.prev")
        if os.path.exists(backup):
            shutil.rmtree(backup, ignore_errors=True)
        replaced = os.path.exists(target)
        if replaced:
            os.rename(target, backup)
        try:
            os.rename(payload_dir, target)
        except OSError as e:
            if replaced:
                os.rename(backup, target)   # restauration
            return False, f"{aid} : bascule échouée : {e}"
        if replaced:
            shutil.rmtree(backup, ignore_errors=True)

        try:
            shutil.copy2(zpath, os.path.join(cache, zip_name))
        except OSError:
            pass
    except OSError as e:
        return False, f"{aid} : erreur disque : {e}"
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    return True, ""


def _resolve_missing_requires(index, aid, _seen=None):
    """Dépendances `requires` transitives de `aid` non encore présentes.

    Renvoie une liste ordonnée (les dépendances AVANT ce qui en dépend), sans
    doublon, protégée contre les cycles. Une dépendance déjà présente (socle ou
    déjà installée, donc dans `_REGISTRY`) est considérée satisfaite et ignorée.
    """
    if _seen is None:
        _seen = set()
    out = []
    entry = next((a for a in index["addons"] if a.get("id") == aid), None)
    if not entry:
        return out
    for dep in entry.get("requires") or []:
        if dep in _seen:
            continue
        _seen.add(dep)
        if dep in _REGISTRY:
            continue                        # déjà présent : satisfait
        out.extend(_resolve_missing_requires(index, dep, _seen))
        out.append(dep)
    return out


def _upd_progress_path():
    """Fichier de progression du batch (partagé entre les workers gunicorn)."""
    return os.path.join(_registry.ADDONS_DIR, ".update-all.json")


def _upd_write(d):
    d["ts"] = time.time()
    try:
        tmp = _upd_progress_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False)
        os.replace(tmp, _upd_progress_path())
    except OSError:
        pass


def _upd_read():
    try:
        with open(_upd_progress_path(), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _upd_order(ids, index):
    """Ordonne les mises à jour : les dépendances (requires) avant leurs
    dépendants, quand les deux sont dans le lot (ex. kitchenowl avant stock)."""
    reqs = {a["id"]: set(a.get("requires") or [])
            for a in index["addons"] if a.get("id") in ids}
    out, todo = [], list(ids)
    while todo:
        moved = False
        for aid in list(todo):
            if reqs.get(aid, set()) & (set(todo) - {aid}):
                continue                      # une dépendance attend encore
            out.append(aid)
            todo.remove(aid)
            moved = True
        if not moved:                         # cycle improbable : tel quel
            out.extend(todo)
            break
    return out


def _update_all_worker(ids, index):
    """Met à jour les addons en séquence (thread), puis UN SEUL restart.

    Chaque pose est atomique (_install_one_addon) : un échec laisse l'addon
    à son ancienne version et n'empêche pas la suite — sauf ses dépendants,
    sautés pour rester cohérents. Bilan écrit avant le restart final.
    """
    total = len(ids)
    done, errors, failed = 0, [], set()
    for i, aid in enumerate(ids, 1):
        entry = next((a for a in index["addons"] if a.get("id") == aid), {})
        name = entry.get("name", aid)
        _upd_write({"running": True, "i": i, "current": name,
                    "done": done, "total": total, "errors": errors})
        if set(entry.get("requires") or []) & failed:
            errors.append(f"{name} : saut (dépendance en échec)")
            failed.add(aid)
            continue
        ok, reason = _install_one_addon(aid, index)
        if ok:
            done += 1
        else:
            errors.append(reason or f"{name} : échec")
            failed.add(aid)
    _upd_write({"running": False, "i": total, "current": "", "done": done,
                "total": total, "errors": errors, "restarting": True})
    time.sleep(1.5)
    _run(["sudo", "systemctl", "restart", "panda"], timeout=15)


@app.route("/api/store/update-all", methods=["POST"])
@require_admin
def api_store_update_all():
    """Met à jour TOUS les addons en statut « maj », puis un restart unique."""
    st = _upd_read()
    if st and st.get("running") and time.time() - st.get("ts", 0) < 600:
        return jsonify({"ok": False, "reason": "mise à jour déjà en cours"}), 409
    index, err = _fetch_index()
    if err:
        return jsonify({"ok": False, "reason": err}), 502
    ids = [x["id"] for x in _cross_index(index) if x["status"] == "maj"]
    if not ids:
        return jsonify({"ok": True, "total": 0})
    ids = _upd_order(ids, index)
    _upd_write({"running": True, "i": 0, "current": "", "done": 0,
                "total": len(ids), "errors": []})
    import threading
    threading.Thread(target=_update_all_worker, args=(ids, index),
                     daemon=True).start()
    return jsonify({"ok": True, "total": len(ids), "ids": ids})


@app.route("/api/store/update-all/status")
@require_admin
def api_store_update_all_status():
    """Progression du batch (lue par le voile côté kiosk)."""
    return jsonify(_upd_read() or {"running": False, "total": 0})


@app.route("/api/store/install", methods=["POST"])
@require_admin
def api_store_install():
    """Installe ou met à jour un addon depuis le store, dépendances comprises.

    Résolution ascendante : si l'addon déclare des `requires` absents, ils sont
    renvoyés au front (``needs_deps``) SANS rien installer, pour confirmation.
    Rappelé avec ``with_deps=true``, le noyau installe la chaîne (dépendances
    d'abord), met à jour la config et redémarre UNE seule fois.
    """
    body = request.get_json(silent=True) or {}
    aid = body.get("id", "")
    with_deps = bool(body.get("with_deps"))
    if not _ID_RE.match(aid or ""):
        return jsonify({"ok": False, "reason": "id invalide"}), 400

    index, err = _fetch_index()
    if err:
        return jsonify({"ok": False, "reason": err}), 502
    entry = next((a for a in index["addons"] if a.get("id") == aid), None)
    if not entry:
        return jsonify({"ok": False, "reason": "addon absent de l'index"}), 404
    version = entry.get("version", "")

    # --- résolution des dépendances manquantes ---
    missing = _resolve_missing_requires(index, aid)
    if missing and not with_deps:
        # rien n'est installé : le front affiche la confirmation puis rappelle
        # /install avec with_deps=true.
        names = {a["id"]: a.get("name", a["id"]) for a in index["addons"]}
        return jsonify({"ok": False, "needs_deps": missing, "target": aid,
                        "dep_names": [names.get(d, d) for d in missing],
                        "reason": "dépendances requises"}), 200

    # --- installation de la chaîne : dépendances d'abord, puis la cible ---
    chain = missing + [aid]
    done = []
    for cid in chain:
        ok, reason = _install_one_addon(cid, index)
        if not ok:
            # les dépendances déjà posées restent (addons valides) ; on signale
            return jsonify({"ok": False, "reason": reason, "installed": done}), 502
        done.append(cid)

    # config : référencer tous les addons posés (installés, masqués sur l'accueil)
    cfg = _load()
    inst = cfg.get("installed") or []
    order = cfg.get("order") or []
    hidden = cfg.get("hidden") or []
    for cid in chain:
        if cid not in inst:
            inst.append(cid)
        if cid not in order:
            order.append(cid)
        # nouvelle install : masquée (une MAJ ne re-masque pas un addon affiché)
        if cid not in _REGISTRY and cid not in hidden:
            hidden.append(cid)
    cfg["installed"], cfg["order"], cfg["hidden"] = inst, order, hidden
    _save(cfg)

    _deferred_restart()
    return jsonify({"ok": True, "id": aid, "version": version,
                    "installed": chain,
                    "action": "maj" if aid in _REGISTRY else "install",
                    "restarting": True})


def _uninstall_one_addon(aid, purge):
    """Retire UN addon du store (code + cache + config d'affichage), sans restart.

    Retourne (ok: bool, reason: str). Ne touche jamais au socle. Avec ``purge``,
    supprime aussi le data_dir et la config du module (repart de zéro).
    """
    m = _REGISTRY.get(aid)
    if not m or not (m.get("_dir") or "").startswith(_registry.ADDONS_DIR):
        return False, f"{aid} : absent du store"
    target = os.path.join(_registry.ADDONS_DIR, aid)
    if os.path.realpath(target) != os.path.realpath(m["_dir"]):
        return False, f"{aid} : chemin incohérent"
    try:
        shutil.rmtree(target)
    except OSError as e:
        return False, f"{aid} : suppression échouée : {e}"

    import glob
    for z in glob.glob(os.path.join(_registry.ADDONS_DIR, ".cache", f"{aid}-*.zip")):
        try:
            os.remove(z)
        except OSError:
            pass

    cfg = _load()
    for key in ("installed", "order", "hidden"):
        if isinstance(cfg.get(key), list):
            cfg[key] = [x for x in cfg[key] if x != aid]
    if purge:
        data = os.path.join(_registry.DATA_DIR, aid)
        if os.path.realpath(data).startswith(os.path.realpath(_registry.DATA_DIR)):
            shutil.rmtree(data, ignore_errors=True)
        mods = cfg.get("modules")
        if isinstance(mods, dict):
            mods.pop(aid, None)
    _save(cfg)
    return True, ""


def _resolve_installed_dependents(aid, _seen=None):
    """Addons chargés qui dépendent de `aid` (transitivement), ordonnés
    dépendants-d'abord (pour une désinstallation en cascade sûre : on retire
    ce qui dépend avant ce dont ça dépend). Protégé contre les cycles.
    """
    if _seen is None:
        _seen = set()
    out = []
    for oid, om in _REGISTRY.items():
        if oid == aid or oid in _seen:
            continue
        if aid in (om.get("requires") or []):
            _seen.add(oid)
            out.extend(_resolve_installed_dependents(oid, _seen))
            out.append(oid)
    return out


@app.route("/api/store/uninstall", methods=["POST"])
@require_admin
def api_store_uninstall():
    """Désinstalle un addon du store. Ne touche jamais au socle (registry/).

    Retire toujours le code (/opt/panda/addons/<id>) et les zips en cache.
    Le paramètre ``purge`` décide du sort des configurations :
      - purge=False (défaut) : data_dir et config du module PRÉSERVÉS — une
        réinstallation ultérieure retrouve les réglages, utilisable de suite.
      - purge=True : data_dir + config du module supprimés (repart de zéro).

    Garde de dépendances : si des addons installés requièrent la cible, la
    désinstallation est REFUSÉE (409 + liste), sauf ``cascade=true`` qui retire
    d'abord tous les dépendants puis la cible (un seul restart).
    """
    body = request.get_json(silent=True) or {}
    aid = body.get("id", "")
    purge = bool(body.get("purge"))
    cascade = bool(body.get("cascade"))
    if not _ID_RE.match(aid or ""):
        return jsonify({"ok": False, "reason": "id invalide"}), 400

    m = _REGISTRY.get(aid)
    if not m or not (m.get("_dir") or "").startswith(_registry.ADDONS_DIR):
        return jsonify({"ok": False, "reason":
                        "addon absent du store (socle non désinstallable)"}), 409

    # dépendants installés (transitifs) : addons qui requièrent la cible
    dependents = _resolve_installed_dependents(aid)
    if dependents and not cascade:
        names = [_REGISTRY[d].get("name", d) for d in dependents]
        return jsonify({"ok": False, "reason": "dépendants installés",
                        "dependents": dependents, "dependent_names": names,
                        "message": (m.get("name", aid) + " est requis par : "
                                    + ", ".join(names) + ".")}), 409

    # cascade : tous les dépendants doivent être du store (désinstallables) ;
    # un dépendant du socle ne peut pas être retiré → on refuse proprement.
    if dependents:  # cascade == True à ce stade
        socle_dep = [d for d in dependents
                     if not (_REGISTRY.get(d, {}).get("_dir") or "")
                     .startswith(_registry.ADDONS_DIR)]
        if socle_dep:
            names = [_REGISTRY[d].get("name", d) for d in socle_dep]
            return jsonify({"ok": False, "reason":
                            "dépendant(s) du socle non désinstallable(s) : "
                            + ", ".join(names)}), 409

    # ordre : dépendants d'abord, cible en dernier ; un seul restart au bout
    chain = dependents + [aid]
    removed = []
    for cid in chain:
        ok, reason = _uninstall_one_addon(cid, purge)
        if not ok:
            return jsonify({"ok": False, "reason": reason, "removed": removed}), 500
        removed.append(cid)

    _deferred_restart()
    return jsonify({"ok": True, "id": aid, "removed": chain,
                    "purged": purge, "restarting": True})


@app.route("/api/config", methods=["GET", "POST"])
@require_auth
def api_config():
    if request.method == "POST" and not _is_admin():
        return jsonify(error="admin_required"), 403
    cfg = _load()
    if request.method == "POST":
        incoming = request.get_json(force=True, silent=True) or {}
        theme_before = cfg.get("theme") or "dark"
        for k, v in incoming.items():
            if k in ALLOWED_KEYS:
                cfg[k] = v
        _save(cfg)
        # Si le thème a changé, propage-le au clavier tactile (Squeekboard),
        # en tâche de fond pour ne pas ralentir la réponse.
        theme_after = cfg.get("theme") or "dark"
        if theme_after != theme_before:
            import threading
            threading.Thread(target=_kbd_apply_theme, args=(theme_after,),
                             daemon=True).start()
        return jsonify(ok=True)
    return jsonify(_public(cfg))


# --- Modules ----------------------------------------------------------------
# Patron réutilisable : un module = une fonction qui renvoie du JSON,
# exposée derrière l'auth. Les suivants (kuma, kitchenowl, instagram) suivront
# exactement cette forme.

def _primary_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))  # IP routable quelconque, aucun paquet réel
            return s.getsockname()[0]
    except OSError:
        return "n/a"


def _cpu_temp():
    try:
        temps = psutil.sensors_temperatures()
    except (AttributeError, OSError):
        return None
    for key in ("cpu_thermal", "coretemp", "k10temp", "acpitz"):
        if temps.get(key):
            return round(temps[key][0].current, 1)
    for arr in temps.values():
        if arr:
            return round(arr[0].current, 1)
    return None


def _uptime():
    secs = int(time.time() - psutil.boot_time())
    d, h, m = secs // 86400, (secs % 86400) // 3600, (secs % 3600) // 60
    if d:
        return f"{d} j {h} h"
    if h:
        return f"{h} h {m} min"
    return f"{m} min"


_CPU_STATE = {"t": 0.0, "v": None, "idle": None, "total": None}


def _read_proc_stat():
    """Somme idle et total des jiffies CPU depuis /proc/stat (Linux)."""
    with open("/proc/stat") as f:
        parts = f.readline().split()
    vals = [int(x) for x in parts[1:]]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)   # idle + iowait
    total = sum(vals)
    return idle, total


def _cpu_pct():
    """Charge CPU globale et stable, calculée depuis /proc/stat.

    On mesure le delta entre deux lectures espacées : contrairement à
    psutil.cpu_percent (état par processus, incohérent avec plusieurs workers
    gunicorn), /proc/stat est global au système. Cache 2 s pour éviter de
    relire trop souvent ; jamais de valeur d'amorçage 0 qui « saute ».
    """
    now = time.time()
    if now - _CPU_STATE["t"] < 2.0 and _CPU_STATE.get("v") is not None:
        return _CPU_STATE["v"]
    try:
        idle, total = _read_proc_stat()
    except (OSError, ValueError, IndexError):
        return _CPU_STATE.get("v") or 0.0
    pidle, ptotal = _CPU_STATE.get("idle"), _CPU_STATE.get("total")
    _CPU_STATE["idle"], _CPU_STATE["total"], _CPU_STATE["t"] = idle, total, now
    if pidle is None or ptotal is None or total == ptotal:
        # première lecture : pas de delta encore fiable, on garde l'ancienne
        return _CPU_STATE.get("v") or 0.0
    dt = total - ptotal
    di = idle - pidle
    pct = round(max(0.0, min(100.0, (1 - di / dt) * 100)), 1)
    _CPU_STATE["v"] = pct
    return pct


@app.route("/api/system")
@require_auth
def api_system():
    vm = psutil.virtual_memory()
    du = psutil.disk_usage("/")
    return jsonify(
        version=APP_VERSION,
        cpu=_cpu_pct(),
        ram={"used_gb": round(vm.used / 1e9, 1),
             "total_gb": round(vm.total / 1e9, 1),
             "pct": round(vm.percent)},
        disk={"used_gb": round(du.used / 1e9),
              "total_gb": round(du.total / 1e9),
              "pct": round(du.percent)},
        temp=_cpu_temp(),
        uptime=_uptime(),
        hostname=socket.gethostname(),
        ip=_primary_ip(),
    )


SECRET_RE = _re.compile(r"key|token|pass|secret", _re.I)


def _redact(cfg):
    """Masque les valeurs sensibles pour les vues non-admin, mais indique
    leur présence : `has_apikey`, `has_token`… (les vues en ont besoin)."""
    out = {}
    for k, v in cfg.items():
        if SECRET_RE.search(k):
            out[k] = ""
            out["has_" + k] = bool(v)
        else:
            out[k] = v
    return out


@app.route("/api/modules/<mid>", methods=["GET", "POST"])
@require_auth
def api_modules(mid):
    if mid not in ADDON_IDS:
        return jsonify(error="unknown module"), 404
    if request.method == "POST" and not _is_admin():
        return jsonify(error="admin_required"), 403
    cfg = _load()
    mods = cfg.setdefault("modules", {})
    if request.method == "POST":
        data = request.get_json(force=True, silent=True) or {}
        clean = {}
        for k, v in list(data.items())[:20]:
            if isinstance(v, str):
                clean[str(k)[:40]] = v[:500]
            elif isinstance(v, (int, float, bool)):
                clean[str(k)[:40]] = v
        mods[mid] = clean
        # KitchenOwl : les 5 addons cuisine partagent la même connexion.
        # On propage url/token/household dès qu'ils sont renseignés quelque part.
        KITCHEN = ("stock", "congelateur", "courses", "recettes", "repas")
        if mid in KITCHEN and clean.get("url") and clean.get("token"):
            for other in KITCHEN:
                if other == mid:
                    continue
                o = dict(mods.get(other, {}))
                o["url"] = clean["url"]
                o["token"] = clean["token"]
                if clean.get("household"):
                    o["household"] = clean["household"]
                mods[other] = o
        _save(cfg)
        return jsonify(ok=True)
    mod = mods.get(mid, {})
    return jsonify(mod if _is_admin() else _redact(mod))


def _test_module(mid, c):
    """Teste la connexion d'un module avec les valeurs fournies (non sauvées)."""
    # Contrat SDK : si l'addon a un backend chargé exposant test(sdk, cfg),
    # c'est lui qui teste — avant la chaîne interne. (Documenté dans le SDK,
    # branché ici : c'était le chaînon manquant du lot D.)
    _b = _ADDON_BACKENDS.get(mid)
    if _b and callable(getattr(_b["module"], "test", None)):
        try:
            return _b["module"].test(_b["sdk"], c)
        except Exception as e:
            return False, f"backend addon ✗ ({type(e).__name__}: {e})"[:160]
    url = (c.get("url") or "").rstrip("/")
    try:
        if mid == "wifi":
            w = _wifi_status()
            if w.get("ok"):
                return True, (f"WiFi ✓ — {w['device']} ({w['state']}), "
                              f"{len(w['networks'])} réseau(x) détecté(s)")
            return False, f"WiFi ✗ ({w.get('reason')})"
        if mid == "bluetooth":
            b = _bt_devices()
            if b.get("ok"):
                return True, f"Bluetooth ✓ — {len(b['devices'])} appareil(s) appairé(s)"
            return False, f"Bluetooth ✗ ({b.get('reason')})"
        if mid == "maj":
            u = _updates()
            if u.get("ok"):
                return True, (f"APT ✓ — {u['count']} mise(s) à jour"
                              + (f", dont {u['security']} de sécurité" if u["security"] else ""))
            return False, f"APT ✗ ({u.get('reason')})"
        dm = _REGISTRY.get(mid)
        if dm and dm.get("type") == "declarative":
            res = _decl_exec(mid, dm, c)
            if res.get("ok"):
                counts = ", ".join(f"{k} : {len(v)}" for k, v in (res.get("data") or {}).items()
                                   if isinstance(v, list)) or "réponse OK"
                return True, f"{dm['name']} ✓ — {counts}"
            return False, f"{dm['name']} ✗ ({res.get('reason')})"
        # générique : simple joignabilité
        if url:
            r = requests.get(url, timeout=4, verify=False, allow_redirects=True)
            return (r.status_code < 500), f"HTTP {r.status_code}"
        return False, "Aucune URL à tester"
    except requests.exceptions.RequestException as e:
        return False, f"Injoignable ({type(e).__name__})"


@app.route("/api/modules/<mid>/test", methods=["POST"])
@require_auth
@require_admin
def api_modules_test(mid):
    if mid not in ADDON_IDS:
        return jsonify(ok=False, msg="module inconnu"), 404
    ok, msg = _test_module(mid, request.get_json(force=True, silent=True) or {})
    return jsonify(ok=ok, msg=msg)


# Calendrier de culture — potager français, climat tempéré (repères, à adapter)










# ---------------------------------------------------------------------------
# Système : WiFi, Bluetooth, mises à jour.
# Règles : commandes en liste blanche, jamais de shell, réservé à l'admin.
# ---------------------------------------------------------------------------
_SYS_BIN = {
    "systemctl": "/usr/bin/systemctl",
    "timedatectl": "/usr/bin/timedatectl",
    "xset": "/usr/bin/xset",
    "xrandr": "/usr/bin/xrandr",
    "wlr-randr": "/usr/bin/wlr-randr",
    "nmcli": "/usr/bin/nmcli",
    "bluetoothctl": "/usr/bin/bluetoothctl",
    "rfkill": "/usr/sbin/rfkill",
    "wpctl": "/usr/bin/wpctl",
    "amixer": "/usr/bin/amixer",
    "apt": "/usr/bin/apt-get",
    "aptlist": "/usr/bin/apt",
}


def _bin(name):
    p = _SYS_BIN.get(name)
    if p and os.path.exists(p):
        return p
    return shutil.which(name.replace("aptlist", "apt"))


def _run(args, timeout=20, sudo=False, env=None):
    """Exécute une commande de la liste blanche. Retourne (ok, sortie)."""
    exe = _bin(args[0])
    if not exe:
        return False, f"{args[0]} introuvable sur cette machine"
    cmd = ([_bin("sudo") or "/usr/bin/sudo", "-n", exe] if sudo else [exe]) + list(args[1:])
    penv = dict(os.environ)
    # Les commandes audio (wpctl, speaker-test) ont besoin de XDG_RUNTIME_DIR
    # pour trouver le socket PipeWire de la session. gunicorn ne propage pas
    # toujours cette variable à ses workers : on la reconstruit au besoin.
    if args and args[0] in ("wpctl", "speaker-test", "amixer") and "XDG_RUNTIME_DIR" not in penv:
        try:
            penv["XDG_RUNTIME_DIR"] = f"/run/user/{os.getuid()}"
        except Exception:
            pass
    if env:
        penv.update(env)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           check=False, env=penv)
    except FileNotFoundError:
        return False, "commande introuvable"
    except subprocess.TimeoutExpired:
        return False, "délai dépassé"
    out = (p.stdout or "") + (p.stderr or "")
    if p.returncode != 0:
        if "password" in out.lower() or "sudo:" in out.lower():
            return False, ("sudo demande un mot de passe — ajoute une règle NOPASSWD "
                           "(voir la documentation de l'addon)")
        return False, out.strip()[:200] or f"code {p.returncode}"
    return True, out


def _wifi_status():
    ok, out = _run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"])
    if not ok:
        return {"ok": False, "reason": out}
    dev = None
    for line in out.strip().split("\n"):
        f = line.split(":")
        if len(f) >= 4 and f[1] == "wifi":
            dev = {"device": f[0], "state": f[2], "connection": f[3]}
            break
    if not dev:
        return {"ok": False, "reason": "aucune interface WiFi"}
    ok, out = _run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL,SECURITY", "device", "wifi", "list"])
    nets = []
    if ok:
        seen = set()
        for line in out.strip().split("\n"):
            f = line.split(":")
            if len(f) < 4 or not f[1] or f[1] in seen:
                continue
            seen.add(f[1])
            nets.append({"active": f[0] == "yes", "ssid": f[1],
                         "signal": int(f[2] or 0),
                         "secure": bool(f[3] and f[3] != "--")})
        nets.sort(key=lambda x: (not x["active"], -x["signal"]))
    okr, outr = _run(["nmcli", "radio", "wifi"], timeout=6)
    radio_on = okr and outr.strip().lower().startswith("enabled")
    autoconnect = None
    conn = dev.get("connection")
    if conn and conn != "--":
        oka, outa = _run(["nmcli", "-t", "-f", "connection.autoconnect",
                          "con", "show", conn], timeout=6)
        if oka:
            autoconnect = "yes" in outa.lower()
    return {"ok": True, **dev, "radio": radio_on,
            "autoconnect": autoconnect, "networks": nets[:20]}


_BL_ROOT = "/sys/class/backlight"


def _backlight():
    """Premier rétroéclairage exposé par le noyau (RPi : rpi_backlight)."""
    try:
        for d in sorted(os.listdir(_BL_ROOT)):
            p = os.path.join(_BL_ROOT, d)
            if os.path.isfile(os.path.join(p, "brightness")):
                return p
    except OSError:
        pass
    return None


@app.route("/api/system/display")
@require_auth
@require_admin
def api_display():
    """État réel de l'écran : luminosité, veille, rotation, heure."""
    out = {"ok": True}
    bl = _backlight()
    out["backlight"] = bool(bl)
    if bl:
        try:
            with open(os.path.join(bl, "brightness")) as f:
                cur = int(f.read().strip())
            with open(os.path.join(bl, "max_brightness")) as f:
                mx = int(f.read().strip()) or 1
            out["brightness"] = round(cur / mx * 100)
        except (OSError, ValueError):
            out["backlight"] = False
    if not out["backlight"]:
        # Pas de rétroéclairage pilotable : atténuation logicielle (overlay
        # côté interface). On renvoie la valeur mémorisée en config.
        out["brightness"] = _load().get("brightness", 100)
        out["dim_software"] = True
    ok, txt = _run(["timedatectl", "show", "-p", "NTP", "-p", "Timezone"], timeout=6)
    if ok:
        kv = dict(l.split("=", 1) for l in txt.strip().split("\n") if "=" in l)
        out["ntp"] = kv.get("NTP") == "yes"
        out["timezone"] = kv.get("Timezone", "")
    out["display"] = bool(os.environ.get("DISPLAY") or
                          os.environ.get("WAYLAND_DISPLAY") or _bin("wlr-randr"))
    return jsonify(out)


@app.route("/api/system/brightness", methods=["POST"])
@require_auth
@require_admin
def api_brightness():
    j = request.get_json(force=True, silent=True) or {}
    try:
        pct = int(j.get("value"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "reason": "valeur invalide"}), 400
    if not 5 <= pct <= 100:
        return jsonify({"ok": False, "reason": "entre 5 et 100 %"}), 400
    bl = _backlight()
    if not bl:
        # Mode logiciel : l'interface applique un voile d'atténuation.
        # On mémorise la valeur pour la restaurer au démarrage.
        cfg = _load()
        cfg["brightness"] = pct
        _save(cfg)
        return jsonify({"ok": True, "value": pct, "mode": "software"})
    try:
        with open(os.path.join(bl, "max_brightness")) as f:
            mx = int(f.read().strip()) or 1
        with open(os.path.join(bl, "brightness"), "w") as f:
            f.write(str(max(1, round(mx * pct / 100))))
    except OSError as e:
        return jsonify({"ok": False,
                        "reason": f"écriture refusée ({e.strerror}) — règle udev manquante ?"})
    cfg = _load()
    cfg["brightness"] = pct
    _save(cfg)
    return jsonify({"ok": True, "value": pct})


# ---------------------------------------------------------------------------
# Mise à jour de Panda depuis une release GitHub *signée* (TheWorms/panda).
# La vérification lit la version depuis release.json (authentifié Ed25519 par
# PANDA_RELEASE_PUBKEY), pas une simple lecture du code source : l'interface et
# l'outil panda-update parlent de la même version, elle-même prouvée.
# L'application de la MAJ passe par /usr/local/bin/panda-update (sudoers dédié
# NOPASSWD) : téléchargement + vérif signature/sha256, bascule atomique,
# restart du service, rollback si le kiosk ne repart pas — détaché pour
# survivre au restart. Détails : docs/self-update.md.
# ---------------------------------------------------------------------------
_RELEASE_BASE = "https://github.com/TheWorms/panda/releases/latest/download/"
_SELFUPD_BIN = "/usr/local/bin/panda-update"


@app.route("/api/system/selfupdate")
@require_auth
@require_admin
def api_selfupdate_check():
    """Compare la version locale à la dernière release signée publiée.

    La version distante vient de release.json (téléchargé + signature Ed25519
    vérifiée), pas d'une lecture brute du code : la même version prouvée est
    ensuite installée par panda-update."""
    if not PANDA_RELEASE_PUBKEY:
        return jsonify({"ok": False,
                        "reason": "mise à jour signée non configurée sur ce socle"})
    try:
        r = requests.get(_RELEASE_BASE + "release.json", timeout=8)
        r.raise_for_status()
        blob = r.content
        rs = requests.get(_RELEASE_BASE + "release.json.sig", timeout=8)
        rs.raise_for_status()
    except requests.RequestException as e:
        return jsonify({"ok": False, "reason": f"GitHub injoignable ({type(e).__name__})"})
    if not _verify_release_sig(blob, rs.text):
        return jsonify({"ok": False, "reason": "signature de la release invalide — refusée"})
    try:
        latest = str(json.loads(blob.decode("utf-8"))["version"])
    except (ValueError, KeyError, UnicodeDecodeError):
        return jsonify({"ok": False, "reason": "release.json illisible"})
    upd = _semver(latest) > _semver(APP_VERSION)
    ready = os.path.isfile(_SELFUPD_BIN)
    return jsonify({"ok": True, "current": APP_VERSION, "latest": latest,
                    "update": upd, "updater_ready": ready})


@app.route("/api/system/selfupdate", methods=["POST"])
@require_auth
@require_admin
def api_selfupdate_run():
    """Lance la mise à jour (détachée : survit au restart du service)."""
    if not os.path.isfile(_SELFUPD_BIN):
        return jsonify({"ok": False,
                        "reason": "outil panda-update absent — installe-le d'abord (voir doc)"})
    try:
        subprocess.Popen(["sudo", "-n", _SELFUPD_BIN],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    except OSError as e:
        return jsonify({"ok": False, "reason": f"lancement impossible ({e})"})
    return jsonify({"ok": True,
                    "msg": "Mise à jour lancée — le kiosk redémarre dans quelques instants."})


@app.route("/api/system/veille", methods=["POST"])
@require_auth
@require_admin
def api_veille():
    """Veille : N minutes d'inactivité avant extinction (0 = jamais).

    Depuis 1.0.0 la temporisation est pilotée par le kiosk (JS) qui appelle
    /api/system/screen — xset/DPMS ne fonctionnait pas sous labwc/Wayland."""
    j = request.get_json(force=True, silent=True) or {}
    try:
        mins = int(j.get("minutes"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "reason": "valeur invalide"}), 400
    if not 0 <= mins <= 720:
        return jsonify({"ok": False, "reason": "entre 0 et 720 minutes"}), 400
    cfg = _load()
    cfg["veille"] = mins
    _save(cfg)
    return jsonify({"ok": True, "value": mins})


def _wlr_env_out():
    """Détecte le socket Wayland et la première sortie (pattern rotation)."""
    wd = os.environ.get("WAYLAND_DISPLAY")
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    if not wd and runtime:
        for cand in ("wayland-1", "wayland-0"):
            if os.path.exists(os.path.join(runtime, cand)):
                wd = cand
                break
    if not (_bin("wlr-randr") and wd):
        return None, None
    env = dict(os.environ, WAYLAND_DISPLAY=wd)
    okl, txt = _run(["wlr-randr"], timeout=6, env=env)
    out = None
    if okl:
        for line in txt.split("\n"):
            if line and not line.startswith(" "):
                out = line.split()[0]
                break
    return env, out


@app.route("/api/system/screen", methods=["POST"])
@require_auth
def api_screen():
    """Allume ou éteint la sortie (veille pilotée par le kiosk, Wayland).

    Pas de require_admin : le rallumage au premier toucher doit marcher
    pour n'importe qui devant l'écran."""
    j = request.get_json(force=True, silent=True) or {}
    on = bool(j.get("on"))
    env, out = _wlr_env_out()
    if not out:
        return jsonify({"ok": False, "reason": "wlr-randr ou sortie introuvable"})
    ok, err = _run(["wlr-randr", "--output", out, "--on" if on else "--off"],
                   timeout=8, env=env)
    return jsonify({"ok": ok, "reason": "" if ok else err})


@app.route("/api/system/timesync")
@require_auth
def api_timesync():
    """État réel de la synchronisation de l'heure (timedatectl, sans sudo)."""
    ok, out = _run(["timedatectl", "show", "-p", "NTP", "-p", "NTPSynchronized"],
                   timeout=6)
    ntp = synced = None
    if ok:
        for line in out.split("\n"):
            if line.startswith("NTP="):
                ntp = line.strip().endswith("yes")
            elif line.startswith("NTPSynchronized="):
                synced = line.strip().endswith("yes")
    return jsonify({"ok": ok, "ntp": ntp, "synced": synced})


@app.route("/api/system/timesync", methods=["POST"])
@require_auth
@require_admin
def api_timesync_enable():
    """Réactive la synchronisation NTP (après un réglage manuel ou une panne)."""
    ok, out = _run(["timedatectl", "set-ntp", "true"], timeout=8, sudo=True)
    if ok:
        cfg = _load()
        cfg["ntp"] = True
        _save(cfg)
    return jsonify({"ok": ok, "reason": "" if ok else out})


@app.route("/api/system/rotation", methods=["POST"])
@require_auth
@require_admin
def api_rotation():
    j = request.get_json(force=True, silent=True) or {}
    rot = (j.get("value") or "").strip()
    # correspondance interface -> transform wlr-randr / WLR_OUTPUT_TRANSFORM
    WLR = {"normal": "normal", "left": "90", "right": "270", "inverted": "180"}
    if rot not in WLR:
        return jsonify({"ok": False, "reason": "rotation inconnue"}), 400
    # La rotation est toujours persistée : elle est réappliquée au prochain
    # démarrage du kiosk via WLR_OUTPUT_TRANSFORM (drop-in systemd).
    cfg = _load()
    cfg["rotation"] = rot
    _save(cfg)
    applied = False
    note = ""
    # Application à chaud si wlr-randr et un socket Wayland sont disponibles.
    wd = os.environ.get("WAYLAND_DISPLAY")
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    if not wd and runtime:
        # le service kiosk tourne sous un autre XDG_RUNTIME_DIR ; on tente wayland-0/1
        for cand in ("wayland-1", "wayland-0"):
            if os.path.exists(os.path.join(runtime, cand)):
                wd = cand
                break
    if _bin("wlr-randr") and wd:
        env = dict(os.environ, WAYLAND_DISPLAY=wd)
        okl, txt = _run(["wlr-randr"], timeout=6, env=env)
        out = None
        if okl:
            for line in txt.split("\n"):
                if line and not line.startswith(" "):
                    out = line.split()[0]
                    break
        if out:
            okr, err = _run(["wlr-randr", "--output", out,
                             "--transform", WLR[rot]], timeout=8, env=env)
            applied = okr
            if not okr:
                note = err
    if not applied:
        note = note or "appliqué au prochain démarrage du kiosk (redémarrage conseillé)"
    return jsonify({"ok": True, "value": rot, "applied": applied, "note": note})


@app.route("/api/system/time", methods=["POST"])
@require_auth
@require_admin
def api_time():
    """Réglage manuel de la date et de l'heure (NTP désactivé)."""
    j = request.get_json(force=True, silent=True) or {}
    d = (j.get("date") or "").strip()
    t = (j.get("time") or "").strip()
    if not _re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) or not _re.fullmatch(r"\d{2}:\d{2}", t):
        return jsonify({"ok": False, "reason": "date ou heure invalide"}), 400
    ok, out = _run(["timedatectl", "set-ntp", "false"], timeout=8, sudo=True)
    if not ok:
        return jsonify({"ok": False, "reason": out})
    ok, out = _run(["timedatectl", "set-time", f"{d} {t}:00"], timeout=8, sudo=True)
    if not ok:
        return jsonify({"ok": False, "reason": out})
    return jsonify({"ok": True})


@app.route("/api/system/ntp", methods=["POST"])
@require_auth
@require_admin
def api_ntp():
    j = request.get_json(force=True, silent=True) or {}
    on = bool(j.get("enabled"))
    ok, out = _run(["timedatectl", "set-ntp", "true" if on else "false"],
                   timeout=8, sudo=True)
    if not ok:
        return jsonify({"ok": False, "reason": out})
    return jsonify({"ok": True, "enabled": on})


def _tz_list():
    ok, out = _run(["timedatectl", "list-timezones"], timeout=8)
    if ok and out.strip():
        return [l.strip() for l in out.strip().split("\n") if l.strip()]
    try:
        import zoneinfo
        return sorted(zoneinfo.available_timezones())
    except Exception:
        return []


@app.route("/api/system/timezones")
@require_auth
@require_admin
def api_timezones():
    return jsonify({"ok": True, "timezones": _tz_list()})


@app.route("/api/system/timezone", methods=["POST"])
@require_auth
@require_admin
def api_timezone():
    j = request.get_json(force=True, silent=True) or {}
    tz = (j.get("value") or "").strip()
    if not _re.fullmatch(r"[A-Za-z0-9_+\-/]{1,64}", tz) or tz not in _tz_list():
        return jsonify({"ok": False, "reason": "fuseau inconnu"}), 400
    ok, out = _run(["timedatectl", "set-timezone", tz], timeout=8, sudo=True)
    if not ok:
        return jsonify({"ok": False, "reason": out})
    return jsonify({"ok": True, "timezone": tz})


_CONN_CACHE = {"t": 0.0, "data": None}


def _conn_status():
    """État synthétique WiFi + Bluetooth pour la barre du haut.

    Léger et tolérant : machine sans nmcli/bluetoothctl (LXC) -> present=False,
    jamais d'erreur. Cache court pour ne pas marteler les outils système.
    """
    now = time.time()
    if _CONN_CACHE["data"] and now - _CONN_CACHE["t"] < 8:
        return _CONN_CACHE["data"]

    wifi = {"present": False, "enabled": False, "connected": False, "ssid": ""}
    ok, out = _run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"],
                   timeout=6)
    if ok:
        for line in out.strip().split("\n"):
            f = line.split(":")
            if len(f) >= 4 and f[1] == "wifi":
                wifi["present"] = True
                wifi["connected"] = f[2] == "connected"
                wifi["ssid"] = f[3] if wifi["connected"] else ""
                break
        if wifi["present"]:
            ok2, out2 = _run(["nmcli", "radio", "wifi"], timeout=6)
            wifi["enabled"] = ok2 and "enabled" in out2

    bt = {"present": False, "powered": False, "connected": False, "name": ""}
    ok, out = _run(["bluetoothctl", "show"], timeout=6)
    if ok and "Controller" in out:
        bt["present"] = True
        bt["powered"] = "Powered: yes" in out
        if bt["powered"]:
            # 'devices Connected' liste les appareils réellement connectés
            # (plus fiable que 'info' sans argument, qui dépend d'un appareil
            # « par défaut » pas toujours défini).
            okc, outc = _run(["bluetoothctl", "devices", "Connected"], timeout=6)
            if okc:
                m = _re.search(r"Device ([0-9A-F:]{17}) (.+)", outc)
                if m:
                    bt["connected"] = True
                    nm = m.group(2).strip()
                    bt["name"] = nm if nm.replace("-", ":").upper() != m.group(1).upper() else ""

    data = {"ok": True, "wifi": wifi, "bt": bt}
    _CONN_CACHE.update(t=now, data=data)
    return data


@app.route("/api/system/connstatus")
@require_auth
def api_connstatus():
    return jsonify(_conn_status())


@app.route("/api/system/wifi")
@require_auth
@require_admin
def api_wifi():
    return jsonify(_wifi_status())


@app.route("/api/system/wifi/connect", methods=["POST"])
@require_auth
@require_admin
def api_wifi_connect():
    j = request.get_json(force=True, silent=True) or {}
    ssid = (j.get("ssid") or "").strip()[:64]
    pw = (j.get("password") or "").strip()[:80]
    if not ssid:
        return jsonify({"ok": False, "reason": "SSID manquant"}), 400
    # Tentative simple d'abord (nmcli déduit la sécurité dans la plupart des
    # cas). Crée un profil persistant → reconnexion automatique au démarrage.
    args = ["nmcli", "device", "wifi", "connect", ssid]
    if pw:
        args += ["password", pw]
    ok, out = _run(args, timeout=45, sudo=True)
    # Repli : sur certaines versions (Trixie), nmcli refuse la forme courte
    # avec « key-mgmt property is missing ». On crée alors explicitement un
    # profil WPA-PSK, ce qui lève l'ambiguïté et reste persistant.
    if not ok and pw and "key-mgmt" in (out or "").lower():
        _run(["nmcli", "connection", "delete", ssid], timeout=15, sudo=True)
        add = ["nmcli", "connection", "add", "type", "wifi",
               "con-name", ssid, "ifname", "*", "ssid", ssid,
               "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", pw,
               "connection.autoconnect", "yes"]
        ok2, out2 = _run(add, timeout=30, sudo=True)
        if ok2:
            ok, out = _run(["nmcli", "connection", "up", ssid],
                           timeout=45, sudo=True)
        else:
            ok, out = ok2, out2
    return jsonify({"ok": ok, "reason": None if ok else out})


@app.route("/api/system/wifi/autoconnect", methods=["POST"])
@require_auth
@require_admin
def api_wifi_autoconnect():
    """Active/désactive la reconnexion automatique du réseau connecté."""
    j = request.get_json(force=True, silent=True) or {}
    on = bool(j.get("on"))
    st = _wifi_status()
    conn = st.get("connection")
    if not conn or conn == "--":
        return jsonify({"ok": False, "reason": "aucun réseau connecté"})
    ok, out = _run(["nmcli", "con", "mod", conn,
                    "connection.autoconnect", "yes" if on else "no"],
                   timeout=15, sudo=True)
    return jsonify({"ok": ok, "reason": None if ok else out})


@app.route("/api/system/wifi/radio", methods=["POST"])
@require_auth
@require_admin
def api_wifi_radio():
    """Active ou désactive le module WiFi (nmcli radio wifi on/off).

    L'état est persisté au reboot par systemd-rfkill (activé à l'install), donc
    un WiFi coupé manuellement le reste après redémarrage.
    """
    j = request.get_json(force=True, silent=True) or {}
    on = bool(j.get("on"))
    ok, out = _run(["nmcli", "radio", "wifi", "on" if on else "off"],
                   timeout=15, sudo=True)
    return jsonify({"ok": ok, "reason": None if ok else out, "on": on})


@app.route("/api/system/wifi/disconnect", methods=["POST"])
@require_auth
@require_admin
def api_wifi_disconnect():
    """Déconnecte l'interface WiFi de son réseau courant."""
    st = _wifi_status()
    dev = st.get("device")
    if not dev:
        return jsonify({"ok": False, "reason": "aucune interface WiFi"}), 400
    ok, out = _run(["nmcli", "device", "disconnect", dev], timeout=20, sudo=True)
    return jsonify({"ok": ok, "reason": None if ok else out})


def _bt_devices():
    ok, out = _run(["bluetoothctl", "devices"], timeout=10)
    if not ok:
        return {"ok": False, "reason": out}
    devs = []
    for line in out.strip().split("\n"):
        m = _re.match(r"Device ([0-9A-F:]{17}) (.+)", line.strip())
        if m:
            mac, name = m.group(1), m.group(2).strip()
            paired = connected = False
            # profil détaillé par appareil : nom réel + état appairé/connecté
            oki, outi = _run(["bluetoothctl", "info", mac], timeout=6)
            if oki:
                paired = "Paired: yes" in outi
                connected = "Connected: yes" in outi
                if name.replace("-", ":").upper() == mac.upper():
                    nm = _re.search(r"Name:\s*(.+)", outi)
                    al = _re.search(r"Alias:\s*(.+)", outi)
                    real = (nm.group(1).strip() if nm else
                            (al.group(1).strip() if al else ""))
                    name = (real if real and real.replace("-", ":").upper() != mac.upper()
                            else "Appareil " + mac[-5:])
            devs.append({"mac": mac, "name": name,
                         "paired": paired, "connected": connected})
    # État de l'adaptateur (allumé/éteint)
    okp, outp = _run(["bluetoothctl", "show"], timeout=6)
    powered = okp and "Powered: yes" in outp
    return {"ok": True, "powered": powered, "devices": devs}


def _vol_tool():
    """Retourne l'outil de volume disponible : 'wpctl' (PipeWire) ou 'amixer'."""
    if _bin("wpctl"):
        return "wpctl"
    if _bin("amixer"):
        return "amixer"
    return None


def _volume_get():
    tool = _vol_tool()
    if tool == "wpctl":
        ok, out = _run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"], timeout=6)
        if ok:
            m = _re.search(r"([0-9]*\.?[0-9]+)", out)
            muted = "MUTED" in out.upper()
            if m:
                return {"ok": True, "volume": int(round(float(m.group(1)) * 100)),
                        "muted": muted, "tool": tool}
        return {"ok": False, "reason": out or "wpctl indisponible"}
    if tool == "amixer":
        ok, out = _run(["amixer", "sget", "Master"], timeout=6)
        if ok:
            m = _re.search(r"\[(\d+)%\]", out)
            muted = "[off]" in out
            if m:
                return {"ok": True, "volume": int(m.group(1)),
                        "muted": muted, "tool": tool}
        return {"ok": False, "reason": out or "amixer indisponible"}
    return {"ok": False, "reason": "Aucun contrôle audio (PipeWire/ALSA absent)"}


def _volume_set(vol):
    vol = max(0, min(150, int(vol)))
    tool = _vol_tool()
    if tool == "wpctl":
        ok, out = _run(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@",
                        f"{vol/100:.2f}", "-l", "1.5"], timeout=6)
        return {"ok": ok, "volume": vol, "reason": None if ok else out}
    if tool == "amixer":
        ok, out = _run(["amixer", "sset", "Master", f"{vol}%"], timeout=6)
        return {"ok": ok, "volume": vol, "reason": None if ok else out}
    return {"ok": False, "reason": "Aucun contrôle audio (PipeWire/ALSA absent)"}


def _audio_status():
    """État audio : sorties disponibles, sortie active, volume, codec BT."""
    tool = _vol_tool()
    out = {"ok": True, "tool": tool, "sinks": [], "default": None,
           "volume": None, "muted": False, "bt_codec": None}
    vg = _volume_get()
    if vg.get("ok"):
        out["volume"] = vg["volume"]; out["muted"] = vg.get("muted", False)
    if tool == "wpctl":
        okw, outw = _run(["wpctl", "status"], timeout=8)
        if okw:
            in_sinks = False
            for line in outw.split("\n"):
                if "Sinks:" in line:
                    in_sinks = True; continue
                if in_sinks:
                    if line.strip().startswith(("Sources:", "Filters:", "Streams:")) or "├─" in line and "Sink" not in line:
                        if "Sources" in line or "Filters" in line or "Streams" in line:
                            break
                    m = _re.search(r"(\*?)\s*(\d+)\.\s+(.+?)\s+\[vol", line)
                    if m:
                        sid, name = m.group(2), m.group(3).strip()
                        is_def = m.group(1) == "*"
                        out["sinks"].append({"id": sid, "name": name, "default": is_def})
                        if is_def:
                            out["default"] = sid
    # Codec Bluetooth actif (si un appareil BT est connecté)
    okb, outb = _run(["bluetoothctl", "devices", "Connected"], timeout=6)
    if okb and outb.strip():
        # le codec réel est visible via wpctl inspect, mais on reste simple
        out["bt_connected"] = True
    return out


_KEEPALIVE = {"proc": None}


def _keepalive_stop():
    p = _KEEPALIVE.get("proc")
    if p:
        try:
            p.terminate()
        except Exception:
            pass
        _KEEPALIVE["proc"] = None


def _keepalive_start():
    """Joue un signal quasi inaudible en boucle pour éviter que l'enceinte
    Bluetooth se mette en veille (et se déconnecte) faute de flux audio."""
    _keepalive_stop()
    # tonalité très basse fréquence et volume minimal, en boucle infinie.
    # speaker-test -t sine avec fréquence très basse ; sinon aplay d'un silence.
    exe = _bin("speaker-test") or shutil.which("speaker-test")
    try:
        import subprocess as _sp
        if exe:
            # 20 Hz quasi inaudible, volume géré par le sink ; boucle infinie
            _KEEPALIVE["proc"] = _sp.Popen(
                [exe, "-t", "sine", "-f", "20", "-l", "0"],
                stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
            return True, None
        return False, "speaker-test indisponible"
    except Exception as e:
        return False, f"{type(e).__name__}"[:60]


@app.route("/api/system/audio/keepalive", methods=["POST"])
@require_auth
@require_admin
def api_audio_keepalive():
    j = request.get_json(force=True, silent=True) or {}
    on = bool(j.get("on"))
    if on:
        ok, reason = _keepalive_start()
        return jsonify({"ok": ok, "reason": reason, "on": True})
    _keepalive_stop()
    return jsonify({"ok": True, "on": False})


_BROWSER = {"proc": None, "kbd": None}


def _browser_close():
    p = _BROWSER.get("proc")
    if p:
        try:
            p.terminate()
        except Exception:
            pass
        _BROWSER["proc"] = None
    # ceinture et bretelles : tue toute instance sur le profil dédié
    _run(["pkill", "-f", "panda-webview"], timeout=6)
    # masque le clavier virtuel (on revient sur Panda)
    _kbd_visible(False)


def _browser_open(url):
    """Lance une 2e instance Chromium (fenêtre par-dessus Panda) sur l'URL.

    Cage place cette fenêtre au-dessus du kiosk ; elle prend tout l'écran et
    toutes les entrées jusqu'à sa fermeture, puis on retombe sur Panda.
    """
    chrome = _bin("chromium") or _bin("chromium-browser") or shutil.which("chromium")
    if not chrome:
        return False, "chromium introuvable"
    _browser_close()
    # langue depuis les réglages (défaut fr-FR)
    lang = "fr-FR"
    theme = "dark"
    pw_store = False
    try:
        _c = _load()
        lang = (_c.get("lang") or "fr-FR")[:10]
        theme = _c.get("theme") or "dark"
        pw_store = _c.get("browserPw") is True
    except Exception:
        pass
    penv = dict(os.environ)
    penv["XDG_RUNTIME_DIR"] = f"/run/user/{os.getuid()}"
    penv["WAYLAND_DISPLAY"] = "wayland-0"
    penv["LANG"] = lang.replace("-", "_") + ".UTF-8"
    penv["LANGUAGE"] = lang
    import subprocess as _sp
    # Profil PERSISTANT (survit au reboot ; /tmp est volatile → réglages/mots
    # de passe perdus). Séparé de celui du kiosk, comme requis.
    profile_dir = os.path.expanduser("~/.local/share/panda-webview")
    try:
        os.makedirs(profile_dir, exist_ok=True)
    except OSError:
        profile_dir = "/tmp/panda-webview"   # repli si non créable
    try:
        flags = [
            chrome, "--ozone-platform=wayland",
            "--enable-wayland-ime",               # active le clavier virtuel Wayland
            "--class=panda-webview",              # marqueur pour pkill
            f"--user-data-dir={profile_dir}",     # profil persistant (voir plus haut)
            "--no-first-run", "--disable-translate", f"--lang={lang}",
            "--touch-events=enabled",
            # Mémorisation des mots de passe : sans trousseau système, 'basic'
            # (chiffrement local faible) permet la persistance ; sinon 'gnome'
            # échouerait à redéchiffrer au reboot → mots de passe perdus.
            "--password-store=" + ("basic" if pw_store else "gnome"),
        ]
        if theme != "light":
            flags.append("--force-dark-mode")     # interface Chromium sombre
        flags += ["--start-maximized", "--new-window", url]
        _BROWSER["proc"] = _sp.Popen(flags,
                                     stdout=_sp.DEVNULL, stderr=_sp.DEVNULL,
                                     env=penv)
        # Affiche le clavier virtuel (l'utilisateur va taper URL / formulaires).
        _kbd_visible(True)
        # Quand l'utilisateur ferme Chromium (croix ✕), on masque le clavier.
        import threading

        def _watch(proc):
            try:
                proc.wait()
            except Exception:
                pass
            _kbd_visible(False)

        threading.Thread(target=_watch, args=(_BROWSER["proc"],), daemon=True).start()
        return True, None
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"[:120]


def _kbd_env():
    """Environnement pour parler au clavier (DBus session + Wayland)."""
    penv = dict(os.environ)
    uid = os.getuid()
    penv["XDG_RUNTIME_DIR"] = f"/run/user/{uid}"
    penv["WAYLAND_DISPLAY"] = "wayland-0"
    penv["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path=/run/user/{uid}/bus"
    return penv


def _kbd_visible(show):
    """Affiche/masque le clavier : Squeekboard via DBus, repli wvkbd (signaux)."""
    penv = _kbd_env()
    import subprocess as _sp
    # 1) Squeekboard (DBus sm.puri.OSK0) — le clavier principal
    try:
        r = _sp.run(["dbus-send", "--session", "--dest=sm.puri.OSK0",
                     "/sm/puri/OSK0", "sm.puri.OSK0.SetVisible",
                     "boolean:" + ("true" if show else "false")],
                    env=penv, capture_output=True, timeout=6)
        if r.returncode == 0:
            return True
    except Exception:
        pass
    # 2) Repli : wvkbd par signaux (si Squeekboard absent)
    _run(["pkill", "--signal", "12" if show else "10", "-f", "wvkbd-mobintl"],
         timeout=6)
    return True


def _kbd_apply_theme(theme):
    """Applique le thème (clair/sombre) au système ET au clavier tactile.

    1. Préférence GTK système (~/.config/gtk-3.0/settings.ini + gsettings) :
       c'est elle que Chromium lit pour son interface claire/sombre.
    2. Squeekboard (GTK3) : relancé avec GTK_THEME=Adwaita(:dark).
    Repli wvkbd : relancé avec la palette correspondante.
    Renvoie (ok, nom_du_clavier | raison).
    """
    penv = _kbd_env()
    import subprocess as _sp
    dark = theme != "light"
    # --- Préférence GTK système (lue par Chromium et les apps GTK) ---
    try:
        gtk_dir = os.path.expanduser("~/.config/gtk-3.0")
        os.makedirs(gtk_dir, exist_ok=True)
        with open(os.path.join(gtk_dir, "settings.ini"), "w") as f:
            f.write("[Settings]\ngtk-application-prefer-dark-theme=%d\n"
                    % (1 if dark else 0))
    except Exception:
        pass
    try:
        _sp.run(["gsettings", "set", "org.gnome.desktop.interface",
                 "color-scheme", "prefer-dark" if dark else "default"],
                env=penv, capture_output=True, timeout=6)
    except Exception:
        pass
    # --- Clavier tactile ---
    sq = shutil.which("squeekboard")
    if sq:
        penv["GTK_THEME"] = "Adwaita:dark" if dark else "Adwaita"
        _run(["pkill", "-x", "squeekboard"], timeout=6)
        try:
            _sp.Popen([sq], stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, env=penv)
            return True, "squeekboard"
        except Exception as e:
            return False, str(e)[:80]
    kbd = shutil.which("wvkbd-mobintl")
    if not kbd:
        return False, "aucun clavier"
    if theme == "light":
        cols = ["--bg", "e8eaed", "--fg", "ffffff", "--fg-sp", "dfe3e8",
                "--press", "7aa2f7", "--text", "1b1f24", "--text-sp", "1b1f24"]
    else:
        cols = ["--bg", "1b1f24", "--fg", "2a2f36", "--fg-sp", "20242a",
                "--press", "7aa2f7", "--text", "ffffff", "--text-sp", "ffffff"]
    _run(["pkill", "-f", "wvkbd-mobintl"], timeout=6)
    try:
        _sp.Popen([kbd, "-L", "260", "--hidden", "--fn", "Sans 22"] + cols,
                  stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, env=penv)
        return True, "wvkbd"
    except Exception as e:
        return False, str(e)[:80]


@app.route("/api/system/keyboard/theme", methods=["POST"])
@require_auth
def api_keyboard_theme():
    """Route : adapte le clavier au thème demandé (ou celui de la config)."""
    theme = "dark"
    try:
        theme = (request.get_json(silent=True) or {}).get("theme") or _load().get("theme") or "dark"
    except Exception:
        pass
    ok, info = _kbd_apply_theme(theme)
    return jsonify({"ok": ok, "theme": theme, "kbd" if ok else "reason": info}), 200


@app.route("/api/system/power/<action>", methods=["POST"])
@require_auth
def api_power(action):
    """Redémarre ou éteint le Raspberry (menu du bouton déconnexion).

    L'action est différée d'une seconde pour que la réponse HTTP parte
    avant l'arrêt (sinon le front affiche une erreur réseau).
    """
    cmd = {"reboot": "reboot", "poweroff": "poweroff"}.get(action)
    if not cmd:
        return jsonify({"ok": False, "reason": "action inconnue"}), 400
    import threading

    def later():
        import time as _t
        _t.sleep(1)
        _run(["sudo", "systemctl", cmd], timeout=10)

    threading.Thread(target=later, daemon=True).start()
    return jsonify({"ok": True, "action": cmd})


@app.route("/api/system/keyboard/<action>", methods=["POST"])
@require_auth
def api_keyboard(action):
    """Affiche / masque le clavier tactile (Squeekboard via DBus, repli wvkbd).

    Panda appelle show au focus d'un champ texte, hide à la perte de focus.
    """
    if action not in ("show", "hide", "toggle"):
        return jsonify({"ok": False, "reason": "action inconnue"}), 400
    _kbd_visible(action != "hide")
    return jsonify({"ok": True})


@app.route("/api/system/browser/open", methods=["POST"])
@require_auth
def api_browser_open():
    j = request.get_json(force=True, silent=True) or {}
    url = (j.get("url") or "").strip()[:2048]
    if not url:
        return jsonify({"ok": False, "reason": "URL manquante"}), 400
    if not _re.match(r"^https?://", url):
        url = "http://" + url
    ok, reason = _browser_open(url)
    return jsonify({"ok": ok, "reason": reason})


@app.route("/api/system/browser/close", methods=["POST"])
@require_auth
def api_browser_close():
    _browser_close()
    return jsonify({"ok": True})


@app.route("/api/system/audio/test", methods=["POST"])
@require_auth
def api_audio_test():
    """Joue un son de test de quelques secondes sur la sortie active.

    IMPORTANT : on route via PipeWire (comme la Radio), pas via ALSA « default »
    qui viserait le jack au lieu du sink PipeWire par défaut (l'enceinte BT).
    Une enceinte BT met ~1 s à sortir de veille : on joue ~3 s en continu.
    """
    penv = dict(os.environ)
    penv.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    import subprocess as _sp
    # 1) pw-play : lecteur natif PipeWire → suit le sink par défaut (enceinte).
    pwplay = _bin("pw-play") or shutil.which("pw-play")
    tone = "/usr/share/sounds/alsa/Front_Center.wav"
    try:
        if pwplay and os.path.exists(tone):
            _sp.Popen(["timeout", "4", pwplay, tone],
                      stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, env=penv)
            return jsonify({"ok": True, "via": "pw-play"})
        # 2) repli : speaker-test forcé sur le device PipeWire
        exe = _bin("speaker-test") or shutil.which("speaker-test")
        if exe:
            _sp.Popen(["timeout", "3", exe, "-D", "pipewire",
                       "-t", "sine", "-f", "440", "-c", "2"],
                      stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, env=penv)
            return jsonify({"ok": True, "via": "speaker-test/pipewire"})
        return jsonify({"ok": False, "reason": "aucun lecteur audio disponible"})
    except Exception as e:
        return jsonify({"ok": False, "reason": f"{type(e).__name__}"[:60]})


@app.route("/api/system/audio")
@require_auth
@require_admin
def api_audio():
    return jsonify(_audio_status())


@app.route("/api/system/audio/default", methods=["POST"])
@require_auth
@require_admin
def api_audio_default():
    """Définit la sortie audio par défaut (id de sink wpctl)."""
    j = request.get_json(force=True, silent=True) or {}
    sid = str(j.get("id", "")).strip()
    if not sid.isdigit():
        return jsonify({"ok": False, "reason": "id invalide"}), 400
    ok, out = _run(["wpctl", "set-default", sid], timeout=8)
    return jsonify({"ok": ok, "reason": None if ok else out})


@app.route("/api/system/volume")
@require_auth
def api_volume():
    return jsonify(_volume_get())


@app.route("/api/system/volume", methods=["POST"])
@require_auth
def api_volume_set():
    j = request.get_json(force=True, silent=True) or {}
    try:
        vol = int(j.get("value", 50))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "reason": "valeur invalide"}), 400
    return jsonify(_volume_set(vol))


def _bt_set_default_sink():
    """Définit le sink Bluetooth (bluez) comme sortie audio par défaut."""
    if not _bin("wpctl"):
        return False
    okw, outw = _run(["wpctl", "status"], timeout=8)
    if not okw:
        return False
    # cherche un sink dont le nom évoque le Bluetooth, dans la section Sinks
    in_sinks = False
    for line in outw.split("\n"):
        if "Sinks:" in line:
            in_sinks = True; continue
        if in_sinks:
            if "Sources:" in line or "Filters:" in line:
                break
            low = line.lower()
            if "bluez" in low or "bluetooth" in low or "thib sound" in low:
                m = _re.search(r"(\d+)\.", line)
                if m:
                    _run(["wpctl", "set-default", m.group(1)], timeout=6)
                    return True
    return False


def _bt_pair_session(mac):
    """Appaire un appareil dans UNE session bluetoothctl maintenue ouverte.

    Contourne le bug bluez où un « pair » one-shot n'écrit pas la LinkKey.
    On envoie scan/agent/pair/trust/connect sur le stdin d'un même process
    bluetoothctl, en le laissant vivre assez longtemps pour persister la clé.
    """
    exe = _bin("bluetoothctl")
    if not exe:
        return False, "bluetoothctl introuvable"
    script = (
        "power on\n"
        "agent on\n"
        "default-agent\n"
        "scan on\n"
        "__SLEEP__6\n"          # laisse le temps de (re)découvrir l'appareil
        f"pair {mac}\n"
        "__SLEEP__4\n"
        f"trust {mac}\n"
        "__SLEEP__1\n"
        f"connect {mac}\n"
        "__SLEEP__4\n"
        "scan off\n"
        "quit\n"
    )
    # bluetoothctl lit son stdin ; on injecte des pauses réelles en découpant
    # l'entrée (les lignes __SLEEP__N deviennent des time.sleep côté pilote).
    try:
        import subprocess as _sp
        proc = _sp.Popen([exe], stdin=_sp.PIPE, stdout=_sp.PIPE,
                         stderr=_sp.STDOUT, text=True, bufsize=1)
        out_lines = []
        for line in script.split("\n"):
            if line.startswith("__SLEEP__"):
                try:
                    proc.stdin.flush()
                except Exception:
                    pass
                time.sleep(float(line.replace("__SLEEP__", "") or "1"))
                continue
            if not line:
                continue
            try:
                proc.stdin.write(line + "\n")
                proc.stdin.flush()
            except Exception:
                break
        try:
            out, _ = proc.communicate(timeout=15)
            out_lines.append(out or "")
        except Exception:
            proc.kill()
            out_lines.append("")
        full = "".join(out_lines)
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"[:120]
    # Vérifie le résultat réel : la clé doit maintenant être persistée.
    okc, outc = _run(["bluetoothctl", "info", mac], timeout=8)
    paired = okc and "Paired: yes" in outc
    connected = okc and "Connected: yes" in outc
    if paired or connected:
        return True, None
    # message d'erreur utile extrait de la session
    reason = "appairage échoué"
    for kw in ("Failed", "not available", "AuthenticationFailed", "br-connection"):
        if kw.lower() in full.lower():
            reason = f"appairage échoué ({kw})"
            break
    return False, reason


@app.route("/api/system/bluetooth/autoreconnect", methods=["POST"])
@require_auth
@require_admin
def api_bt_autoreconnect():
    """Active/désactive la reconnexion BT au boot. Activée par défaut ; on crée
    un fichier « off » quand elle est désactivée (lu par panda-bt-reconnect)."""
    j = request.get_json(force=True, silent=True) or {}
    on = bool(j.get("on"))
    try:
        flag = "/opt/panda/bt-autoreconnect-off"
        if on and os.path.exists(flag):
            os.remove(flag)
        elif not on:
            with open(flag, "w") as fh:
                fh.write("1")
    except Exception as e:
        return jsonify({"ok": False, "reason": str(e)[:80]})
    return jsonify({"ok": True, "on": on})


@app.route("/api/system/bluetooth")
@require_auth
@require_admin
def api_bt():
    return jsonify(_bt_devices())
@app.route("/api/system/bluetooth/action", methods=["POST"])
@require_auth
@require_admin
def api_bt_action():
    j = request.get_json(force=True, silent=True) or {}
    act = (j.get("action") or "").strip()
    mac = (j.get("mac") or "").strip().upper()
    if act == "scan":
        ok, out = _run(["bluetoothctl", "--timeout", "8", "scan", "on"], timeout=15)
        return jsonify({"ok": ok, "reason": None if ok else out})
    if act in ("power-on", "power-off"):
        if act == "power-on":
            # Le contrôleur BT du RPi5 est souvent soft-bloqué (off-blocked) :
            # on le débloque avant d'allumer, sinon org.bluez renvoie failed.
            _run(["rfkill", "unblock", "bluetooth"], timeout=8, sudo=True)
        ok, out = _run(["bluetoothctl", "power",
                        "on" if act == "power-on" else "off"], timeout=10, sudo=True)
        return jsonify({"ok": ok, "reason": None if ok else out,
                        "powered": act == "power-on"})
    if not _re.fullmatch(r"[0-9A-F:]{17}", mac):
        return jsonify({"ok": False, "reason": "adresse MAC invalide"}), 400
    if act not in ("connect", "disconnect", "pair", "trust", "remove"):
        return jsonify({"ok": False, "reason": "action inconnue"}), 400
    if act == "connect":
        # « trust » avant connexion : bluez reconnectera automatiquement
        # l'appareil et le maintiendra.
        _run(["bluetoothctl", "trust", mac], timeout=15)
        ok, out = _run(["bluetoothctl", "connect", mac], timeout=30)
        time.sleep(2.0)
        okc, outc = _run(["bluetoothctl", "info", mac], timeout=8)
        really = okc and "Connected: yes" in outc
        if really:
            # bascule la sortie audio par défaut sur l'enceinte BT : sans ça,
            # le son continue de sortir sur le jack (WirePlumber ne bascule pas
            # toujours automatiquement).
            _bt_set_default_sink()
        return jsonify({"ok": really or ok,
                        "reason": None if (really or ok) else (out or "connexion échouée")})
    elif act == "pair":
        # BUG bluez connu : un « pair » one-shot (process qui quitte aussitôt)
        # n'écrit PAS la LinkKey sur disque → au reboot l'appareil repasse
        # « Paired: no » et la connexion échoue (br-connection-unknown). Le
        # remède : appairer dans UNE session bluetoothctl maintenue ouverte,
        # avec agent, ce qui laisse le temps d'écrire la clé.
        ok, out = _bt_pair_session(mac)
    else:
        ok, out = _run(["bluetoothctl", act, mac], timeout=30)
    return jsonify({"ok": ok, "reason": None if ok else out})


def _updates():
    ok, out = _run(["aptlist", "list", "--upgradable"], timeout=30)
    if not ok:
        return {"ok": False, "reason": out}
    pkgs = []
    for line in out.strip().split("\n"):
        m = _re.match(r"^([^/\s]+)/(\S+)\s+(\S+).*upgradable from:\s*([^\s\]]+)", line)
        if m:
            pkgs.append({"name": m.group(1), "new": m.group(3), "old": m.group(4),
                         "security": "security" in m.group(2)})
    pkgs.sort(key=lambda x: (not x["security"], x["name"]))
    return {"ok": True, "packages": pkgs, "count": len(pkgs),
            "security": sum(1 for p in pkgs if p["security"])}


@app.route("/api/system/updates")
@require_auth
@require_admin
def api_updates():
    return jsonify(_updates())


@app.route("/api/system/updates/apply", methods=["POST"])
@require_auth
@require_admin
def api_updates_apply():
    ok, out = _run(["apt", "-y", "upgrade"], timeout=900, sudo=True,
                   env={"DEBIAN_FRONTEND": "noninteractive",
                        "APT_LISTCHANGES_FRONTEND": "none"})
    return jsonify({"ok": ok, "output": out[-1500:] if ok else None,
                    "reason": None if ok else out[-400:]})






_SOUND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sounds")
_SOUND_EXT = (".mp3", ".ogg", ".wav", ".m4a")
_SOUND_MAX = 3 * 1024 * 1024
_SOUND_RE = _re.compile(r"^[A-Za-z0-9 ._()-]{1,60}$")


def _sound_path(name):
    if not name or not _SOUND_RE.match(name):
        raise RuntimeError("nom invalide")
    if not name.lower().endswith(_SOUND_EXT):
        raise RuntimeError("format refusé")
    p = os.path.realpath(os.path.join(_SOUND_DIR, name))
    if not p.startswith(os.path.realpath(_SOUND_DIR) + os.sep):
        raise RuntimeError("chemin refusé")
    return p


@app.route("/api/timer/sounds")
@require_auth
def api_sounds_list():
    items = []
    if os.path.isdir(_SOUND_DIR):
        for f in sorted(os.listdir(_SOUND_DIR)):
            if not f.lower().endswith(_SOUND_EXT):
                continue
            p = os.path.join(_SOUND_DIR, f)
            if os.path.isfile(p):
                items.append({"name": f,
                              "size_kb": round(os.path.getsize(p) / 1024)})
    return jsonify({"ok": True, "sounds": items})


@app.route("/api/timer/sounds", methods=["POST"])
@require_auth
@require_admin
def api_sounds_upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "reason": "aucun fichier"}), 400
    base = os.path.basename(f.filename)
    ext = os.path.splitext(base)[1].lower()
    if ext not in _SOUND_EXT:
        return jsonify({"ok": False, "reason": "format refusé (mp3, ogg, wav, m4a)"}), 400
    stem = _re.sub(r"[^A-Za-z0-9 ._()-]", "_", os.path.splitext(base)[0])[:50] or "sonnerie"
    name = stem + ext
    blob = f.read(_SOUND_MAX + 1)
    if len(blob) > _SOUND_MAX:
        return jsonify({"ok": False, "reason": "fichier trop lourd (max 3 Mo)"}), 400
    if not blob:
        return jsonify({"ok": False, "reason": "fichier vide"}), 400
    os.makedirs(_SOUND_DIR, exist_ok=True)
    try:
        p = _sound_path(name)
    except RuntimeError as e:
        return jsonify({"ok": False, "reason": str(e)}), 400
    i = 1
    while os.path.exists(p):
        name = f"{stem} ({i}){ext}"
        p = _sound_path(name)
        i += 1
    with open(p, "wb") as out:
        out.write(blob)
    return jsonify({"ok": True, "name": name, "size_kb": round(len(blob) / 1024)})


@app.route("/api/timer/sounds/<path:name>", methods=["DELETE"])
@require_auth
@require_admin
def api_sounds_delete(name):
    try:
        p = _sound_path(name)
    except RuntimeError as e:
        return jsonify({"ok": False, "reason": str(e)}), 400
    if not os.path.isfile(p):
        return jsonify({"ok": False, "reason": "introuvable"}), 404
    try:
        os.remove(p)
    except OSError as e:
        return jsonify({"ok": False, "reason": e.strerror})
    return jsonify({"ok": True})


_TIMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "timer-img")
_TIMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
_TIMG_MAX = 2 * 1024 * 1024


def _timg_path(name):
    if not name or not _SOUND_RE.match(name):
        raise RuntimeError("nom invalide")
    if not name.lower().endswith(_TIMG_EXT):
        raise RuntimeError("format refusé")
    p = os.path.realpath(os.path.join(_TIMG_DIR, name))
    if not p.startswith(os.path.realpath(_TIMG_DIR) + os.sep):
        raise RuntimeError("chemin refusé")
    return p


@app.route("/api/timer/images", methods=["POST"])
@require_auth
@require_admin
def api_timg_upload():
    """Image d'un préréglage du minuteur (affichée sur la carte)."""
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "reason": "aucun fichier"}), 400
    base = os.path.basename(f.filename)
    ext = os.path.splitext(base)[1].lower()
    if ext not in _TIMG_EXT:
        return jsonify({"ok": False, "reason": "format refusé (png, jpg, webp, gif)"}), 400
    stem = _re.sub(r"[^A-Za-z0-9 ._()-]", "_", os.path.splitext(base)[0])[:50] or "image"
    name = stem + ext
    blob = f.read(_TIMG_MAX + 1)
    if len(blob) > _TIMG_MAX:
        return jsonify({"ok": False, "reason": "fichier trop lourd (max 2 Mo)"}), 400
    if not blob:
        return jsonify({"ok": False, "reason": "fichier vide"}), 400
    os.makedirs(_TIMG_DIR, exist_ok=True)
    try:
        p = _timg_path(name)
    except RuntimeError as e:
        return jsonify({"ok": False, "reason": str(e)}), 400
    i = 1
    while os.path.exists(p):
        name = f"{stem} ({i}){ext}"
        p = _timg_path(name)
        i += 1
    with open(p, "wb") as out:
        out.write(blob)
    return jsonify({"ok": True, "name": name, "size_kb": round(len(blob) / 1024)})


@app.route("/api/timer/images/<path:name>", methods=["DELETE"])
@require_auth
@require_admin
def api_timg_delete(name):
    try:
        p = _timg_path(name)
    except RuntimeError as e:
        return jsonify({"ok": False, "reason": str(e)}), 400
    if not os.path.isfile(p):
        return jsonify({"ok": False, "reason": "introuvable"}), 404
    try:
        os.remove(p)
    except OSError as e:
        return jsonify({"ok": False, "reason": e.strerror})
    return jsonify({"ok": True})


@app.route("/api/timer/image/<path:name>")
@require_auth
def api_timg_serve(name):
    try:
        p = _timg_path(name)
    except RuntimeError:
        return Response(status=400)
    if not os.path.isfile(p):
        return Response(status=404)
    return send_from_directory(_TIMG_DIR, os.path.basename(p), conditional=True)


@app.route("/api/timer/sound/<path:name>")
@require_auth
def api_sound_play(name):
    try:
        p = _sound_path(name)
    except RuntimeError:
        return Response(status=400)
    if not os.path.isfile(p):
        return Response(status=404)
    return send_from_directory(_SOUND_DIR, os.path.basename(p), conditional=True)


def _kbd_theme_at_boot():
    """Applique le thème sauvegardé au clavier au démarrage de Panda.

    Le clavier (Squeekboard) est lancé par labwc avec le thème GTK par défaut :
    on le relance avec le bon GTK_THEME dès que la session Wayland est prête.
    Verrou fichier : gunicorn a plusieurs workers, un seul doit le faire.
    """
    import fcntl
    import threading
    import time

    try:
        lockf = open("/tmp/.panda-kbd-theme.lock", "w")
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return  # un autre worker s'en charge
    _kbd_theme_at_boot._lock = lockf  # garde le fd ouvert (donc le verrou)

    def worker():
        time.sleep(10)  # laisse labwc + squeekboard démarrer
        try:
            theme = _load().get("theme") or "dark"
            _kbd_apply_theme(theme)
        except Exception:
            pass

    threading.Thread(target=worker, daemon=True).start()


try:
    _migrate_kitchenowl_cfg()
except Exception:  # une migration ne doit jamais empêcher le démarrage
    app.logger.exception("migration kitchenowl")

_kbd_theme_at_boot()

def _ntp_at_boot():
    """Réarme le NTP au démarrage si l'heure n'est pas en mode manuel.

    Une panne de courant redémarre le kiosk : si un réglage manuel passé
    avait laissé set-ntp à false, l'heure ne se resynchronisait jamais
    (décalage constaté jusqu'au reboot). Best-effort, silencieux."""
    try:
        if _load().get("ntp", True):
            _run(["timedatectl", "set-ntp", "true"], timeout=8, sudo=True)
    except Exception:
        app.logger.exception("ntp at boot")


_ntp_at_boot()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8090, debug=False)
