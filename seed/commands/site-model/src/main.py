"""
X000  Site model  (3D context for any location: buildings, roads, rail, water,
green, trees, transit stops, landmarks)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: SiteModel).

The hub of the site-analysis suite. Give it a latitude/longitude and a radius:
  * Buildings
      - in the Netherlands: 3D BAG (api.3dbag.nl), real measured buildings,
        LoD 2.2 roofs (or LoD 1.2 blocks), heights from AHN laser scans
      - elsewhere: OpenStreetMap footprints extruded from height /
        building:levels tags (defaults by building type when untagged)
  * Roads, paths, rail, water, green areas, trees, transit stops, landmarks:
    OpenStreetMap through the Overpass API (several mirrors, retries)
Model origin (0,0,0) = the Lat/Lon you give, +Y = true north, metres
(scaled to the document units), z = 0 at the site's ground level
(NAP datum is reported in the Netherlands). Terrain is treated as flat.
Downloads are cached on disk (system temp folder) so re-runs are instant.

GH INPUTS:
    Lat, Lon  : float  site centre (default 51.92, 4.48 Rotterdam)
    Radius    : float  metres around the centre (default 300, max 1500)
    LoD       : str    "2.2" roofs (default) or "1.2" blocks (3D BAG only)
    Source    : str    "auto" (3D BAG in NL, OSM elsewhere) or "osm"
    TransitR  : float  metres to look for stations/stops (default 1500)
    Refresh   : bool   True = ignore the cache and download again
    Labels    : str    "key" (default: stations + landmarks, thinned) | "all" | "off"
    Run       : bool   default True

GH OUTPUTS:
    buildings : list of Mesh (one per building)
    roads     : list of Mesh (road surfaces)       road_crv  : centrelines
    paths     : list of Mesh (foot/cycle paths)
    rail      : list of Curve (rail, tram, metro; tunnels included)
    water     : list of Mesh (areas + rivers/canals mapped as lines, by width tag or class)
    green     : list of Mesh
    bridges   : list of Mesh, road/path bridges, viaducts, flyovers as slabs (deck ~6 m per OSM layer)
    plazas    : list of Mesh (squares, pedestrian areas, platforms)   parking : surface car parks
    bld_est   : list of bool, True where the building height is estimated (no height/levels tag)
    trees     : one Mesh with all trees            tree_pts : tree positions
    stops     : Point3d, stops inside the circle   stop_names : "kind: name"
    labels    : label texts (Labels mode)          label_pts  : where they go
    ground    : site disc mesh
    landmarks : list of Point3d                    landmark_names
    boundary  : site circle
    site      : dict with everything above as plain data for other tools
                (lat, lon, radius, datum, buildings, stops, landmarks ...)
    info      : summary text

RHINO COMMAND / ALIAS:
    Alias  SiteModel  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\X000_site_model.py"
    Options: Latitude, Longitude, RadiusMetres, Roofs (LoD22/LoD12), Source (Auto/OSM),
    Refresh, Labels (Off/Key/All). Bakes on layers X000::Ground, Buildings, BuildingsEstimated
    (OSM height guessed from type), Bridges, Plazas, Parking, Roads, Paths,
    Rail, Water, Green, Trees, Transit + Landmarks (points, name on the object),
    Labels (flat plan text, height radius/75, key places only), Boundary.
    All stops within TransitR stay in the `site` data; the summary lists the nearest rail.

Data (c) OpenStreetMap contributors (ODbL); 3D BAG (c) 3DGI / TU Delft (CC BY 4.0).
"""
from __future__ import division, print_function
import math
import json

DEFAULTS = dict(Lat=51.92, Lon=4.48, Radius=300.0, LoD="2.2", Source="auto",
                TransitR=1500.0, Refresh=False, Run=True, Labels="key")
USER_AGENT = "GH-Library-X000-SiteModel/1.0"
OVERPASS = ["https://overpass-api.de/api/interpreter",
            "https://z.overpass-api.de/api/interpreter",
            "https://lz4.overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
# NOTE (2026-10): the overpass-api.de servers accept TLS 1.3 only. Rhino 7 / IronPython
# on Windows 10 cannot do TLS 1.3, so they fail there; the other mirrors still take TLS 1.2.
# MVRDV-inspired diagram palette: white massing, light ground, saturated pops
PALETTE = {"Buildings": (248, 248, 246), "Roads": (190, 190, 198), "Paths": (222, 220, 214),
           "Rail": (255, 64, 129), "Water": (0, 133, 255), "Green": (120, 220, 90),
           "Trees": (0, 170, 110), "Transit": (255, 120, 0), "Landmarks": (230, 0, 126),
           "Boundary": (255, 210, 0), "Ground": (238, 236, 231), "Labels": (60, 60, 60),
           "Plazas": (230, 226, 218), "Parking": (208, 208, 214), "Bridges": (176, 176, 186),
           "BuildingsEstimated": (236, 234, 228)}
BAG_URL = "https://api.3dbag.nl/collections/pand/items?bbox={0:.1f},{1:.1f},{2:.1f},{3:.1f}&limit=100"

# =============================================================== projections
def local_frame(lat0, lon0):
    """Return (ll2xy, xy2ll): WGS84 <-> local metres, origin lat0/lon0, +Y north.
    Uses the ellipsoid's radii of curvature at lat0 (error < 5 cm within 2 km)."""
    a, e2 = 6378137.0, 0.00669437999014
    s = math.sin(math.radians(lat0))
    M = a * (1 - e2) / (1 - e2 * s * s) ** 1.5           # meridian radius
    N = a / math.sqrt(1 - e2 * s * s)                     # prime vertical radius
    kx = math.radians(1) * N * math.cos(math.radians(lat0))
    ky = math.radians(1) * M

    def ll2xy(lat, lon):
        return ((lon - lon0) * kx, (lat - lat0) * ky)

    def xy2ll(x, y):
        return (lat0 + y / ky, lon0 + x / kx)
    return ll2xy, xy2ll

def in_netherlands(lat, lon):
    return 50.70 <= lat <= 53.60 and 3.30 <= lon <= 7.25

_RD_R = [(0, 1, 190094.945), (1, 1, -11832.228), (2, 1, -114.221), (0, 3, -32.391),
         (1, 0, -0.705), (3, 1, -2.340), (1, 3, -0.608), (0, 2, -0.008), (2, 3, 0.148)]
_RD_S = [(1, 0, 309056.544), (0, 2, 3638.893), (2, 0, 73.077), (1, 2, -157.984),
         (3, 0, 59.788), (0, 1, 0.433), (2, 2, -6.439), (1, 1, -0.032), (0, 4, 0.092),
         (1, 4, -0.054)]
_RD_K = [(0, 1, 3235.65389), (2, 0, -32.58297), (0, 2, -0.24750), (2, 1, -0.84978),
         (0, 3, -0.06550), (2, 2, -0.01709), (1, 0, -0.00738), (4, 0, 0.00530),
         (2, 3, -0.00039), (4, 1, 0.00033), (1, 1, -0.00012)]
_RD_L = [(1, 0, 5260.52916), (1, 1, 105.94684), (1, 2, 2.45656), (3, 0, -0.81885),
         (1, 3, 0.05594), (3, 1, -0.05607), (0, 1, 0.01199), (3, 2, -0.00256),
         (1, 4, 0.00128), (0, 2, 0.00022), (2, 0, -0.00022), (5, 0, 0.00026)]

def wgs_to_rd(lat, lon):
    """WGS84 -> Dutch RD New (EPSG:28992), approx. formulas, ~1 m."""
    dp, dl = 0.36 * (lat - 52.15517440), 0.36 * (lon - 5.38720621)
    x = 155000.0 + sum(c * dp ** p * dl ** q for p, q, c in _RD_R)
    y = 463000.0 + sum(c * dp ** p * dl ** q for p, q, c in _RD_S)
    return x, y

def rd_to_wgs(x, y):
    dx, dy = (x - 155000.0) * 1e-5, (y - 463000.0) * 1e-5
    lat = 52.15517440 + sum(c * dx ** p * dy ** q for p, q, c in _RD_K) / 3600.0
    lon = 5.38720621 + sum(c * dx ** p * dy ** q for p, q, c in _RD_L) / 3600.0
    return lat, lon

def rd_affine(lat0, lon0):
    """Similarity transform RD -> local frame fitted at the site (rotation for
    meridian convergence + scale). Returns (rd0, f(X, Y) -> (x, y))."""
    ll2xy, _ = local_frame(lat0, lon0)
    X0, Y0 = wgs_to_rd(lat0, lon0)
    o = ll2xy(*rd_to_wgs(X0, Y0))
    ex = ll2xy(*rd_to_wgs(X0 + 500.0, Y0))
    ey = ll2xy(*rd_to_wgs(X0, Y0 + 500.0))
    a, c = (ex[0] - o[0]) / 500.0, (ex[1] - o[1]) / 500.0
    b, d = (ey[0] - o[0]) / 500.0, (ey[1] - o[1]) / 500.0

    def f(X, Y):
        u, v = X - X0, Y - Y0
        return (o[0] + a * u + b * v, o[1] + c * u + d * v)
    return (X0, Y0), f

# =============================================================== downloading
def _net_tls():
    """Let .NET use TLS 1.3 where Windows supports it (Win 11), else TLS 1.2."""
    import System
    SP = System.Net.ServicePointManager
    T = System.Net.SecurityProtocolType
    try:
        SP.SecurityProtocol = T.Tls12 | System.Enum.ToObject(T, 12288)    # 12288 = Tls13
    except Exception:
        SP.SecurityProtocol = T.Tls12

def _http_net(url, data, timeout):
    import System
    _net_tls()
    req = System.Net.WebRequest.Create(url)
    req.Timeout = int(timeout * 1000)
    req.UserAgent = USER_AGENT
    if data:
        try:
            from urllib import urlencode
        except ImportError:
            from urllib.parse import urlencode
        body = System.Text.Encoding.UTF8.GetBytes(urlencode(data))
        req.Method = "POST"
        req.ContentType = "application/x-www-form-urlencoded"
        req.ContentLength = body.Length
        st = req.GetRequestStream(); st.Write(body, 0, body.Length); st.Close()
    try:
        resp = req.GetResponse()
    except System.Net.WebException as we:
        r = getattr(we, "Response", None)
        code = int(r.StatusCode) if r is not None else None
        raise IOError("HTTP {0}".format(code) if code else str(we.Message))
    rd = System.IO.StreamReader(resp.GetResponseStream(), System.Text.Encoding.UTF8)
    txt = rd.ReadToEnd(); rd.Close(); resp.Close()
    return txt

def _http_py(url, data, timeout):
    try:
        from urllib.request import urlopen, Request
        from urllib.parse import urlencode
    except ImportError:                                  # IronPython 2.7
        from urllib2 import urlopen, Request
        from urllib import urlencode
    body = urlencode(data).encode("utf-8") if data else None
    req = Request(url, body, {"User-Agent": USER_AGENT})
    raw = urlopen(req, timeout=timeout).read()
    return raw.decode("utf-8") if not isinstance(raw, str) else raw

def _http(url, data=None, timeout=90):
    """GET (data None) or POST form data; returns text. IronPython: .NET first (its own
    ssl is too old), then urllib. CPython (Rhino 8): urllib first, then .NET."""
    import sys
    order = [_http_net, _http_py] if sys.platform == "cli" else [_http_py, _http_net]
    errs = []
    for fn in order:
        try:
            return fn(url, data, timeout)
        except ImportError:
            continue
        except Exception as e:
            msg = str(e).split("\n")[0][:160]
            errs.append(msg)
    raise IOError(" | ".join(errs) or "no HTTP client")

def _cache_path(key):
    import os, tempfile, hashlib
    h = hashlib.md5(key.encode("utf-8")).hexdigest()[:16]
    return os.path.join(tempfile.gettempdir(), "x000_site_" + h + ".json")

def cached(key, fetch, refresh=False):
    import os
    p = _cache_path(key)
    if not refresh and os.path.exists(p):
        try:
            with open(p) as f:
                return json.load(f)
        except Exception:
            pass
    data = fetch()
    if data is None:
        return None
    try:
        with open(p, "w") as f:
            json.dump(data, f)
    except Exception:
        pass
    return data

def overpass_query(lat, lon, r, rt):
    a = "(around:{0:.0f},{1:.6f},{2:.6f})".format(r, lat, lon)
    t = "(around:{0:.0f},{1:.6f},{2:.6f})".format(max(r, rt), lat, lon)
    q = ["[out:json][timeout:120];("]
    for sel in ['way["building"]', 'relation["building"]', 'way["building:part"]',
                'way["highway"]', 'way["railway"~"^(rail|subway|tram|light_rail|narrow_gauge)$"]',
                'way["natural"~"^(water|wood|scrub|grassland)$"]', 'relation["natural"="water"]',
                'way["waterway"~"^(riverbank|dock|river|stream|canal|drain|ditch)$"]',
                'way["area:highway"]', 'way["place"="square"]', 'relation["place"="square"]',
                'relation["highway"="pedestrian"]', 'way["amenity"="parking"]',
                'way["railway"="platform"]', 'way["public_transport"="platform"]', 'way["landuse"~"^(basin|reservoir|grass|forest|meadow|recreation_ground|village_green)$"]',
                'relation["landuse"~"^(grass|forest)$"]', 'way["leisure"~"^(park|garden|playground|pitch)$"]',
                'relation["leisure"="park"]', 'node["natural"="tree"]', 'way["natural"="tree_row"]']:
        q.append(sel + a + ";")
    for sel in ['nwr["railway"~"^(station|halt|subway_entrance|tram_stop)$"]',
                'node["highway"="bus_stop"]', 'nwr["public_transport"="station"]']:
        q.append(sel + t + ";")
    for sel in ['nwr["tourism"~"^(attraction|museum|viewpoint)$"]["name"]',
                'nwr["historic"]["historic"!~"^(memorial|plaque|boundary_stone|wayside_cross|milestone|stone)$"]["name"]',
                'nwr["man_made"~"^(tower|lighthouse|windmill)$"]["name"]']:
        q.append(sel + a + ";")
    q.append(");out body geom qt;")            # body: relations keep their members
    return "".join(q)

def fetch_osm(lat, lon, r, rt, retries=2):
    import time
    q = overpass_query(lat, lon, r, rt)
    errors = []
    for attempt in range(retries + 1):
        for url in OVERPASS:
            try:
                txt = _http(url, {"data": q}, timeout=150)
                if txt.lstrip().startswith("{"):
                    d = json.loads(txt)
                    if "elements" in d:
                        return d["elements"]
                errors.append(url + ": not JSON (server busy)")
            except Exception as e:
                errors.append("{0}: {1}".format(url, e))
        time.sleep(4 * (attempt + 1))
    raise IOError("Overpass failed on all mirrors: " + " ; ".join(errors[-len(OVERPASS):]))

def fetch_3dbag(lat, lon, r, max_pages=60, log=None):
    """All 3D BAG features whose bbox touches the site square (RD coordinates).
    Each page carries its own vertex transform, so pages are returned as-is."""
    X0, Y0 = wgs_to_rd(lat, lon)
    url = BAG_URL.format(X0 - r, Y0 - r, X0 + r, Y0 + r)
    pages = []
    while url and len(pages) < max_pages:
        txt = None
        for k in range(3):
            try:
                txt = _http(url, timeout=90)
                break
            except Exception:
                import time
                time.sleep(2 * (k + 1))
        if txt is None:
            raise IOError("3D BAG download failed at page {0}".format(len(pages) + 1))
        d = json.loads(txt)
        t = d.get("metadata", {}).get("transform", {"scale": [1, 1, 1], "translate": [0, 0, 0]})
        pages.append({"transform": t, "features": d.get("features", [])})
        if log:
            log("3D BAG page {0}: {1} of {2}".format(len(pages), sum(len(p["features"]) for p in pages),
                                                     d.get("numberMatched", "?")))
        url = None
        for l in d.get("links", []):
            if l.get("rel") == "next":
                url = l.get("href")
    return pages

# =============================================================== polygon maths
def area2(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts))) / 2.0

def point_in_poly(p, poly):
    x, y = p[0], p[1]
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi, xj, yj = poly[i][0], poly[i][1], poly[j][0], poly[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside

def _clean(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) <= eps and abs(out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out

def _seg_cross(a, b, c, d):
    def o(p, q, r):
        v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return 0 if abs(v) < 1e-12 else (1 if v > 0 else -1)
    return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0

def _bridge(outer, hole):
    """Join a hole into the outer ring (indices list) with a zero-width cut."""
    hi = max(range(len(hole)), key=lambda i: hole[i][0])
    hp = hole[hi]
    best, bd = None, 1e300
    edges = [(outer[i], outer[(i + 1) % len(outer)]) for i in range(len(outer))]
    edges += [(hole[i], hole[(i + 1) % len(hole)]) for i in range(len(hole))]
    for i, op in enumerate(outer):
        d = (op[0] - hp[0]) ** 2 + (op[1] - hp[1]) ** 2
        if d >= bd:
            continue
        if any(_seg_cross(hp, op, e0, e1) for e0, e1 in edges):
            continue
        best, bd = i, d
    if best is None:
        best = min(range(len(outer)), key=lambda i: (outer[i][0] - hp[0]) ** 2 + (outer[i][1] - hp[1]) ** 2)
    ring = hole[hi:] + hole[:hi + 1]
    return outer[:best + 1] + ring + outer[best:]

def triangulate(outer, holes=None):
    """Ear-clipping triangulation of a 2D polygon with holes.
    Points are (x, y, idx) tuples; returns triangles as idx triples."""
    o = list(outer)
    if area2(o) < 0:
        o.reverse()
    for h in sorted(holes or [], key=lambda h: -max(p[0] for p in h)):
        h = list(h)
        if len(h) < 3:
            continue
        if area2(h) > 0:
            h.reverse()
        o = _bridge(o, h)
    tris = []
    V = list(o)
    guard = 0
    while len(V) > 3 and guard < 5 * len(o) + 50:
        guard += 1
        n = len(V)
        cut = False
        reflex = []                                       # only these can sit inside an ear
        for i in range(n):
            a, b, c = V[i - 1], V[i], V[(i + 1) % n]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-12:
                reflex.append(b)
        for i in range(n):
            a, b, c = V[i - 1], V[i], V[(i + 1) % n]
            cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if cr <= 1e-12:
                continue
            ok = True
            for p in reflex:
                if p is a or p is b or p is c or (p[0] == a[0] and p[1] == a[1]) \
                        or (p[0] == b[0] and p[1] == b[1]) or (p[0] == c[0] and p[1] == c[1]):
                    continue
                d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
                d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0])
                d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0])
                if d1 >= 0 and d2 >= 0 and d3 >= 0:
                    ok = False
                    break
            if ok:
                tris.append((a[2], b[2], c[2]))
                V.pop(i)
                cut = True
                break
        if not cut:                                       # degenerate: fan out
            for i in range(1, len(V) - 1):
                tris.append((V[0][2], V[i][2], V[i + 1][2]))
            V = []
            break
    if len(V) == 3:
        tris.append((V[0][2], V[1][2], V[2][2]))
    return [t for t in tris if len(set(t)) == 3]

def triangulate3d(verts, rings):
    """rings = [outer idx list, hole idx lists...] on a planar 3D face."""
    nx = ny = nz = 0.0
    r0 = rings[0]
    for i in range(len(r0)):
        p, q = verts[r0[i]], verts[r0[(i + 1) % len(r0)]]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    ax = max((abs(nx), 0), (abs(ny), 1), (abs(nz), 2))[1]
    i0, i1 = [(1, 2), (2, 0), (0, 1)][ax]
    sgn = [nx, ny, nz][ax]
    flip = sgn < 0

    def P(i):
        v = verts[i]
        return (v[i0], -v[i1] if flip else v[i1], i)
    return triangulate([P(i) for i in r0], [[P(i) for i in h] for h in rings[1:]])

# =============================================================== OSM parsing
ROAD_W = {"motorway": 14.0, "trunk": 12.0, "primary": 10.0, "secondary": 9.0, "tertiary": 7.5,
          "unclassified": 6.0, "residential": 6.0, "living_street": 5.0, "service": 4.0,
          "busway": 4.0, "motorway_link": 6.0, "trunk_link": 6.0, "primary_link": 6.0,
          "secondary_link": 6.0, "tertiary_link": 5.0, "road": 6.0}
PATH_W = {"pedestrian": 6.0, "footway": 2.0, "cycleway": 2.5, "path": 1.8, "steps": 2.0,
          "track": 3.0, "bridleway": 2.0, "corridor": 2.0}
WATERWAY_W = {"river": 25.0, "canal": 12.0, "stream": 3.0, "drain": 2.0, "ditch": 1.5}
DECK_H = 6.0          # metres per OSM layer for bridges / viaducts / flyovers (estimate)
LANE_W = 3.25

def road_width(t, hw, lanes):
    """Carriageway width when no width tag: lanes, else lanes:forward/backward, else class default.
    One-way roads with no lane count get ~60% of the class width."""
    if not lanes:
        lf, lb = _num(t.get("lanes:forward")), _num(t.get("lanes:backward"))
        if lf or lb:
            lanes = (lf or 0) + (lb or 0)
    if lanes:
        w = lanes * LANE_W + 1.0
    else:
        w = ROAD_W[hw]
        if t.get("oneway") in ("yes", "-1") and hw not in ("motorway", "motorway_link", "trunk_link",
                                                          "primary_link", "secondary_link", "tertiary_link"):
            w *= 0.6
    if t.get("sidewalk") in ("both", "left", "right", "separate") and t.get("sidewalk") != "separate":
        w += 2.0 * (2 if t.get("sidewalk") == "both" else 1)
    return w

def deck_level(t):
    """Height above ground (m) of a bridge / viaduct / flyover deck, 0 if at grade."""
    if t.get("bridge") in (None, "no") and t.get("man_made") != "bridge":
        lv = t.get("layer", "0").strip()
        try:
            lv = int(float(lv))
        except ValueError:
            lv = 0
        return DECK_H * lv if lv > 0 and t.get("highway") in ROAD_W else 0.0   # elevated roads w/o bridge tag
    try:
        lv = int(float(t.get("layer", "1")))
    except ValueError:
        lv = 1
    return DECK_H * max(1, lv)

TYPE_H = {"house": 8.0, "detached": 8.0, "semidetached_house": 8.0, "terrace": 9.0,
          "bungalow": 4.0, "garage": 3.0, "garages": 3.0, "shed": 2.5, "roof": 4.0, "carport": 3.0,
          "hut": 3.0, "kiosk": 3.0, "apartments": 15.0, "residential": 12.0, "commercial": 14.0,
          "office": 18.0, "retail": 6.0, "industrial": 9.0, "warehouse": 9.0, "church": 18.0,
          "cathedral": 30.0, "school": 10.0, "university": 15.0, "hospital": 18.0, "hotel": 20.0,
          "train_station": 12.0, "parking": 10.0}

def _num(s):
    if s is None:
        return None
    s = str(s).strip().lower().replace(",", ".")
    num = ""
    for ch in s:
        if ch.isdigit() or (ch == "." and "." not in num) or (ch == "-" and not num):
            num += ch
        elif num:
            break
    try:
        v = float(num)
    except ValueError:
        return None
    if "ft" in s or "'" in s:
        v *= 0.3048
    return v

def building_height(t):
    """(base, top) metres from OSM tags."""
    h = _num(t.get("height")) or _num(t.get("building:height"))
    lv = _num(t.get("building:levels"))
    rl = _num(t.get("roof:levels")) or 0.0
    if not h and lv:
        h = lv * 3.2 + rl * 2.0 + (1.0 if lv > 0 else 0)
    if not h:
        h = TYPE_H.get(t.get("building") or t.get("building:part"), 9.0)
        t["_est"] = 1
    base = _num(t.get("min_height"))
    if base is None:
        ml = _num(t.get("building:min_level"))
        base = ml * 3.2 if ml else 0.0
    return base, max(h, base + 1.0)

def is_underground(t):
    """True for mapped-underground structures (metro stations, car parks) that must not be extruded."""
    if t.get("location") in ("underground", "underwater"):
        return True
    lv = _num(t.get("building:levels"))
    return t.get("layer", "0").strip().startswith("-") and (lv is None or lv <= 0) and not _num(t.get("height"))

def _stitch(ways):
    """Join open ways (lists of points) into closed rings."""
    rings, parts = [], [list(w) for w in ways if len(w) >= 2]
    while parts:
        cur = parts.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for k, p in enumerate(parts):
                if p[0] == cur[-1]:
                    cur += p[1:]
                elif p[-1] == cur[-1]:
                    cur += p[::-1][1:]
                elif p[-1] == cur[0]:
                    cur = p[:-1] + cur
                elif p[0] == cur[0]:
                    cur = p[::-1][:-1] + cur
                else:
                    continue
                parts.pop(k)
                changed = True
                break
        if len(cur) >= 4 and cur[0] == cur[-1]:
            rings.append(cur)
    return rings

def _areas(e, proj):
    """[(outer_xy, [holes_xy])] for a closed way or multipolygon relation."""
    def xy(geom):
        return _clean([proj(g["lat"], g["lon"]) for g in geom])
    if e["type"] == "way":
        g = e.get("geometry") or []
        if len(g) >= 4 and g[0] == g[-1]:
            return [(xy(g), [])]
        return []
    outers, inners = [], []
    for m in e.get("members", []):
        if m.get("type") != "way" or not m.get("geometry"):
            continue
        pts = [(round(g["lat"], 7), round(g["lon"], 7)) for g in m["geometry"]]
        (inners if m.get("role") == "inner" else outers).append(pts)
    res = []
    O = [_clean([proj(a, b) for a, b in r]) for r in _stitch(outers)]
    H = [_clean([proj(a, b) for a, b in r]) for r in _stitch(inners)]
    for o in O:
        res.append((o, [h for h in H if h and point_in_poly(h[0], o)]))
    return res

def _line(e, proj):
    return _clean([proj(g["lat"], g["lon"]) for g in (e.get("geometry") or [])])

def _centre(e, proj):
    if "lat" in e:
        return proj(e["lat"], e["lon"])
    b = e.get("bounds")
    if b:
        return proj((b["minlat"] + b["maxlat"]) / 2.0, (b["minlon"] + b["maxlon"]) / 2.0)
    g = e.get("geometry") or []
    if g:
        return proj(sum(p["lat"] for p in g) / len(g), sum(p["lon"] for p in g) / len(g))
    return None

def stop_kind(t):
    if t.get("station") == "subway" or t.get("subway") == "yes" or t.get("railway") == "subway_entrance":
        return "metro" if t.get("railway") != "subway_entrance" else "metro entrance"
    if t.get("railway") == "tram_stop" or t.get("tram") == "yes" and t.get("train") != "yes":
        return "tram"
    if t.get("highway") == "bus_stop" or t.get("bus") == "yes" and t.get("railway") is None:
        return "bus"
    if t.get("railway") in ("station", "halt") or t.get("train") == "yes":
        return "train"
    return "station"

def parse_osm(elements, proj, r, rt):
    """Sort OSM elements into site layers (local metres)."""
    S = dict(buildings=[], parts=[], roads=[], paths=[], rail=[], water=[], green=[],
             trees=[], stops=[], landmarks=[], waterways=[], plazas=[], parking=[])
    seen_stop = set()
    for e in elements:
        t = e.get("tags", {})
        if "building:part" in t and e["type"] == "way":
            if is_underground(t):
                continue
            for o, h in _areas(e, proj):
                b, top = building_height(t)
                S["parts"].append(dict(outer=o, holes=h, base=b, top=top, name=t.get("name", ""),
                                       est=bool(t.get("_est"))))
            continue
        if "building" in t and e["type"] in ("way", "relation"):
            if t.get("name") and (t.get("wikidata") or t.get("tourism") or t.get("historic")):
                c = _centre(e, proj)
                if c and c[0] ** 2 + c[1] ** 2 <= r * r:
                    S["landmarks"].append(dict(x=c[0], y=c[1], name=t["name"],
                                               kind=t.get("tourism") or t.get("historic") or "building",
                                               wd=bool(t.get("wikidata") or t.get("wikipedia"))))
            if is_underground(t):
                continue
            for o, h in _areas(e, proj):
                b, top = building_height(t)
                S["buildings"].append(dict(outer=o, holes=h, base=b, top=top, est=bool(t.get("_est")),
                                           name=t.get("name", ""), bag=t.get("ref:bag", "")))
            continue
        hw = t.get("highway")
        ahw = t.get("area:highway")
        if ahw or (hw and t.get("area") == "yes") or t.get("place") == "square" or \
                t.get("railway") == "platform" and e["type"] == "way" and (e.get("geometry") or [0])[0] == \
                (e.get("geometry") or [1])[-1] or t.get("public_transport") == "platform" and e["type"] == "way" \
                and "highway" not in t and (e.get("geometry") or [0])[0] == (e.get("geometry") or [1])[-1]:
            if is_underground(t) or t.get("tunnel") == "yes":
                continue
            kind = ahw or ("square" if t.get("place") == "square" else hw or "platform")
            if kind in ("emergency", "construction"):
                continue
            z = 0.9 if kind == "platform" else 0.012     # under green/roads: squares often wrap lawns
            S["plazas"] += [dict(outer=o, holes=hh, kind=kind, z=z) for o, hh in _areas(e, proj)]
            continue
        if t.get("amenity") == "parking":
            if t.get("parking") in ("underground", "multi-storey", "rooftop") or "building" in t:
                continue
            S["parking"] += [dict(outer=o, holes=hh) for o, hh in _areas(e, proj)]
            continue
        ww0 = t.get("waterway")
        if e["type"] == "way" and ww0 in WATERWAY_W:
            if t.get("tunnel") in ("yes", "culvert") or t.get("layer", "0").startswith("-"):
                continue
            pts = _line(e, proj)
            if len(pts) >= 2:
                S["waterways"].append(dict(pts=pts, kind=ww0, name=t.get("name", ""),
                                           width=_num(t.get("width")) or WATERWAY_W[ww0],
                                           est=not _num(t.get("width"))))
            continue
        if e["type"] == "way" and hw and t.get("area") != "yes":
            pts = _line(e, proj)
            if len(pts) < 2 or hw in ("construction", "proposed", "platform", "elevator", "raceway"):
                continue
            w = _num(t.get("width"))
            lanes = _num(t.get("lanes"))
            tun = t.get("tunnel") in ("yes", "building_passage", "culvert") or t.get("layer", "0").startswith("-")
            dk = deck_level(t)
            if hw in ROAD_W:
                wsrc = "width" if w else ("lanes" if lanes else "class")
                if not w:
                    w = road_width(t, hw, lanes)
                S["roads"].append(dict(pts=pts, width=w, kind=hw, name=t.get("name", ""), tunnel=tun,
                                       deck=dk, wsrc=wsrc))
            else:
                S["paths"].append(dict(pts=pts, width=w or PATH_W.get(hw, 2.0), kind=hw,
                                       name=t.get("name", ""), tunnel=tun, deck=dk))
            continue
        rw = t.get("railway")
        if e["type"] == "way" and rw in ("rail", "subway", "tram", "light_rail", "narrow_gauge"):
            pts = _line(e, proj)
            if len(pts) >= 2:
                S["rail"].append(dict(pts=pts, kind=rw, tunnel=t.get("tunnel") == "yes" or rw == "subway"
                                      and t.get("tunnel") != "no" and t.get("bridge") in (None, "no"),
                                      name=t.get("name", ""), deck=deck_level(t)))
            continue
        if t.get("natural") == "tree" and e["type"] == "node":
            x, y = proj(e["lat"], e["lon"])
            if x * x + y * y <= r * r:
                h = _num(t.get("height")) or 10.0
                c = _num(t.get("diameter_crown")) or max(3.0, min(12.0, h * 0.6))
                S["trees"].append((x, y, h, c))
            continue
        if t.get("natural") == "tree_row" and e["type"] == "way":
            pts = _line(e, proj)
            for x, y in resample(pts, 8.0):
                if x * x + y * y <= r * r:
                    S["trees"].append((x, y, 9.0, 5.5))
            continue
        nat, lu, le, ww = t.get("natural"), t.get("landuse"), t.get("leisure"), t.get("waterway")
        if nat == "water" or ww in ("riverbank", "dock") or lu in ("basin", "reservoir"):
            if t.get("water") in ("wastewater",) or t.get("covered") == "yes":
                continue
            S["water"] += [dict(outer=o, holes=h) for o, h in _areas(e, proj)]
            continue
        if nat in ("wood", "scrub", "grassland") or lu in ("grass", "forest", "meadow",
                                                           "recreation_ground", "village_green") \
                or le in ("park", "garden", "playground", "pitch"):
            S["green"] += [dict(outer=o, holes=h, kind=nat or lu or le) for o, h in _areas(e, proj)]
            continue
        is_stop = rw in ("station", "halt", "subway_entrance", "tram_stop") or hw == "bus_stop" \
            or t.get("public_transport") == "station"
        if is_stop:
            c = _centre(e, proj)
            if c and c[0] ** 2 + c[1] ** 2 <= max(r, rt) ** 2:
                k = stop_kind(t)
                nm = t.get("name", "")
                key = (k, nm, round(c[0] / 40), round(c[1] / 40))
                if key not in seen_stop:
                    seen_stop.add(key)
                    S["stops"].append(dict(x=c[0], y=c[1], kind=k, name=nm))
            continue
        if t.get("name") and (t.get("tourism") or t.get("historic") or t.get("man_made")):
            c = _centre(e, proj)
            if c and c[0] ** 2 + c[1] ** 2 <= r * r:
                S["landmarks"].append(dict(x=c[0], y=c[1], name=t["name"],
                                           kind=t.get("tourism") or t.get("historic") or t.get("man_made"),
                                           wd=bool(t.get("wikidata") or t.get("wikipedia"))))
    seen, lm = set(), []
    for l in S["landmarks"]:
        if l["name"] not in seen:
            seen.add(l["name"]); lm.append(l)
    S["landmarks"] = lm
    # building parts replace the outline they sit in (OSM 3D convention)
    if S["parts"]:
        keep = []
        for b in S["buildings"]:
            if not any(point_in_poly(_poly_centroid(p["outer"]), b["outer"]) for p in S["parts"]):
                keep.append(b)
        S["buildings"] = keep + S["parts"]
    del S["parts"]
    return S

def resample(pts, step):
    out = []
    acc = 0.0
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        L = math.hypot(x1 - x0, y1 - y0)
        d = step - acc if out else 0.0
        while d <= L:
            out.append((x0 + (x1 - x0) * d / L, y0 + (y1 - y0) * d / L))
            d += step
        acc = (acc + L) % step if out else 0.0
    return out

def _poly_centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

# =============================================================== clipping to site
def circle_poly(r, n=72):
    return [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)) for k in range(n)]

def clip_convex(poly, clip):
    """Sutherland-Hodgman: polygon clipped by a convex CCW polygon."""
    out = list(poly)
    for i in range(len(clip)):
        a, b = clip[i], clip[(i + 1) % len(clip)]
        inp, out = out, []
        if not inp:
            break

        def side(p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        for j in range(len(inp)):
            p, q = inp[j - 1], inp[j]
            sp, sq = side(p), side(q)
            if sq >= 0:
                if sp < 0:
                    t = sp / (sp - sq)
                    out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
                out.append(q)
            elif sp >= 0:
                t = sp / (sp - sq)
                out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return _clean(out)

def clip_area(outer, holes, r):
    c = circle_poly(r)
    if all(x * x + y * y <= r * r for x, y in outer):
        return outer, holes
    o = clip_convex(outer, c)
    if len(o) < 3 or abs(area2(o)) < 1.0:
        return None, []
    hs = [clip_convex(h, c) for h in holes]
    return o, [h for h in hs if len(h) >= 3 and abs(area2(h)) > 0.5]

def clip_line(pts, r):
    """Polyline -> list of pieces inside the circle."""
    pieces, cur = [], []
    r2 = r * r

    def inside(p):
        return p[0] * p[0] + p[1] * p[1] <= r2

    def cross(p, q):
        dx, dy = q[0] - p[0], q[1] - p[1]
        a = dx * dx + dy * dy
        b = 2 * (p[0] * dx + p[1] * dy)
        c = p[0] * p[0] + p[1] * p[1] - r2
        disc = b * b - 4 * a * c
        if a == 0 or disc < 0:
            return []
        sq = math.sqrt(disc)
        return sorted(t for t in ((-b - sq) / (2 * a), (-b + sq) / (2 * a)) if 0 < t < 1)
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        ts = cross(p, q)
        if inside(p) and not cur:
            cur = [p]
        for t in ts:
            x = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
            if cur:
                cur.append(x)
                pieces.append(cur)
                cur = []
            else:
                cur = [x]
        if inside(q) and cur:
            cur.append(q)
    if len(cur) >= 2:
        pieces.append(cur)
    return [_clean(c) for c in pieces if len(_clean(c)) >= 2]

def densify(pts, step):
    out = [pts[0]]
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        n = max(1, int(math.ceil(math.hypot(x1 - x0, y1 - y0) / step)))
        for k in range(1, n + 1):
            out.append((x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n))
    return out

def apply_decks(S):
    """Give bridges / viaducts / flyovers a z per vertex: deck height, ramping to 0 at ends that
    meet an at-grade way (ramp ~5% roads, 3% rail, 8% paths, never more than ~45% of the span)."""
    key = lambda p: (int(round(p[0] * 5)), int(round(p[1] * 5)))
    grade = set()
    for k in ("roads", "paths", "rail"):
        for l in S[k]:
            if not l.get("deck") and not l.get("tunnel"):
                for p in l["pts"]:
                    grade.add(key(p))
    slope = dict(roads=0.05, paths=0.08, rail=0.03)
    for k in ("roads", "paths", "rail"):
        for l in S[k]:
            d = l.get("deck") or 0.0
            if d <= 0 or l.get("tunnel"):
                continue
            z0 = 0.0 if key(l["pts"][0]) in grade else d
            z1 = 0.0 if key(l["pts"][-1]) in grade else d
            pts = densify(l["pts"], 5.0)
            s_ = [0.0]
            for i in range(1, len(pts)):
                s_.append(s_[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
            L = s_[-1] or 1.0
            if z0 == 0.0 and z1 == 0.0:         # bridge between at-grade ends: gentle hump, not a 6 m spike
                ramp = max(1.0, min(d / slope[k], L * 0.45))
                d = min(d, slope[k] * ramp)
            else:                               # approach ramp: reach the deck it connects to
                ramp = max(1.0, min(d / slope[k], L))
            l["pts"] = pts
            l["z"] = [min(d, z0 + (d - z0) * si / ramp, z1 + (d - z1) * (L - si) / ramp) for si in s_]
    return S

def _z_at(pts, zs, p):
    best, bz = 1e18, 0.0
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        dx, dy = x1 - x0, y1 - y0
        a = dx * dx + dy * dy
        t = 0.0 if a == 0 else max(0.0, min(1.0, ((p[0] - x0) * dx + (p[1] - y0) * dy) / a))
        q = (x0 + dx * t - p[0]) ** 2 + (y0 + dy * t - p[1]) ** 2
        if q < best:
            best, bz = q, zs[i] + (zs[i + 1] - zs[i]) * t
    return bz

def clip_site(S, r):
    for k in ("plazas", "parking"):
        keep = []
        for a in S.get(k, []):
            o, h = clip_area(a["outer"], a["holes"], r)
            if o:
                a = dict(a); a["outer"], a["holes"] = o, h
                keep.append(a)
        S[k] = keep
    for k in ("waterways",):
        keep = []
        for l in S.get(k, []):
            for piece in clip_line(l["pts"], r + l["width"] / 2.0):
                d = dict(l); d["pts"] = piece
                keep.append(d)
        S[k] = keep
    for k in ("water", "green"):
        keep = []
        for a in S[k]:
            o, h = clip_area(a["outer"], a["holes"], r)
            if o:
                a = dict(a); a["outer"], a["holes"] = o, h
                keep.append(a)
        S[k] = keep
    for k in ("roads", "paths", "rail"):
        keep = []
        for l in S[k]:
            for piece in clip_line(l["pts"], r):
                d = dict(l); d["pts"] = piece
                if l.get("z"):
                    d["z"] = [_z_at(l["pts"], l["z"], q) for q in piece]
                keep.append(d)
        S[k] = keep
    return S

# =============================================================== mesh builders
def extrude_mesh(outer, holes, base, top):
    """Closed prism mesh from a footprint with holes. Returns (verts, faces)."""
    rings = [outer] + [h for h in holes if len(h) >= 3]
    V, F = [], []
    ring_idx = []
    for ring in rings:
        bi = len(V)
        for x, y in ring:
            V.append((x, y, base))
        ti = len(V)
        for x, y in ring:
            V.append((x, y, top))
        ring_idx.append((bi, ti, len(ring)))
    # walls (orientation made consistent: outer CCW, holes CW)
    for k, (bi, ti, n) in enumerate(ring_idx):
        ccw = area2(rings[k]) > 0
        want_ccw = (k == 0)
        for i in range(n):
            j = (i + 1) % n
            a, b = (i, j) if ccw == want_ccw else (j, i)
            F.append((bi + a, bi + b, ti + b, ti + a))
    pts_top = [[(V[ti + i][0], V[ti + i][1], ti + i) for i in range(n)] for bi, ti, n in ring_idx]
    pts_bot = [[(V[bi + i][0], V[bi + i][1], bi + i) for i in range(n)] for bi, ti, n in ring_idx]
    for a, b, c in triangulate(pts_top[0], pts_top[1:]):
        F.append((a, b, c))
    for a, b, c in triangulate(pts_bot[0], pts_bot[1:]):
        F.append((c, b, a))
    return V, F

def flat_mesh(outer, holes, z):
    V = [(x, y, z) for x, y in outer]
    pts_o = [(x, y, i) for i, (x, y) in enumerate(outer)]
    H = []
    for h in holes:
        if len(h) < 3:
            continue
        s = len(V)
        V += [(x, y, z) for x, y in h]
        H.append([(x, y, s + i) for i, (x, y) in enumerate(h)])
    return V, [tuple(t) for t in triangulate(pts_o, H)]

def ribbon(pts, w, z, mitre=3.0):
    """Flat strip mesh of width w along a polyline."""
    n = len(pts)
    if n < 2:
        return [], []
    L, R = [], []
    h = w / 2.0
    for i in range(n):
        if i == 0:
            dx, dy = pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]
            m = 1.0
        elif i == n - 1:
            dx, dy = pts[-1][0] - pts[-2][0], pts[-1][1] - pts[-2][1]
            m = 1.0
        else:
            ax, ay = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
            bx, by = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
            la, lb = math.hypot(ax, ay) or 1.0, math.hypot(bx, by) or 1.0
            dx, dy = ax / la + bx / lb, ay / la + by / lb
            cosh = (ax * bx + ay * by) / (la * lb)
            m = min(mitre, 1.0 / max(1e-3, math.sqrt((1 + cosh) / 2.0)))
        l = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / l * h * m, dx / l * h * m
        zi = z[i] if isinstance(z, (list, tuple)) else z
        L.append((pts[i][0] + nx, pts[i][1] + ny, zi))
        R.append((pts[i][0] - nx, pts[i][1] - ny, zi))
    V = L + R
    F = [(i, n + i, n + i + 1, i + 1) for i in range(n - 1)]
    return V, F

def deck_mesh(pts, w, zs, t=0.9):
    """Closed slab along a polyline: top at zs, underside t below (bridges, flyovers)."""
    Vt, F = ribbon(pts, w, [z + 0.05 for z in zs])
    if not F:
        return [], []
    n = len(pts)
    Vb = [(x, y, z - t) for x, y, z in Vt]
    V = Vt + Vb
    m = len(Vt)
    F2 = list(F) + [(a + m, d + m, c + m, b + m) for a, b, c, d in F]
    for i in range(n - 1):                      # side walls: L side (0..n-1) and R side (n..2n-1)
        F2.append((i, i + 1, i + 1 + m, i + m))
        F2.append((n + i + m, n + i + 1 + m, n + i + 1, n + i))
    F2.append((0, m, n + m, n)); F2.append((n - 1, 2 * n - 1, 2 * n - 1 + m, n - 1 + m))
    return V, F2

def tree_mesh(x, y, h, crown, seg=6):
    """Low-poly tree: hexagonal trunk + faceted ellipsoid crown."""
    V, F = [], []
    tr = max(0.15, crown * 0.04)
    trunk_top = h * 0.45
    for k in range(seg):
        a = 2 * math.pi * k / seg
        V.append((x + tr * math.cos(a), y + tr * math.sin(a), 0.0))
        V.append((x + tr * math.cos(a), y + tr * math.sin(a), trunk_top))
    for k in range(seg):
        j = (k + 1) % seg
        F.append((2 * k, 2 * j, 2 * j + 1, 2 * k + 1))
    cz, rz, rr = (h + trunk_top * 0.8) / 2.0, (h - trunk_top * 0.8) / 2.0, crown / 2.0
    s = len(V)
    V.append((x, y, cz + rz))
    for ring, (zf, rf) in enumerate(((0.55, 0.83), (-0.55, 0.83))):
        for k in range(seg):
            a = 2 * math.pi * (k + 0.5 * ring) / seg
            V.append((x + rr * rf * math.cos(a), y + rr * rf * math.sin(a), cz + rz * zf))
    V.append((x, y, cz - rz))
    top, r1, r2, bot = s, s + 1, s + 1 + seg, s + 1 + 2 * seg
    for k in range(seg):
        j = (k + 1) % seg
        F.append((top, r1 + k, r1 + j))
        F.append((r1 + k, r2 + k, r1 + j))
        F.append((r1 + j, r2 + k, r2 + j))
        F.append((bot, r2 + j, r2 + k))
    return V, F

def bag_buildings(pages, affine, r, lod="2.2"):
    """3D BAG pages -> [dict(V, F, top, ground, id)] in local metres (z still NAP)."""
    out = []
    for pg in pages:
        sx, sy, sz = pg["transform"]["scale"]
        tx, ty, tz = pg["transform"]["translate"]
        for f in pg["features"]:
            verts = f.get("vertices", [])
            if not verts:
                continue
            W = []
            for v in verts:
                X, Y = v[0] * sx + tx, v[1] * sy + ty
                x, y = affine(X, Y)
                W.append((x, y, v[2] * sz + tz))
            for oid, o in f.get("CityObjects", {}).items():
                if o.get("type") != "BuildingPart":
                    continue
                geoms = [g for g in o.get("geometry", []) if str(g.get("lod")) == lod] or \
                        [g for g in o.get("geometry", []) if str(g.get("lod")) in ("1.2", "1.3", "2.2")]
                if not geoms:
                    continue
                g = geoms[0]
                used = set(i for sh in g["boundaries"] for surf in sh for ring in surf for i in ring)
                cx = sum(W[i][0] for i in used) / len(used)
                cy = sum(W[i][1] for i in used) / len(used)
                if cx * cx + cy * cy > r * r:
                    continue
                remap, V, F = {}, [], []
                for i in sorted(used):
                    remap[i] = len(V)
                    V.append(W[i])
                for sh in g["boundaries"]:
                    for surf in sh:
                        rings = [[remap[i] for i in ring] for ring in surf if len(ring) >= 3]
                        if not rings:
                            continue
                        if len(rings) == 1 and len(rings[0]) == 3:
                            F.append(tuple(rings[0]))
                        elif len(rings) == 1 and len(rings[0]) == 4 and _convex4(V, rings[0]):
                            F.append(tuple(rings[0]))
                        else:
                            F += [tuple(t) for t in triangulate3d(V, rings)]
                parent = (o.get("parents") or [oid])[0]
                attrs = f["CityObjects"].get(parent, {}).get("attributes", {})
                out.append(dict(V=V, F=F, id=parent.replace("NL.IMBAG.Pand.", ""),
                                ground=attrs.get("b3_h_maaiveld"),
                                top=attrs.get("b3_h_dak_max"), h70=attrs.get("b3_h_dak_70p"),
                                year=attrs.get("oorspronkelijkbouwjaar")))
    return out

def _convex4(V, q):
    s = None
    for i in range(4):
        a, b, c = V[q[i]], V[q[(i + 1) % 4]], V[q[(i + 2) % 4]]
        cr = ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]),
              (b[1] - a[1]) * (c[2] - b[2]) - (b[2] - a[2]) * (c[1] - b[1]),
              (b[2] - a[2]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[2] - b[2]))
        if s is None:
            s = cr
        elif s[0] * cr[0] + s[1] * cr[1] + s[2] * cr[2] < 0:
            return False
    return True

def _median(v):
    v = sorted(v)
    return v[len(v) // 2] if v else 0.0

# =============================================================== the pipeline
def collect(Lat, Lon, Radius, LoD="2.2", Source="auto", TransitR=1500.0, Refresh=False, log=None):
    """Download (cached) and build plain-python site data. No Rhino needed."""
    log = log or (lambda s: None)
    Radius = max(50.0, min(1500.0, float(Radius)))
    ll2xy, _ = local_frame(Lat, Lon)
    key = "osm3|{0:.5f}|{1:.5f}|{2:.0f}|{3:.0f}".format(Lat, Lon, Radius, TransitR)
    log("Downloading OpenStreetMap ...")
    use_bag = str(Source).lower() != "osm" and in_netherlands(Lat, Lon)
    osm_err = None
    try:
        els = cached(key, lambda: fetch_osm(Lat, Lon, Radius, TransitR), Refresh)
    except Exception as e:
        osm_err = e
        els = cached(key, lambda: None, False) if Refresh else None    # stale cache (never written)
        if els is None:
            if not use_bag:
                raise
            els = []
            log("OpenStreetMap unavailable ({0}); building 3D BAG buildings only. "
                "Roads/water/green/transit missing: run again later with Refresh=Yes.".format(
                    str(e).split(" ; ")[0][:200]))
        else:
            log("OpenStreetMap unavailable; using the previously downloaded copy")
    S = clip_site(apply_decks(parse_osm(els, ll2xy, Radius, TransitR)), Radius)
    S["source"] = "OSM"
    S["datum"] = 0.0
    S["osm_missing"] = bool(osm_err) and not els
    meshes = []
    if use_bag:
        try:
            log("Downloading 3D BAG buildings ...")
            pages = cached("bag|{0:.5f}|{1:.5f}|{2:.0f}".format(Lat, Lon, Radius),
                           lambda: fetch_3dbag(Lat, Lon, Radius, log=log), Refresh)
            _, aff = rd_affine(Lat, Lon)
            bag = bag_buildings(pages, aff, Radius, str(LoD))
            if bag:
                datum = _median([b["ground"] for b in bag if b["ground"] is not None])
                for b in bag:
                    b["V"] = [(x, y, z - datum) for x, y, z in b["V"]]
                meshes = bag
                S["datum"] = datum
                S["source"] = "3D BAG LoD " + str(LoD)
        except Exception as e:
            log("3D BAG failed ({0}); using OSM buildings".format(e))
    if not meshes:
        for b in S["buildings"]:
            c = _poly_centroid(b["outer"])
            if c[0] ** 2 + c[1] ** 2 > Radius ** 2 or len(b["outer"]) < 3:
                continue
            V, F = extrude_mesh(b["outer"], b["holes"], b["base"], b["top"])
            meshes.append(dict(V=V, F=F, id=b.get("bag") or b.get("name", ""),
                               ground=0.0, top=b["top"], h70=b["top"], year=None, est=b.get("est", False)))
    S["building_meshes"] = meshes
    S.update(lat=Lat, lon=Lon, radius=Radius, north=0.0)
    return S

RAIL_KINDS = ("train", "metro", "tram", "station")

def nearest_stations(S, n=3):
    """[(distance m, kind, name)] nearest rail/metro/tram stations (any distance in TransitR)."""
    best = {}
    for st in S["stops"]:
        if st["kind"] not in RAIL_KINDS or not st["name"]:
            continue
        d = math.hypot(st["x"], st["y"])
        if st["name"] not in best or d < best[st["name"]][0]:
            best[st["name"]] = (d, st["kind"], st["name"])
    return sorted(best.values())[:n]

def pick_labels(S, mode="key", spacing=None, max_n=10):
    """Labels worth reading on the model, inside the site circle only.
    mode off: none | key: stations + named landmarks, thinned so no two are closer than
    `spacing` (default radius/6) | all: every stop and landmark inside the circle."""
    mode = str(mode).lower()
    if mode.startswith("o"):
        return []
    r = S["radius"]
    items = []
    for st in S["stops"]:
        if math.hypot(st["x"], st["y"]) > r:
            continue
        if mode.startswith("k") and (st["kind"] not in RAIL_KINDS or not st["name"]):
            continue
        items.append((0 if st["kind"] in RAIL_KINDS else 2, st["x"], st["y"],
                      st["name"] or st["kind"], "Transit"))
    for lm in S["landmarks"]:
        if mode.startswith("k") and not lm.get("wd", True):     # key: only notable (wikidata) places
            continue
        items.append((1, lm["x"], lm["y"], lm["name"], "Landmarks"))
    if mode.startswith("a"):
        return [(x, y, t, k) for _, x, y, t, k in items]
    sp = spacing or r / 6.0
    out = []
    for pr, x, y, t, k in sorted(items, key=lambda i: (i[0], math.hypot(i[1], i[2]))):
        if any(math.hypot(x - a, y - b) < sp or t == n for a, b, n, _ in out):
            continue
        out.append((x, y, t, k))
        if len(out) >= max_n:
            break
    return out

def summary(S):
    kinds = {}
    for s in S["stops"]:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    tops = [b["top"] - S["datum"] for b in S["building_meshes"] if b.get("top") is not None]
    return ("Site {0:.5f}, {1:.5f} r {2:.0f} m | buildings {3} ({4}), tallest {5:.0f} m | roads {6}, "
            "paths {7}, rail {8} | water {9}, green {10}, trees {11} | stops {12} | landmarks {13}{14}").format(
        S["lat"], S["lon"], S["radius"], len(S["building_meshes"]), S["source"],
        max(tops) if tops else 0, len(S["roads"]), len(S["paths"]), len(S["rail"]),
        len(S["water"]), len(S["green"]), len(S["trees"]),
        ", ".join("{0} {1}".format(v, k) for k, v in sorted(kinds.items())) or "0",
        len(S["landmarks"]),
        " | NAP datum {0:+.2f} m".format(S["datum"]) if S["source"].startswith("3D") else "") + (
        " | nearest rail: " + ", ".join("{2} ({1}) {0:.0f} m".format(*n) for n in nearest_stations(S))
        if nearest_stations(S) else "") + (
        " | " + data_quality(S) if S["roads"] or S["building_meshes"] else "") + (
        " | WARNING: OpenStreetMap was unavailable, context layers empty (rerun with Refresh=Yes)"
        if S.get("osm_missing") else "")

def data_quality(S):
    """What is measured vs estimated, so nobody mistakes a guess for survey data."""
    bm = S["building_meshes"]
    est = sum(1 for b in bm if b.get("est"))
    rw = [r.get("wsrc", "width") for r in S["roads"]]
    br = sum(1 for k in ("roads", "paths", "rail") for l in S[k] if l.get("z"))
    return ("heights: {0} measured/tagged, {1} estimated | road widths: {2} tagged, {3} from lanes, {4} by class"
            " | bridges/viaducts {5} | rivers/canals {6}, plazas {7}, parking {8}").format(
        len(bm) - est, est, rw.count("width"), rw.count("lanes"), rw.count("class"), br,
        len(S["waterways"]), len(S["plazas"]), len(S["parking"]))

# =============================================================== rhino geometry
def _mesh(V, F, scale=1.0):
    import Rhino.Geometry as rg
    m = rg.Mesh()
    for x, y, z in V:
        m.Vertices.Add(x * scale, y * scale, z * scale)
    for f in F:
        if len(f) == 4:
            m.Faces.AddFace(f[0], f[1], f[2], f[3])
        else:
            m.Faces.AddFace(f[0], f[1], f[2])
    m.Normals.ComputeNormals()
    m.Compact()
    return m

def _poly(pts, z, scale):
    import Rhino.Geometry as rg
    return rg.PolylineCurve([rg.Point3d(x * scale, y * scale, z * scale) for x, y in pts])

def _poly3(l, z, scale):
    import Rhino.Geometry as rg
    zs = l.get("z") or [z] * len(l["pts"])
    return rg.PolylineCurve([rg.Point3d(x * scale, y * scale, zz * scale) for (x, y), zz in zip(l["pts"], zs)])

def build(Lat, Lon, Radius, LoD="2.2", Source="auto", TransitR=1500.0, Refresh=False,
          scale=1.0, log=None, Labels="key"):
    import Rhino.Geometry as rg
    S = collect(Lat, Lon, Radius, LoD, Source, TransitR, Refresh, log)
    out = {}
    out["buildings"] = [_mesh(b["V"], b["F"], scale) for b in S["building_meshes"]]
    out["bld_est"] = [bool(b.get("est")) for b in S["building_meshes"]]
    out["roads"] = [_mesh(*(ribbon(r["pts"], r["width"], 0.03) + (scale,))) for r in S["roads"]
                    if not r["tunnel"] and not r.get("z")]
    out["road_crv"] = [_poly3(r, 0.0, scale) for r in S["roads"]]
    out["paths"] = [_mesh(*(ribbon(p["pts"], p["width"], 0.04) + (scale,))) for p in S["paths"]
                    if not p["tunnel"] and not p.get("z")]
    out["bridges"] = [_mesh(*(deck_mesh(l["pts"], l["width"], l["z"], 1.2 if k == "roads" else 0.5) + (scale,)))
                      for k in ("roads", "paths") for l in S[k] if l.get("z") and not l["tunnel"]] + \
                     [_mesh(*(deck_mesh(l["pts"], 4.5, [z - 0.6 for z in l["z"]], 1.4) + (scale,)))
                      for l in S["rail"] if l.get("z") and not l["tunnel"]]      # viaducts (one per track)
    out["rail"] = [_poly3(r, -8.0 if r["tunnel"] else 0.05, scale) for r in S["rail"]]
    out["water"] = [_mesh(*(flat_mesh(w["outer"], w["holes"], -0.5) + (scale,))) for w in S["water"]] + \
                   [_mesh(*(ribbon(w["pts"], w["width"], -0.45) + (scale,))) for w in S["waterways"]]
    out["plazas"] = [_mesh(*(flat_mesh(a["outer"], a["holes"], a["z"]) + (scale,))) for a in S["plazas"]]
    out["parking"] = [_mesh(*(flat_mesh(a["outer"], a["holes"], 0.025) + (scale,))) for a in S["parking"]]
    out["green"] = [_mesh(*(flat_mesh(g["outer"], g["holes"], 0.02) + (scale,))) for g in S["green"]]
    tv, tf = [], []
    for x, y, h, c in S["trees"]:
        V, F = tree_mesh(x, y, h, c)
        o = len(tv)
        tv += V
        tf += [tuple(i + o for i in f) for f in F]
    out["trees"] = _mesh(tv, tf, scale) if tv else None
    out["tree_pts"] = [rg.Point3d(x * scale, y * scale, 0) for x, y, _, _ in S["trees"]]
    out["stops"] = [rg.Point3d(s["x"] * scale, s["y"] * scale, 0) for s in S["stops"]]
    out["stop_names"] = ["{0}: {1}".format(s["kind"], s["name"]) for s in S["stops"]]
    out["landmarks"] = [rg.Point3d(s["x"] * scale, s["y"] * scale, 0) for s in S["landmarks"]]
    out["landmark_names"] = [s["name"] for s in S["landmarks"]]
    out["boundary"] = rg.Circle(rg.Plane.WorldXY, S["radius"] * scale).ToNurbsCurve()
    gV, gF = flat_mesh(circle_poly(S["radius"] * 1.02), [], -0.05)
    out["ground"] = _mesh(gV, gF, scale)
    lab = pick_labels(S, Labels)
    out["label_pts"] = [rg.Point3d(x * scale, y * scale, 0) for x, y, _, _ in lab]
    out["labels"] = [t for _, _, t, _ in lab]
    out["label_kinds"] = [k for _, _, _, k in lab]
    # stops inside the circle (all stops stay in `site` for transit analysis)
    inside = [st for st in S["stops"] if math.hypot(st["x"], st["y"]) <= S["radius"]]
    out["stops"] = [rg.Point3d(st["x"] * scale, st["y"] * scale, 0) for st in inside]
    out["stop_names"] = ["{0}: {1}".format(st["kind"], st["name"]) for st in inside]
    out["site"] = S
    out["info"] = summary(S)
    return out

# =============================================================== entry points
def _gh_value(name):
    v = globals().get(name)
    return DEFAULTS[name] if v is None else v

def _layer(doc, name, rgb, parent=None):
    import Rhino, System
    full = name if parent is None else parent + "::" + name
    idx = doc.Layers.FindByFullPath(full, -1)
    if idx >= 0:
        return idx
    L = Rhino.DocObjects.Layer()
    L.Name = name
    L.Color = System.Drawing.Color.FromArgb(*rgb)
    if parent is not None:
        L.ParentLayerId = doc.Layers[doc.Layers.FindByFullPath(parent, -1)].Id
    return doc.Layers.Add(L)

def run_command():
    import Rhino
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    from Rhino.Input.Custom import GetOption, OptionDouble, OptionToggle
    key = "X000_site_model"
    v = dict(DEFAULTS)
    v.update(sc.sticky.get(key, {}))
    go = GetOption()
    go.SetCommandPrompt("Site model: set options, Enter to download and build")
    o_lat = OptionDouble(float(v["Lat"])); o_lon = OptionDouble(float(v["Lon"]))
    o_r = OptionDouble(float(v["Radius"]), 50.0, 1500.0)
    o_lod = OptionToggle(str(v["LoD"]) == "2.2", "LoD12", "LoD22")
    o_src = OptionToggle(str(v["Source"]).lower() == "osm", "Auto", "OSM")
    o_ref = OptionToggle(False, "No", "Yes")
    lab_modes = ["Off", "Key", "All"]
    cur = str(v.get("Labels", "key")).lower()
    lab_i = [m.lower() for m in lab_modes].index(cur) if cur in ("off", "key", "all") else 1
    go.AcceptNothing(True)
    while True:
        go.ClearCommandOptions()
        go.AddOptionDouble("Latitude", o_lat); go.AddOptionDouble("Longitude", o_lon)
        go.AddOptionDouble("RadiusMetres", o_r); go.AddOptionToggle("Roofs", o_lod)
        go.AddOptionToggle("Source", o_src); go.AddOptionToggle("Refresh", o_ref)
        i_lab = go.AddOptionList("Labels", lab_modes, lab_i)
        res = go.Get()
        if res == Rhino.Input.GetResult.Option:
            if go.OptionIndex() == i_lab:
                lab_i = go.Option().CurrentListOptionIndex
            continue
        if res in (Rhino.Input.GetResult.Nothing,):
            break
        return
    v.update(Lat=o_lat.CurrentValue, Lon=o_lon.CurrentValue, Radius=o_r.CurrentValue,
             LoD="2.2" if o_lod.CurrentValue else "1.2",
             Source="osm" if o_src.CurrentValue else "auto", Labels=lab_modes[lab_i].lower())
    sc.sticky[key] = v

    def log(s):
        Rhino.RhinoApp.SetCommandPrompt(s)
        Rhino.RhinoApp.Wait()
        print(s)
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        g = build(v["Lat"], v["Lon"], v["Radius"], v["LoD"], v["Source"], v["TransitR"],
                  o_ref.CurrentValue, f, log, v["Labels"])
    except Exception as e:
        print("SiteModel failed: {0}".format(e))
        return
    _layer(sc.doc, "X000", (120, 120, 120))
    L = dict((n, _layer(sc.doc, n, c, "X000")) for n, c in PALETTE.items())

    def attr(n):
        a = Rhino.DocObjects.ObjectAttributes()
        a.LayerIndex = L[n]
        return a
    rs.EnableRedraw(False)
    ids = []
    for m, e in zip(g["buildings"], g["bld_est"]):     # guessed heights on their own layer
        ids.append(sc.doc.Objects.AddMesh(m, attr("BuildingsEstimated" if e else "Buildings")))
    for m in g["bridges"]:
        ids.append(sc.doc.Objects.AddMesh(m, attr("Bridges")))
    for m in g["plazas"]:
        ids.append(sc.doc.Objects.AddMesh(m, attr("Plazas")))
    for m in g["parking"]:
        ids.append(sc.doc.Objects.AddMesh(m, attr("Parking")))
    for m in g["roads"]:
        ids.append(sc.doc.Objects.AddMesh(m, attr("Roads")))
    for m in g["paths"]:
        ids.append(sc.doc.Objects.AddMesh(m, attr("Paths")))
    for c in g["rail"]:
        ids.append(sc.doc.Objects.AddCurve(c, attr("Rail")))
    for m in g["water"]:
        ids.append(sc.doc.Objects.AddMesh(m, attr("Water")))
    for m in g["green"]:
        ids.append(sc.doc.Objects.AddMesh(m, attr("Green")))
    if g["trees"]:
        ids.append(sc.doc.Objects.AddMesh(g["trees"], attr("Trees")))
    ids.append(sc.doc.Objects.AddMesh(g["ground"], attr("Ground")))
    for p, n in zip(g["stops"], g["stop_names"]):            # points only, name on the object
        a = attr("Transit"); a.Name = n
        ids.append(sc.doc.Objects.AddPoint(p, a))
    for p, n in zip(g["landmarks"], g["landmark_names"]):
        a = attr("Landmarks"); a.Name = n
        ids.append(sc.doc.Objects.AddPoint(p, a))
    th = v["Radius"] / 75.0 * f                              # plan text, scales with the model
    for p, n, k in zip(g["label_pts"], g["labels"], g["label_kinds"]):
        tid = rs.AddText(n, Rhino.Geometry.Point3d(p.X + th * 0.6, p.Y + th * 0.6, 0.3 * f), th)
        if tid:
            rs.ObjectLayer(tid, "X000::Labels")
            ids.append(tid)
    ids.append(sc.doc.Objects.AddCurve(g["boundary"], attr("Boundary")))
    grp = rs.AddGroup()
    rs.AddObjectsToGroup([i for i in ids if i], grp)
    rs.EnableRedraw(True)
    sc.doc.Views.Redraw()
    sc.sticky["X000_site"] = g["site"]           # other library tools can read this
    print(g["info"])

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    if not _gh_value("Run"):
        info = "Run is False"
    else:
        import Rhino
        import scriptcontext as sc
        _f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, Rhino.RhinoDoc.ActiveDoc.ModelUnitSystem)
        _g = build(*[_gh_value(k) for k in ("Lat", "Lon", "Radius", "LoD", "Source",
                                            "TransitR", "Refresh")], scale=_f,
                    Labels=_gh_value("Labels"))
        buildings, roads, road_crv, paths, rail = (_g["buildings"], _g["roads"], _g["road_crv"],
                                                    _g["paths"], _g["rail"])
        water, green, trees, tree_pts = _g["water"], _g["green"], _g["trees"], _g["tree_pts"]
        stops, stop_names = _g["stops"], _g["stop_names"]
        ground, labels, label_pts = _g["ground"], _g["labels"], _g["label_pts"]
        bridges, plazas, parking, bld_est = _g["bridges"], _g["plazas"], _g["parking"], _g["bld_est"]
        landmarks, landmark_names = _g["landmarks"], _g["landmark_names"]
        boundary, site, info = _g["boundary"], _g["site"], _g["info"]
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:                     # plain Python: maths self-test
        X, Y = wgs_to_rd(52.15517440, 5.38720621)
        print("Amersfoort RD:", round(X, 2), round(Y, 2))
        print("roundtrip:", rd_to_wgs(*wgs_to_rd(51.92, 4.48)))
        print(triangulate([(0, 0, 0), (4, 0, 1), (4, 4, 2), (0, 4, 3)],
                          [[(1, 1, 4), (1, 3, 5), (3, 3, 6), (3, 1, 7)]]))
        print(building_height({"building": "apartments", "building:levels": "5"}))
