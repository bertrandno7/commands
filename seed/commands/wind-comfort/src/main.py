# r: numpy
"""
W002  Wind Comfort  (NEN 8100 classes A-E + danger, screening level)
Needs numpy: Rhino 8 Script component / ScriptEditor (Python 3).
Uses the solver in W001_wind_screening.py: keep both files in the same folder
(00_Rhino_Commands does this) or in C:\\Scripts\\GH-Library, or set LibPath.
Also runs as a Rhino command (alias: WindComfort).

Method (NEN 8100 style, simplified):
  1. Hourly ERA5 100 m wind (speed + direction) and 10 m speed for Lat/Lon,
     last Years full years, Open-Meteo archive (cached per location per session).
     100 m is used as reference because ERA5 10 m wind over land is slowed by the
     grid cell's own roughness; that roughness is solved from the 100/10 m ratio.
  2. For every wind sector (12 by default) the 2D W001 lattice-Boltzmann flow
     gives the speed ratio at 1.5 m around the buildings. Sectors whose winds can
     never reach the threshold are skipped and count as undisturbed (ratio 1).
  3. Reference speed at pedestrian height: ERA5 100 m -> 60 m blending height
     (ERA5 cell roughness) -> 1.75 m over the site's roughness Z0 (log law).
  4. Per ground cell: P5 = share of all hours with local speed > 5 m/s,
     P15 = share with > 15 m/s.
  Comfort class (P5):  A < 2.5%   B 2.5-5%   C 5-10%   D 10-20%   E > 20%
     sitting long: A good, B moderate, C+ poor
     strolling:    A-B good, C moderate, D+ poor
     walking through: A-C good, D moderate, E poor
  Danger (P15):  < 0.05% none | 0.05-0.3% limited risk | > 0.3% dangerous
SCREENING ONLY: 2D slice, so no downwash. Tall buildings (> ~30 m) pull fast
air down to street level and their corners score WORSE in reality than here.
Use it to compare options and find relative problem zones, not for sign-off.

GH INPUTS:
    Geo     : Brep/Mesh(es) buildings
    Lat, Lon: site location (default Rotterdam 51.92, 4.48; falls back to the
              X000 site model in sc.sticky when Lat/Lon are empty)
    Sectors : int    wind sectors (default 12)
    Cell    : float  grid cell, model units (default 2.0)
    Margin  : float  analysed ground around the buildings (default 40)
    Z0      : float  site roughness length in metres (default 0.3; 0.1 open, 0.5-1 city)
    Years   : int    years of hourly data (default 5)
    North   : float  degrees, north from +Y toward -X (default 0)
    Units   : float  model units per metre (default 1; mm model = 1000)
    LibPath : str    folder holding W001_wind_screening.py (optional)
    Run     : bool   set True to solve (default False: it takes minutes)

GH OUTPUTS:
    mesh    : ground mesh coloured by comfort class (A emerald .. E magenta)
    p5      : % hours > 5 m/s per face      cls : class letter per face
    p15     : % hours > 15 m/s per face     danger : 0 none / 1 limited / 2 dangerous
    danger_mesh : faces with danger >= 1 (pink / red)
    area    : [A, B, C, D, E] area m2
    rose    : wind rose rows (100 m; last column = % hours > 8 m/s)      metrics : plain dict (also sc.sticky["W002_metrics"])
    info    : summary text
    legend, leg_text, leg_pl, leg_size : Ladybug-style stepped legend (class boxes A-E +
              danger, with P5 range, verdict and area; wire leg_text / leg_pl / leg_size into
              a Text Tag 3D: Text, Location, Size)

RHINO COMMAND / ALIAS:
    Alias  WindComfort  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\W002_wind_comfort.py"
    Options: Latitude, Longitude, Sectors, CellMetres, MarginMetres, Roughness, Years,
    NorthAngle, UseSiteModel, Legend (Yes/No). Bakes on W002::Comfort, W002::Danger and a
    Ladybug-style stepped legend on W002::Legend, all grouped.
"""
from __future__ import division, print_function
import math, os, sys

DEFAULTS = dict(Lat=51.92, Lon=4.48, Sectors=12, Cell=2.0, Margin=40.0, Z0=0.3, Years=5,
                North=0.0, Units=1.0, LibPath="", Run=False, Site=False)
CLASS_EDGES = [(2.5, "A"), (5.0, "B"), (10.0, "C"), (20.0, "D"), (1e9, "E")]
CLASS_RGB = {"A": (0, 170, 110), "B": (120, 220, 90), "C": (255, 210, 0),
             "D": (255, 120, 0), "E": (230, 0, 126)}
DANGER_RGB = {1: (255, 64, 129), 2: (170, 0, 40)}
VERDICT = {"A": "good for sitting", "B": "good for strolling", "C": "good for walking through",
           "D": "moderate for walking through", "E": "poor for any activity"}

# ---------------------------------------------------------------- pure maths
def comfort_class(p5):
    for edge, c in CLASS_EDGES:
        if p5 < edge:
            return c
    return "E"

def danger_class(p15):
    return 0 if p15 < 0.05 else (1 if p15 < 0.3 else 2)

def era5_roughness(u100, u10):
    """Effective roughness of the ERA5 grid cell from its own 100 m / 10 m wind
    ratio (log law): k = ln(100/z)/ln(10/z)  ->  z = 10 * exp(-ln10/(k-1))."""
    k = u100 / u10 if u10 > 0 else 1.5
    k = max(1.05, k)
    return min(1.5, max(0.005, 10.0 * math.exp(-math.log(10.0) / (k - 1.0))))

def ped_factor(z0=0.3, z0_era=0.35, zp=1.75, zref=100.0, zb=60.0):
    """Local speed at zp over site roughness z0 per m/s of ERA5 100 m wind:
    100 m -> 60 m blending height with the ERA5 cell roughness, then 60 m -> zp
    over the site (log law). Rotterdam (z0_era ~0.35, z0 0.3) -> ~0.30."""
    z0 = max(z0, 1e-3)
    zp = max(zp, z0 * 1.5)
    u60 = math.log(zb / z0_era) / math.log(zref / z0_era)
    return u60 * math.log(zp / z0) / math.log(zb / z0)

def fetch_wind100(lat, lon, years=5):
    """Hourly ERA5 100 m wind speed + direction and 10 m speed (Open-Meteo archive),
    last `years` full calendar years. IronPython / Python 3 / .NET fallback."""
    import datetime, json
    y1 = datetime.date.today().year - 1
    url = ("https://archive-api.open-meteo.com/v1/archive?latitude={0:.4f}&longitude={1:.4f}"
           "&start_date={2}-01-01&end_date={3}-12-31&hourly=wind_speed_100m,wind_direction_100m,"
           "wind_speed_10m&wind_speed_unit=ms&timezone=UTC").format(lat, lon, y1 - int(years) + 1, y1)
    try:
        try:
            from urllib.request import urlopen
        except ImportError:
            from urllib2 import urlopen
        raw = urlopen(url, timeout=90).read()
    except Exception:
        import System
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12
        raw = System.Net.WebClient().DownloadString(url)
    if not isinstance(raw, str):
        raw = raw.decode("utf-8")
    h = json.loads(raw)["hourly"]
    return h["wind_speed_100m"], h["wind_direction_100m"], h["wind_speed_10m"]

def mean_valid(xs):
    v = [x for x in xs if x is not None]
    return sum(v) / len(v) if v else 0.0

def sector_of(d, n):
    w = 360.0 / n
    return int(((d % 360.0) + w / 2) // w) % n

def sector_speeds(speeds, dirs, n):
    """Sorted 10 m speeds per sector + total valid hours."""
    out = [[] for _ in range(n)]
    N = 0
    for s, d in zip(speeds, dirs):
        if s is None or d is None:
            continue
        out[sector_of(d, n)].append(float(s)); N += 1
    return [sorted(o) for o in out], N

def needs_run(sorted_sp, N, f, thresh=5.0, max_ratio=2.0, min_share=0.001):
    """False when even at max_ratio this sector adds < min_share of hours above thresh."""
    import bisect
    if not sorted_sp:
        return False
    lim = thresh / (f * max_ratio)
    return (len(sorted_sp) - bisect.bisect_right(sorted_sp, lim)) / max(N, 1) >= min_share

def exceedance(ratio_maps, sorted_by_sector, N, f, thresh):
    """% of hours local speed > thresh. ratio_maps: list (per sector) of numpy
    arrays of speed ratio at the analysis points (same shape)."""
    import numpy as np
    tot = None
    for r, sp in zip(ratio_maps, sorted_by_sector):
        if not sp:
            continue
        a = np.asarray(sp)
        lim = thresh / (f * np.maximum(r, 1e-6))
        cnt = len(a) - np.searchsorted(a, lim, side="right")
        tot = cnt if tot is None else tot + cnt
    return 100.0 * tot / max(N, 1)

def sample(r, origin, X, Y, cell, px, py):
    """Nearest-cell lookup of a flow-frame result r (ny, nx) at model points."""
    import numpy as np
    dx, dy = px - origin[0], py - origin[1]
    i = np.floor((dx * X[0] + dy * X[1]) / cell).astype(int)
    j = np.floor((dx * Y[0] + dy * Y[1]) / cell).astype(int)
    ny, nx = r.shape
    ok = (i >= 0) & (i < nx) & (j >= 0) & (j < ny)
    out = np.ones(px.shape)
    out[ok] = r[j[ok], i[ok]]
    return out

STABLE_SETS = [(0.08, 0.52, 0.15), (0.06, 0.55, 0.18), (0.05, 0.60, 0.20)]

def solve_stable(w, solid, steps=0):
    """W001 solver with fallbacks: complex city geometry can blow up at the
    default low viscosity, so retry with lower inlet speed / more viscosity."""
    import warnings
    last = None
    for u0, tau0, cs in STABLE_SETS:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                return w.lbm_solve(solid, steps, u0=u0, tau0=tau0, cs=cs)
        except RuntimeError as e:
            last = e
    raise last

def area_by_class(classes, cell_area):
    return [cell_area * sum(1 for c in classes if c == k) for k in "ABCDE"]

def summary(m):
    a = m["area"]; t = sum(a) or 1.0
    return ("Site {0:.3f}, {1:.3f} | {2} sectors ({3} solved), z0 {4:g} m, ped factor {5:.2f} x ERA5 100 m | "
            "area A {6:.0f}% B {7:.0f}% C {8:.0f}% D {9:.0f}% E {10:.0f}% of {11:,.0f} m2 | "
            "max P5 {12:.1f}% | danger: limited {13:,.0f} m2, dangerous {14:,.0f} m2".format(
                m["lat"], m["lon"], m["sectors"], m["solved"], m["z0"], m["ped_factor"],
                *([100 * x / t for x in a] + [t, m["max_p5"], m["danger_area"][0], m["danger_area"][1]])))

# --------------------------------------------------------- library loading
def _w001(libpath=""):
    here = None
    try:
        here = os.path.dirname(os.path.abspath(__file__))
    except NameError:
        pass
    for p in (libpath, here, r"C:\Scripts\GH-Library", os.path.join(os.path.expanduser("~"), "GH-Library")):
        if p and os.path.isdir(p) and p not in sys.path:
            sys.path.append(p)
    import W001_wind_screening as w
    return w

def wind_data(lat, lon, years, w):
    key = (round(lat, 2), round(lon, 2), int(years))
    try:
        import scriptcontext as sc
        cache = sc.sticky.setdefault("W002_wind_cache", {})
    except Exception:
        cache = globals().setdefault("_WIND_CACHE", {})
    if key not in cache:
        cache[key] = fetch_wind100(lat, lon, int(years))
    return cache[key]

# ------------------------------------------------------------ rhino geometry
def _raster(w, crvs, X, Y, cell, z, x0, y0, nx, ny):
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    origin = rg.Point3d(0, 0, z) + X * x0 + Y * y0
    solid = []
    for j in range(ny):
        a = origin + Y * ((j + 0.5) * cell)
        line = rg.LineCurve(a - X * cell, a + X * (nx + 1) * cell)
        cross = []
        for c in crvs:
            ev = Intersection.CurveCurve(line, c, 0.001, 0.001)
            if ev:
                cross.extend([(e.PointA - a) * X / cell for e in ev])
        solid.append(w.fill_row(cross, nx))
    return solid, origin

def build(Geo, Lat, Lon, Sectors, Cell, Margin, Z0, Years, North, Units=1.0, LibPath="", Run=True, log=None):
    import Rhino.Geometry as rg
    import System
    w = _w001(LibPath)
    u = float(Units) or 1.0
    if Lat is None or Lon is None:
        try:
            import scriptcontext as sc
            s = sc.sticky.get("X000_site") or {}
            Lat, Lon = s.get("lat", DEFAULTS["Lat"]), s.get("lon", DEFAULTS["Lon"])
        except Exception:
            Lat, Lon = DEFAULTS["Lat"], DEFAULTS["Lon"]
    z = 1.5 * u
    crvs = w._sections(Geo, z)
    if not crvs:
        raise ValueError("Nothing cut at 1.5 m: connect buildings to Geo")
    n = int(Sectors)
    speeds, dirs, s10 = wind_data(Lat, Lon, Years, w)
    rose = w.wind_rose(speeds, dirs, n, 8.0)
    by_sec, N = sector_speeds(speeds, dirs, n)
    z0e = era5_roughness(mean_valid(speeds), mean_valid(s10))
    f = ped_factor(Z0, z0e)
    # analysis grid, axis aligned in model XY
    bb = rg.BoundingBox.Empty
    for c in crvs:
        bb.Union(c.GetBoundingBox(True))
    gx0, gy0 = bb.Min.X - Margin, bb.Min.Y - Margin
    gnx, gny = int((bb.Max.X - bb.Min.X + 2 * Margin) / Cell) + 1, int((bb.Max.Y - bb.Min.Y + 2 * Margin) / Cell) + 1
    head = "{0} x {1} ground cells, {2} sectors".format(gnx, gny, n)
    if not Run:
        return dict(mesh=None, info="Run is False: " + head + " (each solved sector takes a while)",
                    rose=w.rose_text(rose))
    import numpy as np
    gsolid, _ = _raster(w, crvs, rg.Vector3d.XAxis, rg.Vector3d.YAxis, Cell, z, gx0, gy0, gnx, gny)
    gsolid = np.array(gsolid, dtype=bool)
    J, I = np.mgrid[0:gny, 0:gnx]
    px, py = gx0 + (I + 0.5) * Cell, gy0 + (J + 0.5) * Cell
    maps, solved = [], 0
    pts = []
    for c in crvs:
        pts.extend(c.DivideEquidistant(Cell * 0.5) or [])
    for k in range(n):
        d = k * 360.0 / n
        if not needs_run(by_sec[k], N, f):
            maps.append(np.ones(px.shape)); continue
        (xa, ya) = w.flow_axes(d, North)
        X, Y = rg.Vector3d(xa[0], xa[1], 0), rg.Vector3d(ya[0], ya[1], 0)
        xs = [p.X * X.X + p.Y * X.Y for p in pts]; ys = [p.X * Y.X + p.Y * Y.Y for p in pts]
        up, down = max(60.0 * u, Margin + 20 * u), max(80.0 * u, Margin + 40 * u)
        x0, x1 = min(xs) - up, max(xs) + down
        side = w.side_pad(max(ys) - min(ys), up)
        y0, y1 = min(ys) - side, max(ys) + side
        nx, ny = int((x1 - x0) / Cell) + 1, int((y1 - y0) / Cell) + 1
        solid, origin = _raster(w, crvs, X, Y, Cell, z, x0, y0, nx, ny)
        r, steps = solve_stable(w, solid, 0)
        maps.append(sample(r, (origin.X, origin.Y), xa, ya, Cell, px, py))
        solved += 1
        if log:
            log("sector {0:g} deg solved ({1}/{2})".format(d, k + 1, n))
    p5 = exceedance(maps, by_sec, N, f, 5.0)
    p15 = exceedance(maps, by_sec, N, f, 15.0)
    mesh, dmesh = rg.Mesh(), rg.Mesh()
    P5, P15, CLS, DG = [], [], [], []
    for j in range(gny):
        for i in range(gnx):
            if gsolid[j, i]:
                continue
            a, b = float(p5[j, i]), float(p15[j, i])
            c, dg = comfort_class(a), danger_class(b)
            P5.append(a); P15.append(b); CLS.append(c); DG.append(dg)
            for msh, col in ((mesh, CLASS_RGB[c]),) + (((dmesh, DANGER_RGB[dg]),) if dg else ()):
                p = rg.Point3d(gx0 + i * Cell, gy0 + j * Cell, z if msh is mesh else z + 0.05 * u)
                k0 = msh.Vertices.Count
                for q in (p, p + rg.Vector3d(Cell, 0, 0), p + rg.Vector3d(Cell, Cell, 0), p + rg.Vector3d(0, Cell, 0)):
                    msh.Vertices.Add(q)
                msh.Faces.AddFace(k0, k0 + 1, k0 + 2, k0 + 3)
                cc = System.Drawing.Color.FromArgb(*col)
                for _ in range(4):
                    msh.VertexColors.Add(cc)
    mesh.Normals.ComputeNormals(); dmesh.Normals.ComputeNormals()
    ca = Cell * Cell / (u * u)
    m = dict(lat=Lat, lon=Lon, sectors=n, solved=solved, z0=Z0, z0_era=z0e, ped_factor=f,
             area=area_by_class(CLS, ca), max_p5=max(P5) if P5 else 0.0,
             danger_area=[ca * DG.count(1), ca * DG.count(2)], years=int(Years))
    m["share_poor"] = (m["area"][3] + m["area"][4]) / (sum(m["area"]) or 1.0)
    try:
        import scriptcontext as sc
        sc.sticky["W002_metrics"] = m
    except Exception:
        pass
    return dict(mesh=mesh, danger_mesh=dmesh, p5=P5, p15=P15, cls=CLS, danger=DG,
                area=m["area"], rose=w.rose_text(rose), metrics=m, info=summary(m),
                legend_at=rg.Point3d(gx0 + gnx * Cell + 5 * u, gy0 + gny * Cell, z))

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

def comfort_legend(bmin, bmax, area, Lat, Lon, unit=1.0):
    classes = []
    for k, c in enumerate("ABCDE"):
        lo, hi = ([0] + [e for e, _ in CLASS_EDGES])[k], CLASS_EDGES[k][0]
        rng = "< {0:g}%".format(hi) if k == 0 else ("> {0:g}%".format(lo) if k == 4 else "{0:g}-{1:g}%".format(lo, hi))
        a = area[k] if area and len(area) > k else 0.0
        classes.append(("{0}   P5 {1}   {2}   {3:,.0f} m2".format(c, rng, VERDICT[c], a), CLASS_RGB[c]))
    classes.append(("Danger: limited risk   P15 0.05-0.3%", DANGER_RGB[1]))
    classes.append(("Danger: dangerous   P15 > 0.3%", DANGER_RGB[2]))
    o, h = legend_place(bmin, bmax, unit)
    title = "Wind comfort NEN 8100 (screening)\nP5 = % hours > 5 m/s at 1.75 m  |  {0:.2f}, {1:.2f}".format(Lat, Lon)
    return legend_layout(0, 1, None, title, o, h, classes=classes)

# ------------------------------------------------------------- entry points
def _gh_value(name):
    v = globals().get(name)
    if name in ("Lat", "Lon"):
        return v
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
    import scriptcontext as sc
    from Rhino.Input.Custom import GetObject, OptionDouble, OptionInteger, OptionToggle
    key = "W002_wind_comfort"
    v = dict(DEFAULTS); v.update(sc.sticky.get(key, {}))
    ft = Rhino.DocObjects.ObjectType
    go = GetObject()
    go.SetCommandPrompt("Select buildings")
    go.GeometryFilter = ft.Mesh | ft.Brep | ft.Extrusion
    od = {}
    for k, lab in (("Lat", "Latitude"), ("Lon", "Longitude"), ("Cell", "CellMetres"),
                   ("Margin", "MarginMetres"), ("Z0", "Roughness"), ("North", "NorthAngle")):
        od[k] = OptionDouble(float(v[k])); go.AddOptionDouble(lab, od[k])
    oi = {"Sectors": OptionInteger(int(v["Sectors"]), 4, 36), "Years": OptionInteger(int(v["Years"]), 1, 20)}
    go.AddOptionInteger("Sectors", oi["Sectors"]); go.AddOptionInteger("Years", oi["Years"])
    ot = OptionToggle(bool(v["Site"]), "No", "Yes"); go.AddOptionToggle("UseSiteModel", ot)
    o_lg = OptionToggle(bool(v.get("Legend", True)), "No", "Yes"); go.AddOptionToggle("Legend", o_lg)
    while True:
        res = go.GetMultiple(1, 0)
        if res == Rhino.Input.GetResult.Option:
            go.EnablePreSelect(False, True); continue
        if res != Rhino.Input.GetResult.Object:
            return
        break
    geo = [go.Object(i).Geometry() for i in range(go.ObjectCount)]
    for k in od:
        v[k] = od[k].CurrentValue
    for k in oi:
        v[k] = oi[k].CurrentValue
    v["Site"] = ot.CurrentValue
    v["Legend"] = o_lg.CurrentValue
    sc.sticky[key] = v
    lat, lon = v["Lat"], v["Lon"]
    s = sc.sticky.get("X000_site") if v["Site"] else None
    if s:
        lat, lon = s.get("lat", lat), s.get("lon", lon)
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    def log(msg):
        Rhino.RhinoApp.SetCommandPrompt("WindComfort: " + msg); Rhino.RhinoApp.Wait()
        print(msg)
    try:
        out = build(geo, lat, lon, v["Sectors"], v["Cell"] * f, v["Margin"] * f, v["Z0"], v["Years"],
                    v["North"], f, "", True, log)
    except (ValueError, RuntimeError, ImportError) as e:
        print("WindComfort: {0}".format(e)); return
    _layer(sc.doc, "W002", (120, 120, 120))
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = _layer(sc.doc, "Comfort", CLASS_RGB["B"], "W002")
    a.Name = "NEN 8100 comfort class"
    ids = [sc.doc.Objects.AddMesh(out["mesh"], a)]
    if out["danger_mesh"].Faces.Count:
        a2 = Rhino.DocObjects.ObjectAttributes(); a2.LayerIndex = _layer(sc.doc, "Danger", DANGER_RGB[1], "W002")
        ids.append(sc.doc.Objects.AddMesh(out["danger_mesh"], a2))
    if v.get("Legend", True):
        bb = out["mesh"].GetBoundingBox(True)
        L = comfort_legend((bb.Min.X, bb.Min.Y, bb.Min.Z), (bb.Max.X, bb.Max.Y, bb.Max.Z), out["area"], lat, lon, f)
        ids += bake_legend(sc.doc, L, "W002::Legend")
    import rhinoscriptsyntax as rs
    g = rs.AddGroup(); rs.AddObjectsToGroup([i for i in ids if i], g)
    sc.doc.Views.Redraw()
    for line in out["rose"]:
        print(line)
    print(out["info"])

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    _o = {}
    if globals().get("Geo") is None:
        info = "Connect buildings to Geo, then set Run to True"
    else:
        _o = build(globals().get("Geo"), *[_gh_value(k) for k in
                   ("Lat", "Lon", "Sectors", "Cell", "Margin", "Z0", "Years", "North", "Units", "LibPath", "Run")])
        info = _o.get("info")
    mesh, danger_mesh = _o.get("mesh"), _o.get("danger_mesh")
    p5, p15, cls, danger = _o.get("p5", []), _o.get("p15", []), _o.get("cls", []), _o.get("danger", [])
    area, rose, metrics = _o.get("area", []), _o.get("rose", []), _o.get("metrics", {})
    legend, leg_text, leg_pl, leg_size = [], [], [], []
    if mesh is not None and mesh.Faces.Count:
        _bb = mesh.GetBoundingBox(True)
        _L = comfort_legend((_bb.Min.X, _bb.Min.Y, _bb.Min.Z), (_bb.Max.X, _bb.Max.Y, _bb.Max.Z), area,
                            metrics.get("lat", 0.0), metrics.get("lon", 0.0), _gh_value("Units"))
        legend, leg_text, leg_pl, leg_size = build_legend(_L)
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        z = era5_roughness(6.72, 3.98)
        print("ERA5 z0 Rotterdam:", round(z, 3), " ped factor z0 0.3:", round(ped_factor(0.3, z), 3))
        print([comfort_class(p) for p in (1, 3, 7, 15, 30)], [danger_class(p) for p in (0.01, 0.1, 1)])
