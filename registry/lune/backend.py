"""Addon « lune » — backend au contrat SDK du kiosk (lot D).

    register(sdk) -> flask.Blueprint   (routes montées sous /addons/lune/api)
    test(sdk, cfg) -> (bool, str)      (bouton « Tester » des réglages)

Le SDK remis par le noyau est étroit : config du module, cache court, logger,
requests partagé. Pas d'accès au config.json global ni aux autres addons.
Code astro extrait du noyau (copie transitionnelle : `jardin` garde la sienne
dans app.py jusqu'à sa propre migration).
"""
import math
import requests
import time
from datetime import datetime, timedelta, timezone

SYNODIC = 29.530588853

def _jd(dt):
    """Jour julien depuis un datetime UTC."""
    return dt.replace(tzinfo=timezone.utc).timestamp() / 86400.0 + 2440587.5

def _sun_moon_ecl(jd):
    """Positions écliptiques (deg), éléments de Schlyter.
    d compté depuis 1999-12-31 00:00 UT (epoch 2000.0 de Schlyter)."""
    d = jd - 2451543.5
    # Soleil
    w = 282.9404 + 4.70935e-5 * d
    e = 0.016709 - 1.151e-9 * d
    M = (356.0470 + 0.9856002585 * d) % 360
    Mr = math.radians(M)
    E = M + math.degrees(e) * math.sin(Mr) * (1 + e * math.cos(Mr))
    Er = math.radians(E)
    xv = math.cos(Er) - e
    yv = math.sqrt(1 - e * e) * math.sin(Er)
    v = math.degrees(math.atan2(yv, xv))
    sun_lon = (v + w) % 360
    # Lune
    N = (125.1228 - 0.0529538083 * d) % 360
    i = 5.1454
    wm = (318.0634 + 0.1643573223 * d) % 360
    a = 60.2666
    em = 0.054900
    Mm = (115.3654 + 13.0649929509 * d) % 360
    Emm = Mm + math.degrees(em) * math.sin(math.radians(Mm)) * (1 + em * math.cos(math.radians(Mm)))
    for _ in range(3):
        Emm = Emm - (Emm - math.degrees(em) * math.sin(math.radians(Emm)) - Mm) / \
              (1 - em * math.cos(math.radians(Emm)))
    xv = a * (math.cos(math.radians(Emm)) - em)
    yv = a * math.sqrt(1 - em * em) * math.sin(math.radians(Emm))
    vm = math.degrees(math.atan2(yv, xv))
    rm = math.hypot(xv, yv)
    xh = rm * (math.cos(math.radians(N)) * math.cos(math.radians(vm + wm)) -
               math.sin(math.radians(N)) * math.sin(math.radians(vm + wm)) * math.cos(math.radians(i)))
    yh = rm * (math.sin(math.radians(N)) * math.cos(math.radians(vm + wm)) +
               math.cos(math.radians(N)) * math.sin(math.radians(vm + wm)) * math.cos(math.radians(i)))
    zh = rm * math.sin(math.radians(vm + wm)) * math.sin(math.radians(i))
    moon_lon = math.degrees(math.atan2(yh, xh)) % 360
    moon_lat = math.degrees(math.atan2(zh, math.hypot(xh, yh)))

    # perturbations principales (Schlyter) : évection, variation, équation annuelle...
    Ls = (w + M) % 360
    Lm = (N + wm + Mm) % 360
    D = (Lm - Ls) % 360
    F = (Lm - N) % 360
    sr = lambda x: math.sin(math.radians(x))
    moon_lon += (-1.274 * sr(Mm - 2 * D) + 0.658 * sr(2 * D) - 0.186 * sr(M)
                 - 0.059 * sr(2 * Mm - 2 * D) - 0.057 * sr(Mm - 2 * D + M)
                 + 0.053 * sr(Mm + 2 * D) + 0.046 * sr(2 * D - M)
                 + 0.041 * sr(Mm - M) - 0.035 * sr(D) - 0.031 * sr(Mm + M)
                 - 0.015 * sr(2 * F - 2 * D) + 0.011 * sr(Mm - 4 * D))
    moon_lat += (-0.173 * sr(F - 2 * D) - 0.055 * sr(Mm - F - 2 * D)
                 - 0.046 * sr(Mm + F - 2 * D) + 0.033 * sr(F + 2 * D)
                 + 0.017 * sr(2 * Mm + F))
    moon_lon %= 360
    return sun_lon, moon_lon, moon_lat, rm

def _moon_phase(dt):
    jd = _jd(dt)
    sun_lon, moon_lon, _, _ = _sun_moon_ecl(jd)
    elong = (moon_lon - sun_lon) % 360           # 0 = nouvelle lune, 180 = pleine
    illum = (1 - math.cos(math.radians(elong))) / 2
    age = elong / 360.0 * SYNODIC
    names = [(1.5, "Nouvelle lune", "🌑"), (5.8, "Premier croissant", "🌒"),
             (9.7, "Premier quartier", "🌓"), (13.8, "Lune gibbeuse croissante", "🌔"),
             (16.0, "Pleine lune", "🌕"), (20.0, "Lune gibbeuse décroissante", "🌖"),
             (23.9, "Dernier quartier", "🌗"), (27.9, "Dernier croissant", "🌘"),
             (29.6, "Nouvelle lune", "🌑")]
    name, icon = next((n, i) for lim, n, i in names if age < lim)
    return {"elong": elong, "illumination": round(illum * 100, 1),
            "age": round(age, 1), "name": name, "icon": icon,
            "waxing": elong < 180}

def _next_phase(dt, target):
    """Prochaine date où l'élongation atteint `target` (0=NL, 180=PL)."""
    step = timedelta(hours=2)
    cur = dt
    prev = (_moon_phase(cur)["elong"] - target) % 360
    for _ in range(int(31 * 12)):
        cur += step
        e = (_moon_phase(cur)["elong"] - target) % 360
        if e < prev and prev > 300 and e < 60:
            lo, hi = cur - step, cur
            for _ in range(30):
                mid = lo + (hi - lo) / 2
                if ((_moon_phase(mid)["elong"] - target) % 360) > 180:
                    lo = mid
                else:
                    hi = mid
            return hi
        prev = e
    return None

def _altitude(jd, lat, lon, body):
    sun_lon, moon_lon, moon_lat, _ = _sun_moon_ecl(jd)
    ecl = math.radians(23.4393 - 3.563e-7 * (jd - 2451545.0))
    if body == "sun":
        lam, beta = math.radians(sun_lon), 0.0
    else:
        lam, beta = math.radians(moon_lon), math.radians(moon_lat)
    ra = math.atan2(math.sin(lam) * math.cos(ecl) - math.tan(beta) * math.sin(ecl), math.cos(lam))
    dec = math.asin(math.sin(beta) * math.cos(ecl) + math.cos(beta) * math.sin(ecl) * math.sin(lam))
    d = jd - 2451545.0
    gmst = (280.46061837 + 360.98564736629 * d) % 360
    ha = math.radians((gmst + lon) % 360) - ra
    la = math.radians(lat)
    return math.degrees(math.asin(math.sin(la) * math.sin(dec) +
                                  math.cos(la) * math.cos(dec) * math.cos(ha)))

def _rise_set(day, lat, lon, body):
    """Lever/coucher par balayage d'altitude (pas de 10 min)."""
    h0 = -0.833 if body == "sun" else 0.125
    rise = setg = None
    prev_t = day
    prev_a = _altitude(_jd(prev_t), lat, lon, body) - h0
    # 30 h de balayage : la Lune peut lever tard (jusqu'à ~50 min de décalage/jour)
    for k in range(1, 30 * 6 + 1):
        t = day + timedelta(minutes=10 * k)
        a = _altitude(_jd(t), lat, lon, body) - h0
        if prev_a < 0 <= a and rise is None:
            rise = t
        if prev_a >= 0 > a and setg is None:
            setg = t
        prev_a = a
    return rise, setg

def _moon(cfg):
    def _f(v, d):
        try:
            return float(str(v).replace(",", "."))
        except (TypeError, ValueError):
            return d
    lat = _f(cfg.get("lat"), 47.4820)
    lon = _f(cfg.get("lon"), -2.3423)
    now = datetime.now(timezone.utc)
    ph = _moon_phase(now)
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    mr, ms = _rise_set(day, lat, lon, "moon")
    sr, ss = _rise_set(day, lat, lon, "sun")
    nn = _next_phase(now, 0)
    nf = _next_phase(now, 180)

    def iso(x):
        return x.astimezone().isoformat() if x else None
    src = "local"
    n_new, n_full = iso(nn), iso(nf)
    try:
        inn, inf = _imcce_next_phases(now)
        if inn and inf:
            n_new, n_full, src = inn, inf, "imcce"
    except Exception:
        pass
    return {"ok": True, **ph,
            "moonrise": iso(mr), "moonset": iso(ms),
            "sunrise": iso(sr), "sunset": iso(ss),
            "next_new": n_new, "next_full": n_full, "source": src}

_IMCCE_CACHE = {}

_IMCCE_PHASE_MAP = {
    "NewMoon": ("NL", "🌑", "Nouvelle lune"),
    "FirstQuarter": ("PQ", "🌓", "Premier quartier"),
    "FullMoon": ("PL", "🌕", "Pleine lune"),
    "LastQuarter": ("DQ", "🌗", "Dernier quartier"),
}

_IMCCE_ECL_MAP = {
    "TotalEclipse": "totale", "PartialEclipse": "partielle",
    "AnnularEclipse": "annulaire", "PenumbralEclipse": "pénombrale",
    "HybridEclipse": "hybride",
}

def _imcce_get(url, params=None):
    r = requests.get(url, params=params,
                     headers={"User-Agent": "panda"}, timeout=8)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    return r.json()

def _imcce_phases(year):
    """Phases principales de l'année via IMCCE/Opale (cache 24 h)."""
    ck = f"phases:{year}"
    c = _IMCCE_CACHE.get(ck)
    if c and time.time() - c[0] < 86400:
        return c[1]
    j = _imcce_get("https://opale.imcce.fr/api/v1/phenomena/moonphases",
                   {"year": year, "timescale": "UTC", "calendar": "gregorian"})
    out = []
    for p in j.get("response", {}).get("data", []):
        mp = _IMCCE_PHASE_MAP.get(p.get("moonPhase"))
        d = p.get("date")
        if not mp or not d:
            continue
        dt = datetime.fromisoformat(d).replace(tzinfo=timezone.utc)
        out.append({"type": mp[0], "icon": mp[1], "label": mp[2],
                    "date": dt.astimezone().isoformat()})
    if not out:
        raise RuntimeError("réponse vide")
    _IMCCE_CACHE[ck] = (time.time(), out)
    return out

def _imcce_eclipses(year):
    """Éclipses lunaires + solaires de l'année via IMCCE/Opale (cache 24 h)."""
    ck = f"ecl:{year}"
    c = _IMCCE_CACHE.get(ck)
    if c and time.time() - c[0] < 86400:
        return c[1]
    out = []
    for body, kind, icon in ((301, "lunaire", "🌕"), (10, "solaire", "🌑")):
        try:
            j = _imcce_get(f"https://opale.imcce.fr/api/v1/phenomena/eclipses/{body}/{year}")
        except Exception:
            continue
        resp = j.get("response", {})
        for key, val in resp.items():
            if not key.lower().endswith("eclipse") or not isinstance(val, list):
                continue
            for e in val:
                g = (e.get("events") or {}).get("greatest") or {}
                d = g.get("date") or (e.get("calendarDate") and e["calendarDate"] + "T12:00:00")
                if not d:
                    continue
                dt = datetime.fromisoformat(d).replace(tzinfo=timezone.utc)
                out.append({"kind": kind, "icon": icon,
                            "type": _IMCCE_ECL_MAP.get(e.get("type"), e.get("type") or ""),
                            "date": dt.astimezone().isoformat()})
    out.sort(key=lambda x: x["date"])
    _IMCCE_CACHE[ck] = (time.time(), out)
    return out

def _imcce_next_phases(now):
    """Prochaines NL/PL selon l'IMCCE (année courante + suivante si besoin)."""
    phases = list(_imcce_phases(now.year))
    if now.month == 12:
        try:
            phases += _imcce_phases(now.year + 1)
        except Exception:
            pass
    nn = nf = None
    for p in phases:
        d = datetime.fromisoformat(p["date"])
        if d <= now:
            continue
        if p["type"] == "NL" and nn is None:
            nn = p["date"]
        if p["type"] == "PL" and nf is None:
            nf = p["date"]
        if nn and nf:
            break
    return nn, nf

def _phases_between(start, end):
    """Phases principales (NL, PQ, PL, DQ) entre deux dates."""
    targets = [(0, "NL", "🌑", "Nouvelle lune"), (90, "PQ", "🌓", "Premier quartier"),
               (180, "PL", "🌕", "Pleine lune"), (270, "DQ", "🌗", "Dernier quartier")]
    out = []
    step = timedelta(hours=6)
    t = start
    prev = _moon_phase(t)["elong"]
    while t < end:
        t2 = t + step
        cur = _moon_phase(t2)["elong"]
        for ang, code, icon, label in targets:
            a = (prev - ang) % 360
            b = (cur - ang) % 360
            if b < a and a > 300 and b < 60:
                lo, hi = t, t2
                for _ in range(28):
                    mid = lo + (hi - lo) / 2
                    if ((_moon_phase(mid)["elong"] - ang) % 360) > 180:
                        lo = mid
                    else:
                        hi = mid
                out.append({"type": code, "icon": icon, "label": label,
                            "date": hi.astimezone().isoformat()})
        prev = cur
        t = t2
    return out

def _geocode(sdk, q):
    """Géocodage ville -> coordonnées (Open-Meteo, même source que Météo)."""
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
        out.append({"name": it.get("name"),
                    "admin1": it.get("admin1") or "",
                    "admin2": (it.get("admin2") or "").strip(),
                    "country": it.get("country") or "",
                    "lat": it.get("latitude"),
                    "lon": it.get("longitude")})
    return sdk.cache_set(ck, {"ok": True, "results": out})


# ---------------------------------------------------------------------------
# Contrat SDK — seules fonctions appelées par le noyau
# ---------------------------------------------------------------------------

def register(sdk):
    from flask import Blueprint, jsonify, request
    bp = Blueprint("lune", __name__)

    @bp.route("/moon")
    def moon():
        return jsonify(_moon(sdk.config()))

    @bp.route("/moon/days")
    def moon_days():
        try:
            n = max(1, min(40, int(request.args.get("n", 7))))
        except ValueError:
            n = 7
        base = datetime.now(timezone.utc).replace(hour=12, minute=0,
                                                  second=0, microsecond=0)
        days = []
        for i in range(n):
            d = base + timedelta(days=i)
            p = _moon_phase(d)
            days.append({"date": d.astimezone().date().isoformat(),
                         "icon": p["icon"], "name": p["name"],
                         "illumination": p["illumination"], "age": p["age"]})
        return jsonify({"ok": True, "days": days})

    @bp.route("/moon/year")
    def moon_year():
        now = datetime.now(timezone.utc)
        year = now.year
        src = "imcce"
        try:
            phases = _imcce_phases(year)
        except Exception:
            start = now.replace(month=1, day=1, hour=0, minute=0,
                                second=0, microsecond=0)
            phases = _phases_between(start, start.replace(year=year + 1))
            src = "local"
        eclipses = []
        try:
            eclipses = _imcce_eclipses(year)
        except Exception:
            pass
        return jsonify({"ok": True, "year": year, "phases": phases,
                        "eclipses": eclipses, "source": src})

    @bp.route("/geocode")
    def geocode():
        try:
            return jsonify(_geocode(sdk, request.args.get("q")))
        except Exception as e:
            sdk.log.exception("geocode")
            return jsonify({"ok": False, "reason": f"{type(e).__name__}: {e}"[:120]})

    return bp


def test(sdk, cfg):
    """Bouton « Tester » des réglages (reçoit les valeurs non sauvées)."""
    p = _moon_phase(datetime.now(timezone.utc))
    return True, (f"Calcul local ✓ — {p['icon']} {p['name']}, "
                  f"{p['illumination']} % éclairé")
