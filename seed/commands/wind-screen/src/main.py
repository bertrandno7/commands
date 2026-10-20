# r: numpy
"""
W001  Wind Screening  (2D lattice-Boltzmann flow at pedestrian height)
Needs numpy: Rhino 8 Script component / ScriptEditor (Python 3). The "# r: numpy"
line above makes Rhino 8 install it automatically. Rhino 7 IronPython cannot run
the solver (no numpy) and returns a message instead.
Also runs as a Rhino command (alias: WindScreen).

SCREENING ONLY: buildings are cut at height Z and the flow is solved in 2D, so
there is no downwash, no vertical flow and no boundary layer. Use it to compare
massing options and spot corner streams, gaps and wind shadows, not for
NEN 8100 wind comfort sign-off (that needs 3D CFD).

GH INPUTS:
    Geo   : Brep/Mesh(es)  buildings
    Lat   : float  site latitude  (default 51.92 Rotterdam)
    Lon   : float  site longitude (default 4.48)
    Dir   : float  wind FROM direction, degrees clockwise from north.
                   Empty or < 0 = AUTO: the sector with the most hours above 5 m/s
                   in the last 5 years of hourly ERA5 data for Lat/Lon (Open-Meteo,
                   free, needs internet; cached per location for the session)
    Z     : float  slice height, model units (default 1.5)
    Cell  : float  grid cell size, model units (default 1.0)
    Up    : float  free space upstream (default 60); sides use max(Up, 2.5 x cross-wind width)
    Down  : float  free space downstream (default 80)
    Steps : int    solver steps, 0 = automatic (default 0)
    North : float  degrees, angle of north from +Y toward -X (default 0)
    Run   : bool   set True to solve (default True)

GH OUTPUTS:
    mesh  : coloured mesh at height Z (speed ratio = local speed / free wind speed)
    ratio : speed ratio per mesh face (1.0 = undisturbed wind beside the site)
    arrow : line showing the wind direction
    rose  : wind rose rows "from_deg  freq%  mean m/s  %hours>5m/s" (auto mode)
    rose_crv : wind rose wedges (closed polylines) next to the site, radius = freq
    info  : summary text
    legend, leg_text, leg_pl, leg_size : Ladybug-style legend (colour bar mesh + outline;
            wire leg_text / leg_pl / leg_size into a Text Tag 3D: Text, Location, Size)

RHINO COMMAND / ALIAS:
    Alias  WindScreen  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\W001_wind_screening.py"
    Pick buildings; options Latitude, Longitude, WindFrom (-1 = auto), HeightMetres, CellMetres, UpstreamMetres,
    DownstreamMetres, NorthAngle, Legend (Yes/No); bakes the coloured mesh to layer W001 and a
    Ladybug-style legend (speed ratio 0 .. 1.5, fixed so runs compare) on W001::Legend, grouped.
"""
from __future__ import division, print_function
import math

DEFAULTS = dict(Lat=51.92, Lon=4.48, Dir=-1.0, Z=1.5, Cell=1.0, Up=60.0, Down=80.0, Steps=0, North=0.0, Run=True)

# ------------------------------------------------------- pure math (no numpy)
def flow_axes(from_deg, north=0.0):
    """Unit x axis (direction the wind blows TO) and y axis, in model XY."""
    to = math.radians(from_deg + 180.0 - north)       # azimuth, clockwise from model north
    x = (math.sin(to), math.cos(to))
    y = (-x[1], x[0])
    return x, y

def ratio_colour(r):
    """speed ratio -> rgb: calm blue, 1.0 yellow, >= 1.5 dark red."""
    stops = [(0.0, (40, 60, 160)), (0.5, (60, 170, 200)), (0.85, (120, 200, 120)),
             (1.0, (245, 220, 70)), (1.2, (240, 140, 40)), (1.5, (190, 30, 40))]
    r = max(0.0, min(1.5, r))
    for (t0, c0), (t1, c1) in zip(stops[:-1], stops[1:]):
        if r <= t1:
            u = (r - t0) / (t1 - t0)
            return tuple(int(c0[i] + (c1[i] - c0[i]) * u) for i in range(3))
    return stops[-1][1]

def side_pad(cross_width, up):
    """Free space beside the buildings: at least 2.5x their cross-wind width,
    so 2D blockage stays under ~17 percent."""
    return max(up, 2.5 * cross_width)

def fill_row(crossings, nx):
    """Even-odd fill of one grid row from sorted crossing positions (cell units)."""
    row = [False] * nx
    xs = sorted(crossings)
    for a, b in zip(xs[0::2], xs[1::2]):
        i0, i1 = int(math.ceil(a - 0.5)), int(math.floor(b - 0.5))
        for i in range(max(0, i0), min(nx - 1, i1) + 1):
            row[i] = True
    return row

def summary(ratios, cell, nx, ny, steps):
    if not ratios:
        return "No result"
    hi = sum(1 for r in ratios if r > 1.2)
    lo = sum(1 for r in ratios if r < 0.5)
    return ("Grid {0} x {1} @ {2:g} | steps {3} | max ratio {4:.2f} | "
            "area > 1.2x: {5:.0f} | area < 0.5x: {6:.0f} (model units^2)".format(
                nx, ny, cell, steps, max(ratios), hi * cell * cell, lo * cell * cell))

# ------------------------------------------------------- wind climate
def wind_rose(speeds, dirs, n=12, threshold=5.0):
    """Rows (from_deg, freq_pct, mean_speed, pct_hours_over_threshold)."""
    w = 360.0 / n
    cnt = [0] * n; tot = [0.0] * n; strong = [0] * n
    N = 0
    for sp, d in zip(speeds, dirs):
        if sp is None or d is None:
            continue
        N += 1
        k = int(((d % 360.0) + w / 2) // w) % n
        cnt[k] += 1; tot[k] += sp
        if sp > threshold:
            strong[k] += 1
    N = max(N, 1)
    return [(k * w, 100.0 * cnt[k] / N, tot[k] / cnt[k] if cnt[k] else 0.0,
             100.0 * strong[k] / N) for k in range(n)]

def prevailing(rose):
    """Direction with most strong-wind hours (falls back to most frequent)."""
    best = max(rose, key=lambda r: (r[3], r[1]))
    return best[0]

def fetch_wind(lat, lon, years=5):
    """Hourly 10 m wind speed (m/s) and direction from Open-Meteo ERA5 archive
    for the last `years` full calendar years. Works in IronPython and Python 3."""
    import datetime, json
    y1 = datetime.date.today().year - 1
    url = ("https://archive-api.open-meteo.com/v1/archive?latitude={0:.4f}&longitude={1:.4f}"
           "&start_date={2}-01-01&end_date={3}-12-31&hourly=wind_speed_10m,wind_direction_10m"
           "&wind_speed_unit=ms&timezone=UTC").format(lat, lon, y1 - years + 1, y1)
    try:
        try:
            from urllib.request import urlopen
        except ImportError:                 # IronPython 2.7
            from urllib2 import urlopen
        raw = urlopen(url, timeout=60).read()
    except Exception:
        import System                       # .NET fallback (Rhino 7 TLS issues)
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12
        raw = System.Net.WebClient().DownloadString(url)
    if not isinstance(raw, str):
        raw = raw.decode("utf-8")
    data = json.loads(raw)["hourly"]
    return data["wind_speed_10m"], data["wind_direction_10m"]

_ROSE_CACHE = {}

def site_rose(lat, lon):
    key = (round(lat, 2), round(lon, 2))
    try:
        import scriptcontext as sc
        cache = sc.sticky.setdefault("W001_rose_cache", {})
    except Exception:
        cache = _ROSE_CACHE
    if key not in cache:
        cache[key] = wind_rose(*fetch_wind(lat, lon))
    return cache[key]

def rose_text(rose):
    return ["{0:5.0f}  {1:5.1f}%  {2:4.1f} m/s  {3:5.2f}%>5".format(*r) for r in rose]

# ------------------------------------------------------- LBM solver (numpy)
def lbm_solve(solid, steps=0, u0=0.08, tau0=0.52, cs=0.15, avg_frac=0.5, log=None):
    """D2Q9 BGK + Smagorinsky. solid: bool array (ny, nx); flow along +x.
    tau0 = 0.52 + Smagorinsky adds an effective (turbulent) viscosity so 2D wakes stay short.
    Returns time-averaged speed / far-field speed (mean of the two side rows,
    which removes most of the 2D blockage speed-up), solids = 0."""
    import numpy as np
    solid = np.asarray(solid, dtype=bool)
    ny, nx = solid.shape
    if steps <= 0:
        steps = int(4 * nx / u0)              # ~4 flow-throughs
    c = np.array([(0, 0), (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, 1), (-1, -1), (1, -1)])
    w = np.array([4/9] + [1/9]*4 + [1/36]*4)
    opp = [0, 3, 4, 1, 2, 7, 8, 5, 6]
    cx, cy = c[:, 0][:, None, None], c[:, 1][:, None, None]
    W = w[:, None, None]

    def feq(rho, ux, uy):
        cu = 3 * (cx * ux + cy * uy)
        return W * rho * (1 + cu + 0.5 * cu * cu - 1.5 * (ux * ux + uy * uy))

    R, Z0, L = [1, 5, 8], [0, 2, 4], [3, 6, 7]       # right-, zero-, left-moving
    f = feq(np.ones((ny, nx)), np.where(solid, 0.0, u0), np.zeros((ny, nx)))
    acc = np.zeros((ny, nx)); n_acc = 0
    start = int(steps * (1 - avg_frac))
    for t in range(steps):
        f[L, :, -1] = f[L, :, -2]                         # outflow
        rho = f.sum(0)
        ux = (f * cx).sum(0) / rho
        uy = (f * cy).sum(0) / rho
        ux[:, 0] = u0; uy[:, 0] = 0                       # Zou-He velocity inlet
        rho[:, 0] = (f[Z0, :, 0].sum(0) + 2 * f[L, :, 0].sum(0)) / (1 - u0)
        fe = feq(rho, ux, uy)
        f[R, :, 0] = fe[R, :, 0] + f[[3, 7, 6], :, 0] - fe[[3, 7, 6], :, 0]
        fn = f - fe
        pxx = (fn * cx * cx).sum(0); pyy = (fn * cy * cy).sum(0); pxy = (fn * cx * cy).sum(0)
        q = np.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy)
        tau = 0.5 * (tau0 + np.sqrt(tau0 * tau0 + 18 * 1.41421356 * cs * cs * q / rho))
        fo = f - fn / tau
        fo[:, solid] = f[opp][:, solid]                   # bounce-back
        for i in range(9):                                # stream (periodic sides)
            f[i] = np.roll(np.roll(fo[i], c[i, 0], axis=1), c[i, 1], axis=0)
        if t >= start:
            m = np.sqrt(ux * ux + uy * uy); m[solid] = 0
            acc += m; n_acc += 1
        if log and t % 1000 == 0:
            log(t, steps)
    r = acc / max(1, n_acc)
    ref = 0.5 * (r[0].mean() + r[-1].mean())
    r = r / (ref if ref > 0 else u0)
    r[solid] = 0
    if not np.isfinite(r).all():
        raise RuntimeError("Solver became unstable: use a bigger Cell or fewer steps")
    return r, steps

# ------------------------------------------------------------ rhino geometry
def _sections(Geo, z):
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    items = Geo if isinstance(Geo, (list, tuple)) else [Geo]
    pl = rg.Plane(rg.Point3d(0, 0, z), rg.Vector3d.ZAxis)
    crvs = []
    for g in items:
        if g is None:
            continue
        if isinstance(g, rg.Extrusion):
            g = g.ToBrep()
        if isinstance(g, rg.Brep):
            ok, cs, pts = Intersection.BrepPlane(g, pl, 0.001)
            if ok and cs:
                crvs.extend(rg.Curve.JoinCurves(cs, 0.01))
        elif isinstance(g, rg.Mesh):
            pls = Intersection.MeshPlane(g, pl)
            if pls:
                crvs.extend([p.ToNurbsCurve() for p in pls])
    return [c for c in crvs if c and c.IsClosed]

def _rose_curves(rose, centre, radius, north):
    import Rhino.Geometry as rg
    mx = max(r[1] for r in rose) or 1.0
    out = []
    for d, fr, _, _ in rose:
        rr = radius * fr / mx
        pts = [centre]
        for a in (d - 13, d, d + 13):
            t = math.radians(a - north)
            pts.append(centre + rg.Vector3d(math.sin(t) * rr, math.cos(t) * rr, 0))
        pts.append(centre)
        out.append(rg.PolylineCurve(pts))
    return out

def build(Geo, Lat, Lon, Dir, Z, Cell, Up, Down, Steps, North, Run=True):
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    import System
    crvs = _sections(Geo, Z)
    if not crvs:
        raise ValueError("Nothing cut at height Z")
    rose, how = [], "set"
    if Dir is None or Dir < 0:
        try:
            rose = site_rose(Lat, Lon)
        except Exception as e:
            raise ValueError("Could not get wind data for {0}, {1} ({2}); set Dir by hand"
                             .format(Lat, Lon, e))
        Dir = prevailing(rose); how = "auto"
    (xa, ya) = flow_axes(Dir, North)
    X, Y = rg.Vector3d(xa[0], xa[1], 0), rg.Vector3d(ya[0], ya[1], 0)
    # extents in the flow frame
    pts = []
    for c in crvs:
        pts.extend(c.DivideEquidistant(Cell * 0.5) or [])
    xs = [p.X * X.X + p.Y * X.Y for p in pts]; ys = [p.X * Y.X + p.Y * Y.Y for p in pts]
    x0, x1 = min(xs) - Up, max(xs) + Down
    side = side_pad(max(ys) - min(ys), Up)
    y0, y1 = min(ys) - side, max(ys) + side
    nx, ny = int((x1 - x0) / Cell) + 1, int((y1 - y0) / Cell) + 1
    origin = rg.Point3d(0, 0, Z) + X * x0 + Y * y0
    solid = []
    tol = 0.001
    for j in range(ny):
        a = origin + Y * ((j + 0.5) * Cell)
        line = rg.LineCurve(a - X * Cell, a + X * (nx + 1) * Cell)
        cross = []
        for c in crvs:
            ev = Intersection.CurveCurve(line, c, tol, tol)
            if ev:
                for e in ev:
                    cross.append((e.PointA - a) * X / Cell)
        solid.append(fill_row(cross, nx))
    arrow = rg.Line(origin + Y * (ny * Cell / 2) - X * Cell * 15,
                    origin + Y * (ny * Cell / 2))
    rc = _rose_curves(rose, origin + X * (nx * Cell + 15 * Cell) + Y * (ny * Cell / 2),
                      20 * Cell, North) if rose else []
    head = "Site {0:.3f}, {1:.3f} | wind from {2:g} deg ({3}) | ".format(Lat, Lon, Dir, how)
    _LAST.update(dir=Dir, lat=Lat, lon=Lon)
    if not Run:
        return None, [], arrow, rose_text(rose), rc, head + "Run is False ({0} x {1} cells)".format(nx, ny)
    try:
        import numpy  # noqa: F401
    except ImportError:
        return None, [], arrow, rose_text(rose), rc, head + "W001 needs numpy: use Rhino 8 (Python 3)"
    r, steps = lbm_solve(solid, int(Steps or 0))
    mesh = rg.Mesh(); ratios = []
    for j in range(ny):
        for i in range(nx):
            if solid[j][i]:
                continue
            p = origin + X * (i * Cell) + Y * (j * Cell)
            k = mesh.Vertices.Count
            for q in (p, p + X * Cell, p + X * Cell + Y * Cell, p + Y * Cell):
                mesh.Vertices.Add(q)
            mesh.Faces.AddFace(k, k + 1, k + 2, k + 3)
            v = float(r[j, i]); ratios.append(v)
            col = System.Drawing.Color.FromArgb(*ratio_colour(v))
            for _ in range(4):
                mesh.VertexColors.Add(col)
    mesh.Normals.ComputeNormals()
    return mesh, ratios, arrow, rose_text(rose), rc, head + summary(ratios, Cell, nx, ny, steps)

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

_LAST = {}

def wind_legend(bmin, bmax, Dir, Lat, Lon, unit=1.0):
    o, h = legend_place(bmin, bmax, unit)
    title = "Wind speed ratio (local / free wind)\nwind from {0:g} deg  |  {1:.2f}, {2:.2f}".format(Dir, Lat, Lon)
    return legend_layout(0.0, 1.5, ratio_colour, title, o, h, n_seg=15, n_lab=6, fmt="{0:.1f}", top_plus=True)

# ------------------------------------------------------------- entry points
def _gh_value(name):
    v = globals().get(name)
    return DEFAULTS[name] if v is None else v

def run_command():
    import Rhino
    import scriptcontext as sc
    from Rhino.Input.Custom import GetObject, OptionDouble
    key = "W001_wind_screening"
    v = dict(DEFAULTS); v.update(sc.sticky.get(key, {}))
    ft = Rhino.DocObjects.ObjectType
    go = GetObject()
    go.SetCommandPrompt("Select buildings")
    go.GeometryFilter = ft.Mesh | ft.Brep | ft.Extrusion
    names = [("Lat", "Latitude"), ("Lon", "Longitude"), ("Dir", "WindFrom"), ("Z", "HeightMetres"), ("Cell", "CellMetres"),
             ("Up", "UpstreamMetres"), ("Down", "DownstreamMetres"), ("North", "NorthAngle")]
    o = {}
    for k, lab in names:
        o[k] = OptionDouble(float(v[k]))
        go.AddOptionDouble(lab, o[k])
    from Rhino.Input.Custom import OptionToggle
    o_lg = OptionToggle(bool(v.get("Legend", True)), "No", "Yes")
    go.AddOptionToggle("Legend", o_lg)
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
    v["Legend"] = o_lg.CurrentValue
    sc.sticky[key] = v
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        mesh, ratios, arrow, rose, rc, info = build(geo, v["Lat"], v["Lon"], v["Dir"], v["Z"] * f, v["Cell"] * f,
                                          v["Up"] * f, v["Down"] * f, 0, v["North"])
    except (ValueError, RuntimeError) as e:
        print("WindScreen: {0}".format(e)); return
    if mesh is None:
        print(info); return
    idx = sc.doc.Layers.FindByFullPath("W001", -1)
    if idx < 0:
        idx = sc.doc.Layers.Add("W001", Rhino.Display.Color4f.White.AsSystemColor())
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = idx
    a.Name = "Wind from {0:g} deg".format(v["Dir"])
    ids = [sc.doc.Objects.AddMesh(mesh, a), sc.doc.Objects.AddLine(arrow, a)]
    for c in rc:
        ids.append(sc.doc.Objects.AddCurve(c, a))
    if v["Legend"]:
        bb = mesh.GetBoundingBox(True)
        L = wind_legend((bb.Min.X, bb.Min.Y, bb.Min.Z), (bb.Max.X, bb.Max.Y, bb.Max.Z),
                        _LAST.get("dir", v["Dir"]), v["Lat"], v["Lon"], f)
        ids += bake_legend(sc.doc, L, "W001::Legend")
    import System
    gi = sc.doc.Groups.Add(a.Name)
    sc.doc.Groups.AddToGroup(gi, [i for i in ids if i != System.Guid.Empty])
    for line in rose:
        print(line)
    sc.doc.Views.Redraw()
    print(info)

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    if globals().get("Geo") is None:
        mesh, ratio, arrow, rose, rose_crv, info = None, [], None, [], [], "Connect buildings to Geo"
    else:
        mesh, ratio, arrow, rose, rose_crv, info = build(globals().get("Geo"),
            *[_gh_value(k) for k in ("Lat", "Lon", "Dir", "Z", "Cell", "Up", "Down", "Steps", "North", "Run")])
    legend, leg_text, leg_pl, leg_size = [], [], [], []
    if mesh is not None:
        _bb = mesh.GetBoundingBox(True)
        _L = wind_legend((_bb.Min.X, _bb.Min.Y, _bb.Min.Z), (_bb.Max.X, _bb.Max.Y, _bb.Max.Z),
                         _LAST.get("dir", 0.0), _gh_value("Lat"), _gh_value("Lon"))
        legend, leg_text, leg_pl, leg_size = build_legend(_L)
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        print(flow_axes(270))        # wind from west blows to +X: ((1,0),(0,1))
        r = wind_rose(*fetch_wind(51.92, 4.48))
        print("\n".join(rose_text(r)), "\nprevailing", prevailing(r))
        print(fill_row([2.0, 5.0], 8))
