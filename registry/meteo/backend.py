"""Addon « meteo » — backend au contrat SDK du kiosk (lot D).

    register(sdk) -> flask.Blueprint   (routes montées sous /addons/meteo/api)
    test(sdk, cfg) -> (bool, str)      (bouton « Tester » des réglages)

Le SDK remis par le noyau est étroit : config du module, cache court, logger,
requests partagé. Pas d'accès au config.json global ni aux autres addons.

Sources : Open-Meteo (prévisions + qualité de l'air, sans clé) et
Météo-France (vigilance départementale, token applicatif public).

Note migration : le dict _DEPTS était référencé par _vigilance dans app.py
mais n'y était plus défini (NameError latent dès qu'une vigilance valide
revenait). Il est réintroduit ici, complet.
"""

# token applicatif public de l'app Météo-France (même que celui utilisé par Home Assistant)
MF_TOKEN = "__Wj7dVSTjV9YGu1guveLyDq0g7S7TfTjaHBTPTpO0kj8__"

_DEPTS = {
    "01": "Ain", "02": "Aisne", "03": "Allier",
    "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes",
    "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron",
    "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
    "16": "Charente", "17": "Charente-Maritime", "18": "Cher",
    "19": "Corrèze", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
    "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse",
    "24": "Dordogne", "25": "Doubs", "26": "Drôme", "27": "Eure",
    "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard",
    "31": "Haute-Garonne", "32": "Gers", "33": "Gironde",
    "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre",
    "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
    "40": "Landes", "41": "Loir-et-Cher", "42": "Loire",
    "43": "Haute-Loire", "44": "Loire-Atlantique", "45": "Loiret",
    "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère",
    "49": "Maine-et-Loire", "50": "Manche", "51": "Marne",
    "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
    "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre",
    "59": "Nord", "60": "Oise", "61": "Orne", "62": "Pas-de-Calais",
    "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales",
    "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
    "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe",
    "73": "Savoie", "74": "Haute-Savoie", "75": "Paris",
    "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines",
    "79": "Deux-Sèvres", "80": "Somme", "81": "Tarn",
    "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse",
    "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne",
    "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort",
    "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis",
    "94": "Val-de-Marne", "95": "Val-d'Oise",
    "971": "Guadeloupe", "972": "Martinique", "973": "Guyane",
    "974": "La Réunion", "976": "Mayotte",
}


# index inversé « nom de département » → code, pour retrouver le dept depuis
# le champ admin2 renvoyé par le géocodage Open-Meteo (villes françaises).
_DEPT_BY_NAME = {v.lower(): k for k, v in _DEPTS.items()}


def _geocode(sdk, q):
    q = (q or "").strip()
    if len(q) < 2:
        return {"ok": False, "reason": "saisis au moins 2 caractères"}
    ck = f"geo:{q.lower()}"
    c = sdk.cache_get(ck, 3600)
    if c is not None:
        return c
    try:
        r = sdk.requests.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": q, "count": 6, "language": "fr", "format": "json"},
            timeout=6)
        r.raise_for_status()
        j = r.json()
    except sdk.requests.exceptions.RequestException as e:
        return {"ok": False, "reason": type(e).__name__}
    except ValueError:
        return {"ok": False, "reason": "réponse invalide"}
    out = []
    for it in (j.get("results") or []):
        a2 = (it.get("admin2") or "").strip()
        dept = ""
        if it.get("country_code") == "FR" and a2:
            dept = _DEPT_BY_NAME.get(a2.lower(), "")
        out.append({"name": it.get("name"),
                    "admin1": it.get("admin1") or "",
                    "admin2": a2,
                    "country": it.get("country") or "",
                    "lat": it.get("latitude"),
                    "lon": it.get("longitude"),
                    "dept": dept})
    return sdk.cache_set(ck, {"ok": True, "results": out})


def _weather(sdk, cfg):
    def _f(v, d):
        try:
            return float(str(v).replace(",", "."))
        except (TypeError, ValueError):
            return d
    lat = _f(cfg.get("lat"), 48.6493)   # défaut : Saint-Malo (côtier), modifiable
    lon = _f(cfg.get("lon"), -2.0257)
    ville = cfg.get("ville") or "Ma position"
    ck = f"wx:{lat},{lon}"
    c = sdk.cache_get(ck, 300)
    if c is not None:
        return c
    try:
        fu = ("https://api.open-meteo.com/v1/forecast"
              f"?latitude={lat}&longitude={lon}"
              "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,"
              "wind_gusts_10m,precipitation,relative_humidity_2m,is_day"
              "&hourly=temperature_2m,precipitation,precipitation_probability,weather_code"
              "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
              "precipitation_probability_max,uv_index_max,wind_speed_10m_max,sunrise,sunset"
              "&forecast_days=7&timezone=auto")
        r = sdk.requests.get(fu, timeout=6)
        r.raise_for_status()
        f = r.json()
    except sdk.requests.exceptions.RequestException as e:
        return {"ok": False, "reason": type(e).__name__}
    except ValueError:
        return {"ok": False, "reason": "réponse invalide"}

    cur = f.get("current", {})
    hourly = f.get("hourly", {})
    daily = f.get("daily", {})

    # pluie imminente : 1re heure à venir avec précip > 0.1 mm
    rain_in = None
    times = hourly.get("time", [])
    precs = hourly.get("precipitation", [])
    now_iso = cur.get("time")
    started = False
    idx = 0
    for i, t in enumerate(times):
        if t == now_iso:
            started, idx = True, i
            break
    if started:
        for j in range(idx, min(idx + 24, len(precs))):
            if (precs[j] or 0) >= 0.1:
                rain_in = j - idx
                break

    def col(arr, i):
        return arr[i] if i < len(arr) else None

    hours = []
    for j in range(idx, min(idx + 12, len(times))):
        hours.append({"time": times[j],
                      "temp": col(hourly.get("temperature_2m", []), j),
                      "pop": col(hourly.get("precipitation_probability", []), j),
                      "code": col(hourly.get("weather_code", []), j)})

    days = []
    for i in range(len(daily.get("time", []))):
        days.append({"date": daily["time"][i],
                     "code": col(daily.get("weather_code", []), i),
                     "tmax": col(daily.get("temperature_2m_max", []), i),
                     "tmin": col(daily.get("temperature_2m_min", []), i),
                     "pop": col(daily.get("precipitation_probability_max", []), i),
                     "uv": col(daily.get("uv_index_max", []), i),
                     "wind": col(daily.get("wind_speed_10m_max", []), i),
                     "sunrise": col(daily.get("sunrise", []), i),
                     "sunset": col(daily.get("sunset", []), i)})

    air = {}
    try:
        au = ("https://air-quality-api.open-meteo.com/v1/air-quality"
              f"?latitude={lat}&longitude={lon}"
              "&current=uv_index,european_aqi,grass_pollen,birch_pollen,alder_pollen,"
              "ragweed_pollen,olive_pollen,mugwort_pollen&timezone=auto")
        ar = sdk.requests.get(au, timeout=5)
        if ar.ok:
            air = ar.json().get("current", {}) or {}
    except Exception:  # réseau, JSON invalide… : la météo reste utilisable
        air = {}

    res = {"ok": True, "ville": ville,
           "current": {"temp": cur.get("temperature_2m"),
                       "feels": cur.get("apparent_temperature"),
                       "code": cur.get("weather_code"),
                       "wind": cur.get("wind_speed_10m"),
                       "gust": cur.get("wind_gusts_10m"),
                       "precip": cur.get("precipitation"),
                       "humidity": cur.get("relative_humidity_2m"),
                       "is_day": cur.get("is_day"),
                       "uv": (days[0]["uv"] if days else None)},
           "rain_in": rain_in, "hours": hours, "days": days, "air": air}
    return sdk.cache_set(ck, res)


def _vigilance(sdk, cfg):
    dept = (cfg.get("dept") or "").strip()
    if not dept:
        return {"ok": False, "reason": "département non configuré"}
    ck = f"vig:{dept}"
    c = sdk.cache_get(ck, 600)
    if c is not None:
        return c
    try:
        r = sdk.requests.get(
            "https://webservice.meteofrance.com/warning/currentphenomenons",
            params={"domain": dept, "warning_type": "vigilance",
                    "token": MF_TOKEN},
            headers={"User-Agent": "panda"},
            timeout=6)
        if r.status_code != 200:
            return {"ok": False, "reason": f"HTTP {r.status_code}"}
        j = r.json()
        lvl = int(j.get("domain_max_color") or 0)
    except sdk.requests.exceptions.RequestException as e:
        return {"ok": False, "reason": type(e).__name__}
    except (ValueError, KeyError, TypeError):
        return {"ok": False, "reason": "réponse invalide"}
    if lvl < 1:
        return {"ok": False, "reason": "niveau inconnu"}
    labels = {1: ("Vert", "Pas de vigilance particulière"),
              2: ("Jaune", "Soyez attentif"),
              3: ("Orange", "Soyez très vigilant"),
              4: ("Rouge", "Vigilance absolue")}
    color, txt = labels.get(lvl, (str(lvl), ""))
    return sdk.cache_set(ck, {"ok": True, "level": lvl, "color": color,
                              "label": txt, "dept": dept,
                              "dept_name": _DEPTS.get(dept, "dépt " + dept)})


def register(sdk):
    from flask import Blueprint, jsonify, request
    bp = Blueprint("meteo", __name__)

    @bp.route("/weather")
    def weather():
        try:
            cfg = sdk.config()
            # Position transmise par le navigateur (géolocalisation) : prime
            # sur la config si présente et valide. Météo immédiate sans réglage.
            qlat, qlon = request.args.get("lat"), request.args.get("lon")
            if qlat and qlon:
                try:
                    float(str(qlat).replace(",", ".")); float(str(qlon).replace(",", "."))
                    cfg["lat"], cfg["lon"] = qlat, qlon
                    if not cfg.get("ville"):
                        cfg["ville"] = "Ma position"
                except (TypeError, ValueError):
                    pass
            return jsonify(_weather(sdk, cfg))
        except Exception as e:  # jamais de 500 : le kiosk doit afficher l'erreur
            sdk.log.exception("weather")
            return jsonify({"ok": False, "reason": f"{type(e).__name__}: {e}"[:120]})

    @bp.route("/geocode")
    def geocode():
        try:
            return jsonify(_geocode(sdk, request.args.get("q")))
        except Exception as e:
            sdk.log.exception("geocode")
            return jsonify({"ok": False, "reason": f"{type(e).__name__}: {e}"[:120]})

    @bp.route("/vigilance")
    def vigilance():
        try:
            return jsonify(_vigilance(sdk, sdk.config()))
        except Exception as e:
            sdk.log.exception("vigilance")
            return jsonify({"ok": False, "reason": f"{type(e).__name__}: {e}"[:120]})

    return bp


def test(sdk, cfg):
    """Bouton « Tester » des réglages (reçoit les valeurs non sauvées)."""
    parts, anyok = [], False
    w = _weather(sdk, cfg)
    if w.get("ok"):
        anyok = True
        t = w.get("current", {}).get("temp")
        parts.append(f"Open-Meteo ✓ ({round(t)}°)" if t is not None else "Open-Meteo ✓")
    else:
        parts.append(f"Open-Meteo ✗ ({w.get('reason')})")
    if (cfg.get("dept") or "").strip():
        v = _vigilance(sdk, cfg)
        parts.append(f"Vigilance ✓ ({v.get('color')})" if v.get("ok")
                     else f"Vigilance ✗ ({v.get('reason')})")
    return anyok, " · ".join(parts)
