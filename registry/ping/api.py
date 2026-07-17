"""Addon-témoin du chargeur backend (lot D).

Prouve le contrat serveur à vide : register(sdk) -> Blueprint, monté par le
noyau sous /addons/ping/api. Aucune dépendance externe, aucun réseau.
"""
import time

from flask import Blueprint, jsonify


def register(sdk):
    bp = Blueprint("ping", __name__)

    @bp.route("/ping")
    def ping():
        # Exerce le SDK : lecture de la config du module + cache court.
        cached = sdk.cache_get("hits", 3600)
        hits = (cached or 0) + 1
        sdk.cache_set("hits", hits)
        cfg = sdk.config()
        return jsonify(ok=True, pong=True, addon=sdk.id,
                       ts=int(time.time()), hits=hits,
                       config_keys=sorted(cfg.keys()))

    return bp


def test(sdk, cfg):
    return True, "backend Ping ✓ — chargeur opérationnel"
