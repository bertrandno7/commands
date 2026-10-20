"""
F002  Sun-responsive grid facade  (more sun -> bigger opening)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: SunFacade).

Divides a facade surface into a W x Hp grid. For every cell it counts the
year's direct sun on that spot (21st of every month, NOAA sun positions, only
sun in front of the facade, blocked by context), then sizes a centred
opening between Min and Max of the cell. Most sun -> Max, least sun -> Min.
Invert = True flips it (bigger openings where there is LESS sun).

GH INPUTS:
    S      : Surface / single-face Brep   facade (normal must point outside;
             use Flip if it points inside)
    Ctx    : Mesh/Brep(s)  shading context, neighbours, the building itself (optional)
    Lat    : float  site latitude  (default 51.92 Rotterdam)
    Lon    : float  site longitude (default 4.48)
    W, Hp  : float  grid cell width / height (default 1.5, 3.0 model units)
    Min    : float  smallest opening, fraction of cell width and height (default 0.25)
    Max    : float  biggest opening (default 0.85)
    Weight : bool   True = hours weighted by how square the sun hits the facade
                    (cos incidence, closer to real solar energy); False = plain hours
    Invert : bool   True = bigger openings where there is less sun (default False)
    Flip   : bool   reverse the facade normal (default False)
    Step   : float  minutes between sun samples (default 30)
    North  : float  degrees, angle of north from +Y toward -X (default 0)

GH OUTPUTS:
    frame    : coloured mesh of the solid facade (colour = sun)
    openings : closed polylines of the openings
    glass    : opening surfaces (Breps)
    sun      : yearly sun hours (or weighted hours) per cell
    ratio    : opening size per cell (fraction of cell)
    info     : summary text

Time zone is not needed: each day is integrated over all 24 h of local solar
time, so any site on Earth works with just Lat/Lon.

RHINO COMMAND / ALIAS:
    Alias  SunFacade  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\F002_sun_openings.py"
    Pick facade surface, then context objects (Enter to skip). Options:
    Latitude, Longitude, CellWidth, CellHeight (metres), MinOpening, MaxOpening,
    Weighted, Invert, FlipNormal. Remembered between runs.
    Bakes to layers F002::Frame and F002::Openings, grouped.
"""
from __future__ import division, print_function
import math

DEFAULTS = dict(Lat=51.92, Lon=4.48, W=1.5, Hp=3.0, Min=0.25, Max=0.85,
                Weight=True, Invert=False, Flip=False, Step=30.0, North=0.0)

# ------------------------------------------- sun maths (copied from A001, self-contained)
def day_of_year(y, m, d):
    days = [31, 28 + (1 if (y % 4 == 0 and y % 100 != 0) or y % 400 == 0 else 0),
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return sum(days[:m - 1]) + d

def sun_position(lat, lon, y, m, d, hour_local, tz):
    """Return (altitude_deg, azimuth_deg from north clockwise). NOAA approx."""
    n = day_of_year(y, m, d)
    g = 2 * math.pi / 365.0 * (n - 1 + (hour_local - 12) / 24.0)
    eot = 229.18 * (0.000075 + 0.001868*math.cos(g) - 0.032077*math.sin(g)
                    - 0.014615*math.cos(2*g) - 0.040849*math.sin(2*g))
    dec = (0.006918 - 0.399912*math.cos(g) + 0.070257*math.sin(g)
           - 0.006758*math.cos(2*g) + 0.000907*math.sin(2*g)
           - 0.002697*math.cos(3*g) + 0.00148*math.sin(3*g))
    tst = hour_local * 60 + eot + 4 * lon - 60 * tz          # true solar minutes
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

def hours_colour(h, hmax):
    """blue -> cyan -> yellow -> red as (r, g, b) 0-255."""
    t = 0.0 if hmax <= 0 else max(0.0, min(1.0, h / hmax))
    stops = [(0.0, (40, 60, 160)), (0.33, (60, 170, 200)),
             (0.66, (245, 210, 60)), (1.0, (215, 50, 40))]
    for (t0, c0), (t1, c1) in zip(stops[:-1], stops[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0)
            return tuple(int(c0[i] + (c1[i] - c0[i]) * u) for i in range(3))
    return stops[-1][1]

# ---------------------------------------------------------------- pure maths
MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

def year_suns(lat, lon, step_min=30.0, north=0.0, year=2026):
    """[(unit vector to sun, hours it represents)] for a whole year:
    21st of each month stands in for every day of that month.
    Local solar time is used (tz = lon/15), so no time zone is needed."""
    if step_min <= 0:
        raise ValueError("Step must be > 0")
    out = []
    n = int(round(24 * 60 / step_min))
    for m in range(1, 13):
        w = step_min / 60.0 * MONTH_DAYS[m - 1]
        for k in range(n):
            h = (k + 0.5) * step_min / 60.0
            alt, az = sun_position(lat, lon, year, m, 21, h, lon / 15.0)
            if alt > 0:
                a, z = math.radians(alt), math.radians(az - north)
                out.append(((math.cos(a) * math.sin(z), math.cos(a) * math.cos(z),
                             math.sin(a)), w))
    return out

def cell_sun(normal, suns, blocked, weighted=True):
    """Sum of sun hours seen by a point with this outward normal.
    blocked(vec) -> True if context hides the sun along vec."""
    tot = 0.0
    for v, w in suns:
        c = normal[0] * v[0] + normal[1] * v[1] + normal[2] * v[2]
        if c <= 1e-6 or blocked(v):
            continue
        tot += w * (c if weighted else 1.0)
    return tot

def opening_ratios(values, mn, mx, invert=False):
    """Linear map facade's least sun -> mn, most sun -> mx (swapped if invert)."""
    if not values:
        return []
    lo, hi = min(values), max(values)
    span = hi - lo
    out = []
    for v in values:
        t = 0.5 if span < 1e-9 else (v - lo) / span
        if invert:
            t = 1.0 - t
        out.append(mn + (mx - mn) * t)
    return out

def bilinear(q, u, v):
    """Point at (u, v) in quad q = [p00, p10, p11, p01]."""
    a, b, c, d = q
    return tuple((1 - u) * (1 - v) * a[i] + u * (1 - v) * b[i] + u * v * c[i]
                 + (1 - u) * v * d[i] for i in range(3))

def opening_quad(q, r):
    """Centred opening corners, r = fraction of cell in both directions."""
    s0, s1 = 0.5 - r / 2.0, 0.5 + r / 2.0
    return [bilinear(q, s0, s0), bilinear(q, s1, s0), bilinear(q, s1, s1), bilinear(q, s0, s1)]

def frame_faces(base):
    """Four quads between outer [0..3] and inner [4..7] vertices (offset base)."""
    f = []
    for i in range(4):
        j = (i + 1) % 4
        f.append((base + i, base + j, base + 4 + j, base + 4 + i))
    return f

def grid_counts(len_u, len_v, W, Hp):
    if W <= 0 or Hp <= 0:
        raise ValueError("W and Hp must be > 0")
    return max(1, int(round(len_u / W))), max(1, int(round(len_v / Hp)))

def summary(sun, ratios, weighted, n_suns):
    if not sun:
        return "No cells"
    unit = "weighted sun h/yr" if weighted else "sun h/yr"
    return ("Cells: {0} | {1}: min {2:.0f} / mean {3:.0f} / max {4:.0f} | "
            "opening {5:.0%}-{6:.0%} of cell, mean open area {7:.0%} | {8} sun samples").format(
                len(sun), unit, min(sun), sum(sun) / len(sun), max(sun),
                min(ratios), max(ratios), sum(r * r for r in ratios) / len(ratios), n_suns)

# ------------------------------------------------------------ rhino geometry
def _face(S):
    import Rhino.Geometry as rg
    if isinstance(S, rg.BrepFace):
        return S
    if isinstance(S, rg.Brep):
        return S.Faces[0]
    if isinstance(S, rg.Surface):
        return S
    raise ValueError("S must be a surface or single-face brep")

def _context_mesh(items):
    import Rhino.Geometry as rg
    out = rg.Mesh()
    mp = rg.MeshingParameters.FastRenderMesh
    for g in items or []:
        if isinstance(g, rg.Mesh):
            out.Append(g)
        elif isinstance(g, rg.Brep):
            for m in rg.Mesh.CreateFromBrep(g, mp) or []:
                out.Append(m)
        elif isinstance(g, rg.Extrusion):
            for m in rg.Mesh.CreateFromBrep(g.ToBrep(), mp) or []:
                out.Append(m)
    return out if out.Faces.Count else None

def build(S, Ctx, Lat, Lon, W, Hp, Min, Max, Weight, Invert, Flip, Step, North):
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    import System
    if not (0 < Min <= Max < 1):
        raise ValueError("Need 0 < Min <= Max < 1")
    srf = _face(S)
    du, dv = srf.Domain(0), srf.Domain(1)
    nu, nv = grid_counts(srf.IsoCurve(0, dv.Mid).GetLength(),
                         srf.IsoCurve(1, du.Mid).GetLength(), W, Hp)
    P = [[srf.PointAt(du.ParameterAt(i / nu), dv.ParameterAt(j / nv))
          for j in range(nv + 1)] for i in range(nu + 1)]
    ctx = _context_mesh(Ctx if isinstance(Ctx, (list, tuple)) else ([Ctx] if Ctx else []))
    suns = year_suns(Lat, Lon, Step, North)
    sgn = -1.0 if Flip else 1.0
    if isinstance(srf, rg.BrepFace) and srf.OrientationIsReversed:
        sgn = -sgn
    eps = 0.01 * min(W, Hp)
    cells, sun = [], []
    for i in range(nu):
        for j in range(nv):
            q = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]]
            uc = du.ParameterAt((i + 0.5) / nu); vc = dv.ParameterAt((j + 0.5) / nv)
            n = srf.NormalAt(uc, vc) * sgn
            n.Unitize()
            p = srf.PointAt(uc, vc) + n * eps

            def blocked(v, p=p):
                if ctx is None:
                    return False
                return Intersection.MeshRay(ctx, rg.Ray3d(p, rg.Vector3d(*v))) >= 0
            sun.append(cell_sun((n.X, n.Y, n.Z), suns, blocked, bool(Weight)))
            cells.append([(c.X, c.Y, c.Z) for c in q])
    ratios = opening_ratios(sun, Min, Max, bool(Invert))
    colour = hours_colour
    hmax = max(sun) if sun else 1.0
    frame = rg.Mesh()
    openings, glass = [], []
    for q, r, h in zip(cells, ratios, sun):
        inner = opening_quad(q, r)
        base = frame.Vertices.Count
        for p in q + inner:
            frame.Vertices.Add(p[0], p[1], p[2])
        col = System.Drawing.Color.FromArgb(*colour(h, hmax))
        for _ in range(8):
            frame.VertexColors.Add(col)
        for f in frame_faces(base):
            frame.Faces.AddFace(*f)
        pts = [rg.Point3d(*p) for p in inner]
        openings.append(rg.PolylineCurve(pts + [pts[0]]))
        b = rg.Brep.CreateFromCornerPoints(pts[0], pts[1], pts[2], pts[3], 0.001)
        if b:
            glass.append(b)
    frame.Normals.ComputeNormals(); frame.Compact()
    return frame, openings, glass, sun, ratios, summary(sun, ratios, bool(Weight), len(suns))

# ------------------------------------------------------------- entry points
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
    from Rhino.Input.Custom import GetObject, OptionDouble, OptionToggle
    key = "F002_sun_openings"
    v = dict(DEFAULTS); v.update(sc.sticky.get(key, {}))
    doubles = [("Lat", "Latitude"), ("Lon", "Longitude"), ("W", "CellWidth"),
               ("Hp", "CellHeight"), ("Min", "MinOpening"), ("Max", "MaxOpening")]
    toggles = [("Weight", "Weighted"), ("Invert", "Invert"), ("Flip", "FlipNormal")]
    go = GetObject()
    go.SetCommandPrompt("Select facade surface")
    go.GeometryFilter = Rhino.DocObjects.ObjectType.Surface
    go.SubObjectSelect = True
    od, ot = {}, {}
    for k, lab in doubles:
        od[k] = OptionDouble(float(v[k])); go.AddOptionDouble(lab, od[k])
    for k, lab in toggles:
        ot[k] = OptionToggle(bool(v[k]), "No", "Yes"); go.AddOptionToggle(lab, ot[k])
    while True:
        res = go.Get()
        if res == Rhino.Input.GetResult.Option:
            continue
        if res != Rhino.Input.GetResult.Object:
            return
        break
    face = go.Object(0).Face()
    for k, _ in doubles:
        v[k] = od[k].CurrentValue
    for k, _ in toggles:
        v[k] = ot[k].CurrentValue
    sc.sticky[key] = v
    ids = rs.GetObjects("Select shading context (Enter for none)",
                        rs.filter.surface | rs.filter.polysurface | rs.filter.mesh | rs.filter.extrusion) or []
    ctx = [rs.coercegeometry(i) for i in ids]
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        frame, openings, glass, sun, ratios, info = build(
            face, ctx, v["Lat"], v["Lon"], v["W"] * f, v["Hp"] * f, v["Min"], v["Max"],
            v["Weight"], v["Invert"], v["Flip"], v["Step"], v["North"])
    except ValueError as e:
        print("SunFacade: {0}".format(e)); return
    _layer(sc.doc, "F002", (120, 120, 120))
    lf = _layer(sc.doc, "Frame", (200, 200, 200), "F002")
    lo = _layer(sc.doc, "Openings", (60, 140, 220), "F002")
    rs.EnableRedraw(False)
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = lf
    out = [sc.doc.Objects.AddMesh(frame, a)]
    b = Rhino.DocObjects.ObjectAttributes(); b.LayerIndex = lo
    for c in openings:
        out.append(sc.doc.Objects.AddCurve(c, b))
    grp = rs.AddGroup(); rs.AddObjectsToGroup([i for i in out if i], grp)
    rs.EnableRedraw(True); sc.doc.Views.Redraw()
    print(info)

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    if globals().get("S") is None:
        frame, openings, glass, sun, ratio, info = None, [], [], [], [], "Connect a facade surface to S"
    else:
        frame, openings, glass, sun, ratio, info = build(
            S, globals().get("Ctx"),  # noqa: F821
            *[_gh_value(k) for k in ("Lat", "Lon", "W", "Hp", "Min", "Max",
                                      "Weight", "Invert", "Flip", "Step", "North")])
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:                     # plain Python: maths self-test
        s = year_suns(51.92, 4.48, 30.0)
        print("Rotterdam sun hours/yr above horizon:", round(sum(w for _, w in s)))
        for name, n in (("south", (0, -1, 0)), ("west", (-1, 0, 0)),
                        ("east", (1, 0, 0)), ("north", (0, 1, 0))):
            print(name, round(cell_sun(n, s, lambda v: False, False)),
                  round(cell_sun(n, s, lambda v: False, True)))
        print(opening_ratios([0, 50, 100], 0.25, 0.85))
        print(opening_quad([(0, 0, 0), (2, 0, 0), (2, 0, 3), (0, 0, 3)], 0.5))
