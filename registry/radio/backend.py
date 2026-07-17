"""Addon « radio » — recherche de stations via radio-browser (lot J).

Migré du noyau vers un backend autonome (aucune dépendance). L'API publique
radio-browser ne demande pas de clé. Cache 10 min via ``sdk.cache`` (clé
texte : query/country/tag ne sont pas sensibles).
"""

RB_BASE = "https://de1.api.radio-browser.info"


def _search(sdk, query="", country="France", tag="", limit=30):
    key = f"rb:{query}:{country}:{tag}:{limit}"
    hit = sdk.cache_get(key, 600)
    if hit is not None:
        return hit
    params = {"limit": limit, "hidebroken": "true",
              "order": "clickcount", "reverse": "true"}
    if query:
        params["name"] = query
    if country:
        params["country"] = country
    if tag:
        params["tag"] = tag
    try:
        r = sdk.requests.get(f"{RB_BASE}/json/stations/search", params=params,
                             headers={"User-Agent": "panda/1.0"}, timeout=10)
        if r.status_code != 200:
            return {"ok": False, "reason": f"HTTP {r.status_code}"}
        data = r.json()
    except sdk.requests.exceptions.RequestException as e:
        return {"ok": False, "reason": type(e).__name__}
    except ValueError:
        return {"ok": False, "reason": "réponse invalide"}
    stations = [{"uuid": s.get("stationuuid"), "name": s.get("name", "?").strip(),
                 "url": s.get("url_resolved") or s.get("url"),
                 "favicon": s.get("favicon") or "",
                 "tags": (s.get("tags") or "").split(",")[:3],
                 "bitrate": s.get("bitrate"), "codec": s.get("codec"),
                 "country": s.get("country", "")}
                for s in data if s.get("url_resolved") or s.get("url")]
    return sdk.cache_set(key, {"ok": True, "stations": stations})


def register(sdk):
    from flask import Blueprint, jsonify, request
    bp = Blueprint("radio", __name__)

    @bp.route("/search")
    def search():
        return jsonify(_search(
            sdk,
            request.args.get("q", "").strip()[:40],
            request.args.get("country", "France").strip()[:30],
            request.args.get("tag", "").strip()[:30]))

    return bp


def test(sdk, cfg):
    r = _search(sdk, "", "France", "", 5)
    if r.get("ok"):
        return True, f"radio-browser \u2713 \u2014 {len(r['stations'])} station(s) trouvée(s)"
    return False, f"radio-browser \u2717 ({r.get('reason')})"
