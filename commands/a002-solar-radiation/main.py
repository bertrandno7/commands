"""
A002  Solar Radiation  (cumulative kWh/m2 on facades, roofs and ground, with shading)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: SolarRadiation).

Real weather for the site: hourly global, direct-normal and diffuse irradiance
from the Open-Meteo ERA5 archive (last `Years` full years) for Lat/Lon. These
hours are turned into a cumulative sky (Tregenza 145 patches):
    diffuse  -> Perez 1990 per hour (default): isotropic part on every patch,
                circumsolar part added to the sun's direct bin, horizon
                brightening as a ring of rays at the horizon (so context can
                block it). Sky=isotropic puts all diffuse on the patches.
    direct   -> DNI binned into the patch the sun was in (DNI-weighted mean
                sun direction per patch, so the cosine and the shadow ray use
                where the sun really was)
    reflected-> Albedo x GHI x (1 - nz) / 2 from the ground (not shaded)
Each face casts one ray per visible patch through context + itself, so roofs,
courtyards and facades all get shaded radiation. Result: kWh/m2 per average
year for the chosen months (M0..M1, wraps over new year, e.g. 10..3 = winter).

Validated (library/tests/validate_sun.py): sun position < 0.7 deg from NREL SPA
anywhere; unshaded results within ~1% of pvlib (same model) on the same ERA5 data.
Isotropic underestimates S/E/W facades by 7-10% in Rotterdam vs Perez, hence the default.
Rough PV thresholds: roof > 900, facade > 600 kWh/m2/yr.

GH INPUTS:
    Geo    : Mesh/Brep(s)  geometry to analyse (breps meshed at Grid size)
    Ctx    : Mesh/Brep(s)  shading context (optional; e.g. X000 buildings)
    Lat    : float  latitude  (default 51.92 Rotterdam; or X000 site if run)
    Lon    : float  longitude (default 4.48)
    M0, M1 : int    first / last month included (default 1, 12 = whole year)
    Years  : int    full years of weather to average (default 3)
    Grid   : float  max mesh face size for breps, model units (default 2.0)
    North  : float  degrees, angle of north from +Y toward -X (default 0)
    Albedo : float  ground reflectance (default 0.2)
    PvEff  : float  PV module efficiency x performance ratio (default 0.16)
    Sky    : str    "perez" (default) | "isotropic" diffuse sky model
    Run    : bool   (default True)
    LegMin, LegMax : float  legend domain kWh/m2 (empty = min .. max; fix both to
             compare options on one colour scale)

GH OUTPUTS:
    mesh   : coloured analysis mesh (blue low -> green -> yellow -> orange -> magenta high)
    rad    : kWh/m2 per face (per average year of the chosen months)
    area   : face areas (model units squared)
    pv     : PV yield per face, kWh/m2 (= rad x PvEff)
    total  : kWh received by all faces (area-weighted; area converted to m2)
    sky    : 145 values, cumulative sky kWh/m2 per patch (direct + diffuse)
    info   : summary text (+ unshaded horizontal and facade reference values)
    legend, leg_text, leg_pl, leg_size : Ladybug-style legend (colour bar mesh + outline;
             wire leg_text / leg_pl / leg_size into a Text Tag 3D: Text, Location, Size)

RHINO COMMAND / ALIAS:
    Alias  SolarRadiation  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\A002_solar_radiation.py"
    Pick objects to analyse, then context (Enter for none).
    Options: Latitude, Longitude, FirstMonth, LastMonth, Years, GridMetres,
    NorthAngle, Albedo, UseSiteModel (take Lat/Lon from the last SiteModel run),
    SkyModel Perez/Isotropic, Legend Yes/No, LegendMin / LegendMax (kWh/m2, -1 = auto).
    Bakes a coloured mesh on layer A002 and a Ladybug-style legend (gradient bar, values,
    title with months + location) on A002::Legend, grouped; values remembered.
"""
from __future__ import division, print_function
import math

DEFAULTS = dict(Lat=51.92, Lon=4.48, M0=1, M1=12, Years=3, Grid=2.0, North=0.0,
                Albedo=0.2, PvEff=0.16, Run=True, Sky="perez", LegMin=None, LegMax=None)

# palette ramp (MVRDV pops): blue -> lime -> yellow -> orange -> magenta
RAMP = [(0.0, (0, 133, 255)), (0.3, (120, 220, 90)), (0.55, (255, 210, 0)),
        (0.8, (255, 120, 0)), (1.0, (230, 0, 126))]

# ---------------------------------------------------------------- sun maths
def day_of_year(y, m, d):
    days = [31, 28 + (1 if (y % 4 == 0 and y % 100 != 0) or y % 400 == 0 else 0),
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return sum(days[:m - 1]) + d

def sun_position(lat, lon, y, m, d, hour_utc):
    """(altitude_deg, azimuth_deg from north clockwise) for a UTC clock hour. NOAA approx."""
    n = day_of_year(y, m, d)
    g = 2 * math.pi / 365.0 * (n - 1 + (hour_utc - 12) / 24.0)
    eot = 229.18 * (0.000075 + 0.001868*math.cos(g) - 0.032077*math.sin(g)
                    - 0.014615*math.cos(2*g) - 0.040849*math.sin(2*g))
    dec = (0.006918 - 0.399912*math.cos(g) + 0.070257*math.sin(g)
           - 0.006758*math.cos(2*g) + 0.000907*math.sin(2*g)
           - 0.002697*math.cos(3*g) + 0.00148*math.sin(3*g))
    tst = hour_utc * 60 + eot + 4 * lon
    ha = math.radians((tst / 4.0) % 360.0 - 180.0)     # wrapped to -180..180 (east longitudes overflow a day)
    la = math.radians(lat)
    cz = math.sin(la)*math.sin(dec) + math.cos(la)*math.cos(dec)*math.cos(ha)
    zen = math.acos(max(-1.0, min(1.0, cz)))
    alt = 90 - math.degrees(zen)
    s = math.sin(zen)
    if abs(s) < 1e-9:
        return alt, 180.0
    ca = (math.sin(la)*math.cos(zen) - math.sin(dec)) / (math.cos(la)*s)
    az = math.degrees(math.acos(max(-1.0, min(1.0, ca))))
    az = (180 + az) % 360 if ha > 0 else (540 - az) % 360
    return alt, az

def _vec(alt, az, north=0.0):
    a, z = math.radians(alt), math.radians(az - north)
    return (math.cos(a)*math.sin(z), math.cos(a)*math.cos(z), math.sin(a))

# ------------------------------------------------------------- Tregenza sky
BANDS = [(6, 30), (18, 30), (30, 24), (42, 24), (54, 18), (66, 12), (78, 6), (90, 1)]

def tregenza():
    """145 patches: list of (alt_centre, az_centre, solid_angle_sr)."""
    out = []
    for alt, n in BANDS:
        if n == 1:
            out.append((90.0, 0.0, 2 * math.pi * (1 - math.sin(math.radians(84)))))
            continue
        a0, a1 = math.radians(alt - 6), math.radians(alt + 6)
        om = 2 * math.pi / n * (math.sin(a1) - math.sin(a0))
        for k in range(n):
            out.append((float(alt), k * 360.0 / n, om))
    return out

def patch_index(alt, az):
    """Tregenza patch containing a direction above the horizon."""
    base = 0
    for c, n in BANDS:
        if alt < c + 6 or n == 1:
            if n == 1:
                return base
            w = 360.0 / n
            return base + int(((az + w / 2) % 360) // w)
        base += n
    return base - 1

def _in_months(m, m0, m1):
    return m0 <= m <= m1 if m0 <= m1 else (m >= m0 or m <= m1)

# Perez 1990 all-sites composite coefficients (f11 f12 f13 f21 f22 f23) per clearness bin
PEREZ = [(-0.0083117, 0.5877285, -0.0620636, -0.0596012, 0.0721249, -0.0220216),
         (0.1299457, 0.6825954, -0.1513752, -0.0189325, 0.0659650, -0.0288748),
         (0.3296958, 0.4868735, -0.2210958, 0.0554140, -0.0639588, -0.0260542),
         (0.5682053, 0.1874525, -0.2951290, 0.1088631, -0.1519229, -0.0139754),
         (0.8730280, -0.3920403, -0.3616149, 0.2255647, -0.4620442, 0.0012448),
         (1.1326077, -1.2367284, -0.4118494, 0.2877813, -0.8230357, 0.0558225),
         (1.0601591, -1.5999137, -0.3589221, 0.2642124, -1.1272340, 0.1310694),
         (0.6777470, -0.3272588, -0.2504286, 0.1561313, -1.3765031, 0.2506212)]
PEREZ_EPS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2]
N_RING = 36

def perez_f(dni, dhi, zen_deg, doy):
    """Perez (1990) circumsolar F1 and horizon F2 brightening coefficients."""
    if dhi <= 0:
        return 0.0, 0.0
    z = math.radians(zen_deg)
    k = 1.041 * z ** 3
    eps = ((dhi + dni) / dhi + k) / (1 + k)
    i0 = 1367.0 * (1 + 0.033 * math.cos(2 * math.pi * doy / 365.0))
    am = 1.0 / (math.cos(z) + 0.50572 * (96.07995 - zen_deg) ** -1.6364)
    delta = dhi * am / i0
    b = 0
    while b < len(PEREZ_EPS) and eps >= PEREZ_EPS[b]:
        b += 1
    f = PEREZ[b]
    return max(0.0, f[0] + f[1] * delta + f[2] * z), f[3] + f[4] * delta + f[5] * z

def sky_matrix(lat, lon, times, ghi, dni, dhi, m0=1, m1=12, model="perez"):
    """Cumulative sky from hourly UTC records (Open-Meteo: value = mean of the
    preceding hour, so the sun is taken at hh-0:30).
    model "perez" (default): Perez 1990 diffuse split per hour into isotropic part
    (on the 145 patches), circumsolar part (added to the direct bins as an equivalent
    beam DHI*F1/max(cos85, cosZ)) and horizon brightening (a ring of N_RING rays at
    the horizon carrying pi*DHI*F2). "isotropic": all diffuse on the patches.
    Returns dict(diff=[145 Wh/m2 radiance x solid angle], dirv=[145 Wh/m2 beam],
                 dird=[145 unit vectors or None], ring=Wh/m2 per ring ray, rdir, ghi, dhi, dni, years)."""
    P = tregenza()
    n = len(P)
    dirw, dirx, diry, dirz = [0.0]*n, [0.0]*n, [0.0]*n, [0.0]*n
    sg = sd = sn = s_iso = s_ring = 0.0
    perez = str(model).lower().startswith("p")
    yrs = set()
    for t, g, b, d in zip(times, ghi, dni, dhi):
        y, mo, da, hh = int(t[0:4]), int(t[5:7]), int(t[8:10]), int(t[11:13])
        if not _in_months(mo, m0, m1):
            continue
        yrs.add(y)
        g = g or 0.0; b = b or 0.0; d = d or 0.0
        sg += g; sd += d
        if b <= 0 and (d <= 0 or not perez):
            s_iso += d
            continue
        alt, az = sun_position(lat, lon, y, mo, da, hh - 0.5)
        f1 = f2 = 0.0
        if perez and alt > 0:
            f1, f2 = perez_f(b, d, 90.0 - alt, day_of_year(y, mo, da))
        s_iso += d * (1 - f1)
        s_ring += d * f2
        beam = b + d * f1 / max(math.cos(math.radians(85.0)), math.sin(math.radians(max(alt, 0.0))))
        if alt <= 0.5 or beam <= 0:
            continue
        i = patch_index(alt, az)
        v = _vec(alt, az)
        dirw[i] += beam; dirx[i] += beam*v[0]; diry[i] += beam*v[1]; dirz[i] += beam*v[2]
        sn += b
    # isotropic part, normalised so a horizontal plane receives exactly its share of DHI
    k = sum(om * math.sin(math.radians(a)) for a, _, om in P)
    diff = [s_iso * om / k for a, _, om in P]
    dird = []
    for i in range(n):
        L = math.sqrt(dirx[i]**2 + diry[i]**2 + dirz[i]**2)
        dird.append((dirx[i]/L, diry[i]/L, dirz[i]/L) if L > 0 else None)
    ny = max(1, len(yrs))
    s = 1.0 / ny
    # ring: sum_i w max(0, n.d_i) over N_RING horizon rays = (N_RING w / pi) sin(tilt) -> w = pi*S/N_RING
    ring = math.pi * s_ring / N_RING * s
    rdir = [(math.sin(2 * math.pi * j / N_RING), math.cos(2 * math.pi * j / N_RING), 0.0) for j in range(N_RING)]
    return dict(diff=[x*s for x in diff], dirv=[x*s for x in dirw], dird=dird, ring=ring, rdir=rdir,
                pdir=[_vec(a, z) for a, z, _ in P], ghi=sg*s, dhi=sd*s, dni=sn*s, years=sorted(yrs),
                model="perez" if perez else "isotropic")

def rays_for(sky, north=0.0):
    """Ray list [(unit vector in model axes, Wh/m2 at normal incidence)]: diffuse
    patches + direct bins, rotated by North (deg, +Y toward -X)."""
    c, s = math.cos(math.radians(north)), math.sin(math.radians(north))
    rot = lambda v: (v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2])
    out = [(rot(v), w) for v, w in zip(sky["pdir"], sky["diff"]) if w > 0]
    out += [(rot(v), w) for v, w in zip(sky["dird"], sky["dirv"]) if v and w > 0]
    if sky.get("ring"):
        out += [(rot(v), sky["ring"]) for v in sky["rdir"]]
    return out

def unshaded(sky, normal, albedo=0.2):
    """kWh/m2 on an unobstructed plane with this normal (x, y, z)."""
    tot = 0.0
    for v, w in rays_for(sky):
        c = v[0]*normal[0] + v[1]*normal[1] + v[2]*normal[2]
        if c > 0:
            tot += w * c
    return (tot + albedo * sky["ghi"] * (1 - normal[2]) / 2.0) / 1000.0

def rad_colour(x, lo, hi):
    t = 0.0 if hi <= lo else max(0.0, min(1.0, (x - lo) / (hi - lo)))
    for (t0, c0), (t1, c1) in zip(RAMP[:-1], RAMP[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0)
            return tuple(int(c0[i] + (c1[i] - c0[i]) * u) for i in range(3))
    return RAMP[-1][1]

def reference_text(sky, albedo):
    r = lambda n: unshaded(sky, n, albedo)
    return ("unshaded ({5} sky): roof {0:.0f}, S {1:.0f}, E {2:.0f}, W {3:.0f}, N {4:.0f} kWh/m2".format(
        r((0, 0, 1)), r((0, -1, 0)), r((1, 0, 0)), r((-1, 0, 0)), r((0, 1, 0)), sky.get("model", "isotropic")))

def summary(rad, area_m2, sky, albedo, m0, m1, lat, lon):
    if not rad:
        return "No faces"
    A = sum(area_m2) or 1.0
    tot = sum(r * a for r, a in zip(rad, area_m2))
    per = "year" if (m0, m1) == (1, 12) else "months {0}-{1}".format(m0, m1)
    return ("Site {0:.4f}, {1:.4f} | {2}, weather {3} | GHI {4:.0f} kWh/m2 (diffuse {5:.0f}) | "
            "faces {6}, area {7:.0f} m2 | kWh/m2 min {8:.0f} / mean {9:.0f} / max {10:.0f} | "
            "total {11:,.0f} kWh | {12}".format(
                lat, lon, per, "-".join(str(y) for y in sky["years"][:1] + sky["years"][-1:]),
                sky["ghi"] / 1000, sky["dhi"] / 1000, len(rad), A, min(rad), tot / A, max(rad),
                tot, reference_text(sky, albedo)))

# ---------------------------------------------------------------- weather
def fetch_irradiance(lat, lon, years=3):
    """Hourly UTC times, GHI, DNI, DHI (W/m2) from Open-Meteo ERA5 archive, last
    `years` full calendar years. Works in IronPython (WebClient fallback) and CPython."""
    import datetime, json
    y1 = datetime.date.today().year - 1
    url = ("https://archive-api.open-meteo.com/v1/archive?latitude={0:.4f}&longitude={1:.4f}"
           "&start_date={2}-01-01&end_date={3}-12-31"
           "&hourly=shortwave_radiation,direct_normal_irradiance,diffuse_radiation"
           "&timezone=UTC").format(lat, lon, y1 - int(years) + 1, y1)
    try:
        try:
            from urllib.request import urlopen, Request
        except ImportError:                 # IronPython 2.7
            from urllib2 import urlopen, Request
        raw = urlopen(Request(url, headers={"User-Agent": "GH-Library A002"}), timeout=90).read()
    except Exception:
        import System                       # .NET fallback (Rhino 7 TLS)
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12
        raw = System.Net.WebClient().DownloadString(url)
    if not isinstance(raw, str):
        raw = raw.decode("utf-8")
    h = json.loads(raw)["hourly"]
    return (h["time"], h["shortwave_radiation"], h["direct_normal_irradiance"],
            h["diffuse_radiation"])

_SKY_CACHE = {}

def site_sky(lat, lon, years=3, m0=1, m1=12, model="perez"):
    """Cached sky matrix (sc.sticky in Rhino, module dict elsewhere)."""
    try:
        import scriptcontext as sc
        cache = sc.sticky.setdefault("A002_sky_cache", {})
    except Exception:
        cache = _SKY_CACHE
    wkey = (round(lat, 2), round(lon, 2), int(years))
    skey = wkey + (int(m0), int(m1), str(model).lower()[:1])
    if skey not in cache:
        wx = cache.get(("wx",) + wkey)
        if wx is None:
            wx = fetch_irradiance(lat, lon, years)
            cache[("wx",) + wkey] = wx
        cache[skey] = sky_matrix(lat, lon, wx[0], wx[1], wx[2], wx[3], int(m0), int(m1), model)
    return cache[skey]

# ------------------------------------------------------------ rhino geometry
def _face_len(f, along_u, t):
    """Approximate length of a face iso-line (along u or v) at normalised t of the other dir."""
    du, dv = f.Domain(0), f.Domain(1)
    pts = []
    for i in range(9):
        s = i / 8.0
        if along_u:
            pts.append(f.PointAt(du.ParameterAt(s), dv.ParameterAt(t)))
        else:
            pts.append(f.PointAt(du.ParameterAt(t), dv.ParameterAt(s)))
    return sum(pts[i].DistanceTo(pts[i + 1]) for i in range(8))

def grid_mesh_brep(brep, grid):
    """Neat quad grid per brep face: faces divided in UV into ~grid-sized cells.
    Trimmed faces keep the quads whose centre lies on the face (edge cells stay square,
    so the trim edge becomes slightly stepped, which is fine for analysis)."""
    import math
    import Rhino.Geometry as rg
    out = rg.Mesh()
    for f in brep.Faces:
        nu = max(1, int(math.ceil(max(_face_len(f, True, t) for t in (0.0, 0.5, 1.0)) / grid - 1e-6)))
        nv = max(1, int(math.ceil(max(_face_len(f, False, t) for t in (0.0, 0.5, 1.0)) / grid - 1e-6)))
        du, dv = f.Domain(0), f.Domain(1)
        m = rg.Mesh()
        for j in range(nv + 1):
            for i in range(nu + 1):
                m.Vertices.Add(f.PointAt(du.ParameterAt(i / float(nu)), dv.ParameterAt(j / float(nv))))
        trimmed = not f.IsSurface if hasattr(f, "IsSurface") else True
        for j in range(nv):
            for i in range(nu):
                if trimmed:
                    uc = du.ParameterAt((i + 0.5) / nu); vc = dv.ParameterAt((j + 0.5) / nv)
                    if f.IsPointOnFace(uc, vc) == rg.PointFaceRelation.Exterior:
                        continue
                a = j * (nu + 1) + i
                q = (a, a + 1, a + nu + 2, a + nu + 1)
                if f.OrientationIsReversed:
                    q = (q[0], q[3], q[2], q[1])
                m.Faces.AddFace(*q)
        m.Vertices.CullUnused()
        out.Append(m)
    out.Normals.ComputeNormals()
    out.Compact()
    return out

def _to_meshes(items, grid, neat=False):
    import Rhino.Geometry as rg
    if items is None:
        return []
    if not isinstance(items, (list, tuple)):
        items = [items]
    mp = rg.MeshingParameters.Default
    mp.MaximumEdgeLength = grid
    mp.MinimumEdgeLength = grid * 0.25
    out = []
    for g in items:
        if g is None:
            continue
        if isinstance(g, rg.Extrusion):
            g = g.ToBrep()
        if isinstance(g, rg.Surface):
            g = g.ToBrep()
        if isinstance(g, rg.Mesh):
            out.append(g.DuplicateMesh())
        elif isinstance(g, rg.Brep) and neat:
            out.append(grid_mesh_brep(g, grid))
        elif isinstance(g, rg.Brep):
            ms = rg.Mesh.CreateFromBrep(g, mp)
            if ms:
                m = rg.Mesh()
                for x in ms:
                    m.Append(x)
                out.append(m)
    return out

def _site_latlon():
    try:
        import scriptcontext as sc
        s = sc.sticky.get("X000_site")
        if s:
            return float(s["lat"]), float(s["lon"])
    except Exception:
        pass
    return None

def build(Geo, Ctx, Lat, Lon, M0, M1, Years, Grid, North, Albedo, PvEff,
          offset=0.01, unit_to_m=1.0, Sky="perez", leg_lo=None, leg_hi=None):
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    import System
    targets = _to_meshes(Geo, Grid, neat=True)
    if not targets:
        raise ValueError("Nothing to analyse")
    block = rg.Mesh()
    for m in targets + _to_meshes(Ctx, Grid):
        block.Append(m)
    sky = site_sky(Lat, Lon, Years, M0, M1, Sky)
    rays = [(rg.Vector3d(*v), w) for v, w in rays_for(sky, North)]
    refl = Albedo * sky["ghi"]
    mesh = rg.Mesh()
    for m in targets:                       # quads kept: neat grid cells stay one face each
        mesh.Append(m)
    mesh.FaceNormals.ComputeFaceNormals()
    rad, area, faces = [], [], []
    for i in range(mesh.Faces.Count):
        n = rg.Vector3d(mesh.FaceNormals[i])
        if n.Z < -0.9:                       # undersides: skip
            continue
        f = mesh.Faces[i]
        vs = [mesh.Vertices[k] for k in ((f.A, f.B, f.C, f.D) if f.IsQuad else (f.A, f.B, f.C))]
        a, b, c = vs[0], vs[1], vs[2]
        ar = 0.5 * rg.Vector3d.CrossProduct(rg.Vector3d(b - a), rg.Vector3d(c - a)).Length
        if f.IsQuad:
            d = vs[3]
            ar += 0.5 * rg.Vector3d.CrossProduct(rg.Vector3d(c - a), rg.Vector3d(d - a)).Length
        p = rg.Point3d(sum(v.X for v in vs) / len(vs), sum(v.Y for v in vs) / len(vs),
                       sum(v.Z for v in vs) / len(vs)) + n * offset
        tot = 0.0
        for v, w in rays:
            cs = n * v
            if cs <= 0:
                continue
            if Intersection.MeshRay(block, rg.Ray3d(p, v)) < 0:
                tot += w * cs
        tot += refl * (1 - n.Z) / 2.0
        rad.append(tot / 1000.0)
        area.append(ar)
        faces.append(vs)
    lo, hi = value_range(rad, leg_lo, leg_hi)
    out = rg.Mesh()
    for vs, r in zip(faces, rad):
        k = out.Vertices.Count
        for v in vs:
            out.Vertices.Add(v)
        if len(vs) == 4:
            out.Faces.AddFace(k, k + 1, k + 2, k + 3)
        else:
            out.Faces.AddFace(k, k + 1, k + 2)
        col = System.Drawing.Color.FromArgb(*rad_colour(r, lo, hi))
        for _ in vs:
            out.VertexColors.Add(col)
    out.Normals.ComputeNormals()
    am2 = [x * unit_to_m ** 2 for x in area]
    total = sum(r * x for r, x in zip(rad, am2))
    pv = [r * PvEff for r in rad]
    sky_vals = [(d + s) / 1000.0 for d, s in zip(sky["diff"], sky["dirv"])]
    try:                                    # scoreboard metrics (E001)
        import scriptcontext as sc
        A = sum(am2) or 1.0
        sc.sticky["A002_metrics"] = dict(total_kwh=total, area=A, mean_kwh_m2=total / A,
                                         pv_kwh=total * PvEff, lat=Lat, lon=Lon, months=(int(M0), int(M1)))
    except Exception:
        pass
    return out, rad, area, pv, total, sky_vals, summary(rad, am2, sky, Albedo, M0, M1, Lat, Lon)

# ------------------------------------------------------- legend (Ladybug-style, shared block)
# Same block in A001, A002, W001, W002 (self-contained scripts). legend_layout is pure maths.
def value_range(vals, lmin=None, lmax=None, zero=False):
    """Legend domain. lmin/lmax None (or < 0 from a command option) = automatic:
    min (or 0 when zero=True) .. max of vals. Fix them to compare options on one scale."""
    lo = None if (lmin is None or lmin < 0) else float(lmin)
    hi = None if (lmax is None or lmax < 0) else float(lmax)
    if lo is None:
        lo = 0.0 if (zero or not vals) else float(min(vals))
    if hi is None:
        hi = float(max(vals)) if vals else 1.0
    if hi <= lo:
        hi = lo + 1.0
    return lo, hi

def legend_place(bmin, bmax, unit=1.0, height=0.0, x_from=None):
    """Origin + bar height: to the right of the bounding box (or of x_from), on its base.
    height 0 = auto, half the larger plan size, at least 10 m."""
    dx, dy = bmax[0] - bmin[0], bmax[1] - bmin[1]
    h = height if height and height > 0 else max(10.0 * unit, 0.5 * max(dx, dy))
    x = max(bmax[0], x_from if x_from is not None else bmax[0]) + 0.15 * h
    return (x, bmin[1], bmin[2]), h

def legend_layout(lo, hi, colour_fn, title="", origin=(0.0, 0.0, 0.0), height=10.0,
                  n_seg=10, n_lab=6, fmt="{0:.1f}", classes=None, top_plus=False, bottom_minus=False):
    """Vertical colour bar from lo (bottom) to hi (top): n_seg cells with a smooth gradient,
    n_lab value labels to the right, title lines on top (first line highest).
    classes = [(label, rgb), ...] bottom->top draws one box per class instead.
    Returns dict(cells=[(4 corners, rgb_bottom, rgb_top)], labels=[(text, (x, y, z), text_h)],
    box=(xmin, ymin, xmax, ymax), z, text_h, stepped)."""
    x0, y0, z0 = origin
    th = height / 14.0
    labels, cells = [], []
    if classes:
        n = len(classes)
        sh = height / float(n)
        w = height / 8.0
        for i, (lab, rgb) in enumerate(classes):
            ya, yb = y0 + i * sh, y0 + (i + 1) * sh
            cells.append((((x0, ya, z0), (x0 + w, ya, z0), (x0 + w, yb, z0), (x0, yb, z0)), rgb, rgb))
            labels.append((lab, (x0 + w + 0.6 * th, ya + 0.5 * sh - 0.5 * th, z0), th))
    else:
        n = max(1, int(n_seg))
        sh = height / float(n)
        w = height / 10.0
        for i in range(n):
            ya, yb = y0 + i * sh, y0 + (i + 1) * sh
            va, vb = lo + (hi - lo) * i / float(n), lo + (hi - lo) * (i + 1) / float(n)
            cells.append((((x0, ya, z0), (x0 + w, ya, z0), (x0 + w, yb, z0), (x0, yb, z0)),
                          tuple(colour_fn(va)), tuple(colour_fn(vb))))
        m = max(2, int(n_lab))
        for k in range(m):
            t = k / float(m - 1)
            txt = fmt.format(lo + (hi - lo) * t)
            if k == m - 1 and top_plus:
                txt = ">= " + txt
            if k == 0 and bottom_minus:
                txt = "<= " + txt
            labels.append((txt, (x0 + w + 0.6 * th, y0 + t * height - 0.5 * th, z0), th))
    lines = [s for s in str(title).split("\n") if s.strip()]
    for j, s in enumerate(reversed(lines)):           # last line lowest, just above the bar
        hh = th * (1.3 if j == len(lines) - 1 else 1.0)
        labels.append((s, (x0, y0 + height + th * (1.3 + 1.6 * j), z0), hh))
    return dict(cells=cells, labels=labels, box=(x0, y0, x0 + w, y0 + height), z=z0,
                text_h=th, stepped=bool(classes))

def build_legend(L):
    """Rhino geometry for legend_layout: ([colour mesh, outline curves...], texts, planes, heights).
    In GH wire texts/planes/heights into a Text Tag 3D (Text, Location, Size)."""
    import Rhino.Geometry as rg
    import System
    m = rg.Mesh()
    for pts, c0, c1 in L["cells"]:
        k = m.Vertices.Count
        for p in pts:
            m.Vertices.Add(rg.Point3d(*p))
        m.Faces.AddFace(k, k + 1, k + 2, k + 3)
        for c in (c0, c0, c1, c1):
            m.VertexColors.Add(System.Drawing.Color.FromArgb(*c))
    m.Normals.ComputeNormals()
    z = L["z"]
    def rect(x0, y0, x1, y1):
        return rg.PolylineCurve([rg.Point3d(x0, y0, z), rg.Point3d(x1, y0, z), rg.Point3d(x1, y1, z),
                                 rg.Point3d(x0, y1, z), rg.Point3d(x0, y0, z)])
    crvs = [rect(*L["box"])]
    if L["stepped"]:
        for pts, _, _ in L["cells"][1:]:
            crvs.append(rg.LineCurve(rg.Point3d(*pts[0]), rg.Point3d(*pts[1])))
    texts = [t for t, _, _ in L["labels"]]
    planes = [rg.Plane(rg.Point3d(*p), rg.Vector3d.ZAxis) for _, p, _ in L["labels"]]
    heights = [h for _, _, h in L["labels"]]
    return [m] + crvs, texts, planes, heights

def _legend_layer(doc, path, rgb=(40, 40, 40)):
    import Rhino
    import System
    parent, full = None, ""
    for nm in path.split("::"):
        full = nm if not full else full + "::" + nm
        i = doc.Layers.FindByFullPath(full, -1)
        if i < 0:
            ly = Rhino.DocObjects.Layer(); ly.Name = nm
            if parent is not None:
                ly.ParentLayerId = doc.Layers[parent].Id
            ly.Color = System.Drawing.Color.FromArgb(*rgb)
            i = doc.Layers.Add(ly)
        parent = i
    return parent

def bake_legend(doc, L, layer_path):
    """Bake the legend (colour bar mesh, outline, text) on layer_path; returns object ids."""
    import Rhino
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = _legend_layer(doc, layer_path)
    a.Name = "Legend"
    geo, texts, planes, heights = build_legend(L)
    ids = [doc.Objects.AddMesh(geo[0], a)] + [doc.Objects.AddCurve(c, a) for c in geo[1:]]
    for t, pl, h in zip(texts, planes, heights):
        te = Rhino.Geometry.TextEntity.Create(t, pl, doc.DimStyles.Current, False, 0, 0)
        te.TextHeight = h
        te.Justification = Rhino.Geometry.TextJustification.BottomLeft
        ids.append(doc.Objects.AddText(te, a))
    return ids

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def rad_legend(rad, bmin, bmax, Lat, Lon, M0, M1, leg_lo=None, leg_hi=None, unit=1.0):
    lo, hi = value_range(rad, leg_lo, leg_hi)
    o, h = legend_place(bmin, bmax, unit)
    per = "year" if (int(M0), int(M1)) == (1, 12) else "{0}-{1}".format(MONTHS[int(M0) - 1], MONTHS[int(M1) - 1])
    title = "Solar radiation (kWh/m2)\n{0}  |  {1:.2f}, {2:.2f}".format(per, Lat, Lon)
    return legend_layout(lo, hi, lambda x: rad_colour(x, lo, hi), title, o, h, n_seg=10, n_lab=6,
                         fmt="{0:.0f}", top_plus=bool(rad) and max(rad) > hi + 1e-9,
                         bottom_minus=bool(rad) and min(rad) < lo - 1e-9)

# ------------------------------------------------------------- entry points
def _gh_value(name):
    v = globals().get(name)
    return DEFAULTS[name] if v is None else v

def run_command():
    import Rhino
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    from Rhino.Input.Custom import GetObject, OptionDouble, OptionInteger, OptionToggle
    key = "A002_solar_radiation"
    v = dict(DEFAULTS); v.update(sc.sticky.get(key, {}))
    v.setdefault("UseSite", False)
    ft = Rhino.DocObjects.ObjectType
    go = GetObject()
    go.SetCommandPrompt("Select objects to analyse")
    go.GeometryFilter = ft.Mesh | ft.Brep | ft.Surface | ft.Extrusion
    o = {}
    for k in ("Lat", "Lon", "Grid", "North", "Albedo"):
        o[k] = OptionDouble(float(v[k]))
    o["M0"] = OptionInteger(int(v["M0"]), 1, 12)
    o["M1"] = OptionInteger(int(v["M1"]), 1, 12)
    o["Years"] = OptionInteger(int(v["Years"]), 1, 10)
    o_site = OptionToggle(bool(v["UseSite"]), "No", "Yes")
    o_sky = OptionToggle(str(v.get("Sky", "perez")).lower().startswith("p"), "Isotropic", "Perez")
    for k, lab in [("Lat", "Latitude"), ("Lon", "Longitude"), ("M0", "FirstMonth"),
                   ("M1", "LastMonth"), ("Years", "Years"), ("Grid", "GridMetres"),
                   ("North", "NorthAngle"), ("Albedo", "Albedo")]:
        if isinstance(o[k], OptionInteger):
            go.AddOptionInteger(lab, o[k])
        else:
            go.AddOptionDouble(lab, o[k])
    go.AddOptionToggle("UseSiteModel", o_site)
    go.AddOptionToggle("SkyModel", o_sky)
    o_lg = OptionToggle(bool(v.get("Legend", True)), "No", "Yes")
    o_l0 = OptionDouble(-1.0 if v.get("LegMin") is None else float(v["LegMin"]), -1.0, 1.0e6)
    o_l1 = OptionDouble(-1.0 if v.get("LegMax") is None else float(v["LegMax"]), -1.0, 1.0e6)
    go.AddOptionToggle("Legend", o_lg)
    go.AddOptionDouble("LegendMin", o_l0)
    go.AddOptionDouble("LegendMax", o_l1)
    while True:
        res = go.GetMultiple(1, 0)
        if res == Rhino.Input.GetResult.Option:
            go.EnablePreSelect(False, True)
            continue
        if res != Rhino.Input.GetResult.Object:
            return
        break
    geo = [go.Object(i).Geometry() for i in range(go.ObjectCount)]
    for k in o:
        v[k] = o[k].CurrentValue
    v["UseSite"] = o_site.CurrentValue
    v["Sky"] = "perez" if o_sky.CurrentValue else "isotropic"
    v["Legend"] = o_lg.CurrentValue
    v["LegMin"] = None if o_l0.CurrentValue < 0 else o_l0.CurrentValue
    v["LegMax"] = None if o_l1.CurrentValue < 0 else o_l1.CurrentValue
    sc.sticky[key] = v
    lat, lon = v["Lat"], v["Lon"]
    if v["UseSite"]:
        ll = _site_latlon()
        if ll:
            lat, lon = ll
        else:
            print("SolarRadiation: no SiteModel run found, using Latitude/Longitude options")
    ctx = []
    ids = rs.GetObjects("Select shading context (Enter for none)",
                        rs.filter.mesh | rs.filter.polysurface | rs.filter.surface |
                        rs.filter.extrusion, preselect=False)
    if ids:
        ctx = [rs.coercegeometry(i) for i in ids]
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    Rhino.RhinoApp.WriteLine("SolarRadiation: fetching weather + tracing rays ...")
    try:
        mesh, rad, area, pv, total, sky, info = build(
            geo, ctx, lat, lon, v["M0"], v["M1"], v["Years"], v["Grid"] * f, v["North"],
            v["Albedo"], DEFAULTS["PvEff"], offset=0.01 * f, unit_to_m=1.0 / f, Sky=v["Sky"],
            leg_lo=v["LegMin"], leg_hi=v["LegMax"])
    except ValueError as e:
        print("SolarRadiation: {0}".format(e))
        return
    except Exception as e:
        print("SolarRadiation: weather download failed ({0})".format(e))
        return
    idx = sc.doc.Layers.FindByFullPath("A002", -1)
    if idx < 0:
        idx = sc.doc.Layers.Add("A002", __import__("System").Drawing.Color.FromArgb(255, 120, 0))
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = idx
    a.Name = "SolarRadiation M{0}-{1}".format(int(v["M0"]), int(v["M1"]))
    mid = sc.doc.Objects.AddMesh(mesh, a)
    dots = []
    if v["Legend"] and rad:
        bb = mesh.GetBoundingBox(True)
        L = rad_legend(rad, (bb.Min.X, bb.Min.Y, bb.Min.Z), (bb.Max.X, bb.Max.Y, bb.Max.Z),
                       lat, lon, v["M0"], v["M1"], v["LegMin"], v["LegMax"], f)
        dots = bake_legend(sc.doc, L, "A002::Legend")
    grp = rs.AddGroup(); rs.AddObjectsToGroup([mid] + dots, grp)
    sc.doc.Views.Redraw()
    print(info)

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    legend, leg_text, leg_pl, leg_size = [], [], [], []
    if globals().get("Geo") is None or not _gh_value("Run"):
        mesh, rad, area, pv, total, sky, info = None, [], [], [], 0.0, [], "Connect geometry to Geo (and Run = True)"
    else:
        _lat, _lon = globals().get("Lat"), globals().get("Lon")
        if _lat is None and _lon is None and _site_latlon():
            _lat, _lon = _site_latlon()
        mesh, rad, area, pv, total, sky, info = build(
            globals().get("Geo"), globals().get("Ctx"),
            DEFAULTS["Lat"] if _lat is None else _lat, DEFAULTS["Lon"] if _lon is None else _lon,
            *[_gh_value(k) for k in ("M0", "M1", "Years", "Grid", "North", "Albedo", "PvEff")],
            Sky=_gh_value("Sky"), leg_lo=globals().get("LegMin"), leg_hi=globals().get("LegMax"))
        if rad:
            _bb = mesh.GetBoundingBox(True)
            _L = rad_legend(rad, (_bb.Min.X, _bb.Min.Y, _bb.Min.Z), (_bb.Max.X, _bb.Max.Y, _bb.Max.Z),
                            DEFAULTS["Lat"] if _lat is None else _lat, DEFAULTS["Lon"] if _lon is None else _lon,
                            _gh_value("M0"), _gh_value("M1"), globals().get("LegMin"), globals().get("LegMax"))
            legend, leg_text, leg_pl, leg_size = build_legend(_L)
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        P = tregenza()
        print("patches", len(P), "solid angle sum", round(sum(p[2] for p in P), 4), "(2pi =", round(2 * math.pi, 4), ")")
        bad = [i for i, p in enumerate(P) if patch_index(p[0], p[1]) != i]
        print("patch_index self-check errors:", len(bad))
        sky = site_sky(51.92, 4.48, 3)
        print(reference_text(sky, 0.2), "| GHI", round(sky["ghi"] / 1000), "years", sky["years"])
