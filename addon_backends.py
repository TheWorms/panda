"""Chargeur des backends d'addons « code » — phase 2, lot D.

Contrat (figé par la doc SDK) : un addon de type ``code`` dont le manifeste
porte ``backend.entry`` fournit un module Python qui expose

    register(sdk) -> flask.Blueprint        (obligatoire)
    test(sdk, cfg) -> (bool, str)            (optionnel)

Le noyau importe ce module **dans le processus** (pas de sous-processus :
sur Panda la RAM est comptée, et l'utilisateur est seul à installer ses
addons — la valeur recherchée est la robustesse, pas le bac à sable). Chaque
import et chaque enregistrement est protégé : un addon qui lève à l'import
est écarté et journalisé, le kiosk démarre quand même.

Le Blueprint est monté sous un préfixe borné : ``/addons/<id>/api``. Un
addon ne peut donc pas capturer une route du noyau ni celle d'un autre
addon.

Le ``sdk`` remis à ``register`` est délibérément minimal — il donne accès à
la configuration du module, à un cache court, à un logger nommé et au
``requests`` partagé. Il ne donne **pas** accès à ``config.json`` en écriture
ni au reste du noyau : la surface est le contrat, pas app.py.
"""
import importlib.util
import logging
import os
import time

log = logging.getLogger("kiosk.addon_backends")


class AddonSDK:
    """Surface offerte à un backend d'addon. Volontairement étroite.

    ``config()`` relit la configuration du module à chaque appel (elle peut
    changer via l'admin sans redémarrage). ``cache`` est un petit cache
    mémoire propre à l'addon, préfixé par son id — un addon ne lit pas le
    cache d'un autre. ``requests`` est le client HTTP partagé, ``log`` un
    logger nommé ``kiosk.addon.<id>``.
    """

    def __init__(self, aid, config_getter, requests_mod,
                 requires=None, providers=None, data_root=None):
        self.id = aid
        self._cfg = config_getter
        self.requests = requests_mod
        self.log = logging.getLogger(f"kiosk.addon.{aid}")
        self._cache = {}
        # lot E : dépendances & stockage
        self._requires = set(requires or [])
        self._providers = providers if providers is not None else {}
        self._data_root = data_root or os.environ.get("KIOSK_DATA_DIR",
                                                       "/opt/panda/data")
        self._data_dir = None

    def config(self):
        """Configuration courante du module (dict). Jamais None."""
        return dict(self._cfg(self.id) or {})

    def cache_get(self, key, max_age):
        rec = self._cache.get(key)
        if rec and (time.time() - rec[0]) < max_age:
            return rec[1]
        return None

    def cache_set(self, key, value):
        self._cache[key] = (time.time(), value)
        return value

    @property
    def data_dir(self):
        """Répertoire persistant propre à l'addon (``<data_root>/<id>/``).

        Créé à la volée en 0700 au premier accès. Vit hors du dossier
        ``registry/`` : il survit donc au redéploiement du code (unzip -o).
        Deux addons ne partagent jamais leur ``data_dir`` (isolation).
        """
        if self._data_dir is None:
            d = os.path.join(self._data_root, self.id)
            os.makedirs(d, mode=0o700, exist_ok=True)
            self._data_dir = d
        return self._data_dir

    def use(self, provider_id):
        """API publique d'un addon *fournisseur* (lot E).

        Le fournisseur doit avoir été déclaré dans ``requires`` du manifeste
        appelant (sinon ``PermissionError`` : c'est le contrôle d'accès du
        bac à sable). Le service doit être monté (sinon ``LookupError`` :
        fournisseur absent du registry ou en échec à ``provide()``). L'appel
        est in-process : pas d'HTTP interne, pas de port ni d'auth à connaître.
        """
        if provider_id not in self._requires:
            raise PermissionError(
                f"addon « {self.id} » n'a pas déclaré requires:[\"{provider_id}\"]")
        if provider_id not in self._providers:
            raise LookupError(
                f"service « {provider_id} » indisponible (absent ou en échec)")
        return self._providers[provider_id]


def _import_module(aid, folder, entry):
    """Importe folder/entry sous un nom d'espace de noms isolé.

    Le nom de module est ``kiosk_addon_<id>`` pour éviter toute collision
    avec un paquet du système ou un autre addon. Retourne le module ou lève.
    """
    path = os.path.join(folder, entry)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"backend.entry absent : {entry}")
    modname = f"kiosk_addon_{aid}"
    spec = importlib.util.spec_from_file_location(modname, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"spec introuvable pour {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_backends(app, registry, config_getter, requests_mod, registry_dir,
                  data_root=None):
    """Monte les backends de tous les addons ``code`` qui en déclarent un.

    Retourne (backends, errors) :
      backends : {id: {"module": mod, "sdk": AddonSDK}} montés avec succès
      errors   : {id: message} des backends écartés (import/provide/register KO)

    Deux passes (lot E) pour que ``sdk.use()`` trouve toujours sa cible quel
    que soit l'ordre du registry :
      1. **providers** : import des modules + exécution de ``provide(sdk)`` →
         remplit la table ``providers`` (partagée par référence avec tous les
         SDK, donc visible depuis ``sdk.use()``).
      2. **register** : exécution de ``register(sdk)`` + montage du Blueprint.

    Un backend est valide s'il expose ``register`` et/ou ``provide`` : un
    fournisseur pur (service sans routes HTTP, ex. corbeille) n'a pas besoin
    de ``register``.

    Aucune exception ne remonte : un addon défaillant n'empêche jamais le
    démarrage. Les erreurs sont exposées dans l'admin comme les erreurs de
    manifeste.
    """
    backends, errors = {}, {}
    providers = {}          # {id: api} — partagé par référence avec les SDK
    prepared = {}           # {id: (module, sdk)} importés avec succès

    # --- import + construction des SDK (aucun code d'addon exécuté ici) ---
    for aid, m in registry.items():
        bk = m.get("backend")
        if not bk:
            continue
        entry = bk.get("entry", "")
        if not entry.endswith(".py"):
            errors[aid] = f"backend.entry invalide : {entry!r}"
            log.warning("backend %s écarté : %s", aid, errors[aid])
            continue
        # _dir est posé par registry.load() (racine réelle de l'addon : socle
        # registry/ ou store /opt/panda/addons/). Repli sur registry_dir pour
        # compatibilité si le manifeste n'en porte pas.
        folder = m.get("_dir") or os.path.join(registry_dir, aid)
        try:
            module = _import_module(aid, folder, entry)
        except Exception as e:  # import arbitraire : on borne large, à dessein
            errors[aid] = f"import {entry} : {type(e).__name__}: {e}"
            log.warning("backend %s écarté : %s", aid, errors[aid])
            continue
        has_reg = callable(getattr(module, "register", None))
        has_prov = callable(getattr(module, "provide", None))
        if not (has_reg or has_prov):
            errors[aid] = "backend sans register(sdk) ni provide(sdk)"
            log.warning("backend %s écarté : %s", aid, errors[aid])
            continue
        sdk = AddonSDK(aid, config_getter, requests_mod,
                       requires=m.get("requires") or [],
                       providers=providers, data_root=data_root)
        prepared[aid] = (module, sdk)

    # --- passe 1 : providers (avant tout register, pour que use() les voie) ---
    for aid, (module, sdk) in prepared.items():
        prov = getattr(module, "provide", None)
        if not callable(prov):
            continue
        try:
            providers[aid] = prov(sdk)
            log.info("service %s fourni", aid)
        except Exception as e:
            errors[aid] = f"provide() : {type(e).__name__}: {e}"
            log.warning("service %s écarté : %s", aid, errors[aid])

    # --- passe 2 : register + montage du Blueprint ---
    # Import paresseux : Flask est déjà chargé par app.py, mais on évite d'en
    # dépendre au niveau module pour garder ce fichier testable seul.
    from flask import Blueprint
    for aid, (module, sdk) in prepared.items():
        reg = getattr(module, "register", None)
        if not callable(reg):
            # fournisseur pur (pas de routes) : monté comme backend si provide OK
            if aid in providers:
                backends[aid] = {"module": module, "sdk": sdk}
            continue
        try:
            bp = reg(sdk)
        except Exception as e:
            errors[aid] = f"register() : {type(e).__name__}: {e}"
            log.warning("backend %s écarté : %s", aid, errors[aid])
            continue
        if not isinstance(bp, Blueprint):
            errors[aid] = "register() n'a pas renvoyé de Blueprint"
            log.warning("backend %s écarté : %s", aid, errors[aid])
            continue
        prefix = f"/addons/{aid}/api"
        try:
            app.register_blueprint(bp, url_prefix=prefix, name=f"addon_{aid}")
        except Exception as e:
            errors[aid] = f"montage Blueprint : {type(e).__name__}: {e}"
            log.warning("backend %s écarté : %s", aid, errors[aid])
            continue
        backends[aid] = {"module": module, "sdk": sdk}
        log.info("backend %s monté sous %s", aid, prefix)
    return backends, errors
