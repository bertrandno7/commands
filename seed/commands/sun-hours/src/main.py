"""
A001  Sun Hours Analysis  (direct sun hours on a mesh/surface, with shading)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: SunHours).

Computes sun positions (NOAA solar equations, no plugins), then counts for each
mesh face how many hours of direct sun it gets on one day, blocked by context
geometry and by the analysis geometry itself. Faces are coloured blue (0 h) ->
yellow -> red (max hours).

GH INPUTS:
    Geo    : Mesh/Brep(s)  geometry to analyse (breps become a neat quad grid of Grid-size cells per face)
    Ctx    : Mesh/Brep(s)  shading context (optional)
    Lat    : float  latitude   (default 51.92  Rotterdam)
    Lon    : float  longitude  (default 4.48)
    Month  : int    (default 3)       Day : int (default 21)
    H0, H1 : float  start / end local clock hour (default 0, 24 = whole day)
    Step   : float  minutes between sun samples (default 30)
    Grid   : float  max mesh face size for breps, model units (default 1.0)
    North  : float  degrees, angle of north measured from +Y toward -X (default 0)
    TZ     : float  UTC offset hours; leave empty = CET with EU summer time

GH OUTPUTS:
    mesh   : coloured analysis mesh
    hours  : sun hours per face
    sun    : list of sun vectors (pointing TO the sun) above horizon
    info   : summary text
    path   : sun-path diagram (compass ring + ticks, 21st Dec..Jun arcs, hour analemmas,
             analysed day, sun spheres) - add this output to see it
    text, text_pl : labels + planes (wire into a Text Tag 3D)
  extra inputs: SunPath (bool, default True), PathR (diagram radius, 0 = auto)
    legend, leg_text, leg_pl, leg_size : Ladybug-style legend (colour bar mesh + outline;
             wire leg_text / leg_pl / leg_size into a Text Tag 3D: Text, Location, Size)
  extra inputs: LegMin, LegMax (legend domain in hours; empty = 0 .. max, fix them to
             compare options on the same colour scale)

RHINO COMMAND / ALIAS:
    Alias  SunHours  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\A001_sun_hours.py"
    Pick objects to analyse, then (optionally) context objects; Enter to run.
    Command-line options: Latitude, Longitude, Month, Day, StartHour, EndHour,
    StepMinutes, GridMetres, NorthAngle, TimeZone (AutoCET / Manual) + UtcOffset,
    SunPath (Yes/No) + PathRadius (metres, 0 = auto): bakes a typical sun-path diagram
    (compass N/E/S/W + degree ticks, 21st month arcs, clock-hour analemmas in standard time,
    analysed day in magenta with sun spheres) on layers A001::SunPath::*, grouped.
    Legend (Yes/No) + LegendMin / LegendMax (hours, -1 = auto): bakes a Ladybug-style
    legend (gradient bar, values, title with date + location) on A001::Legend, grouped
    with the mesh. Grid is in METRES; options are remembered. Bakes a coloured mesh to layer A001.
"""
from __future__ import division, print_function
import math

DEFAULTS = dict(Lat=51.92, Lon=4.48, Month=3, Day=21, H0=0.0, H1=24.0,
                Step=30.0, Grid=1.0, North=0.0, TZ=None,
                SunPath=True, PathR=0.0, LegMin=None, LegMax=None)

# ---------------------------------------------------------------- pure math
def day_of_year(y, m, d):
    days = [31, 28 + (1 if (y % 4 == 0 and y % 100 != 0) or y % 400 == 0 else 0),
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return sum(days[:m - 1]) + d

def _weekday(y, m, d):
    """0 = Monday ... 6 = Sunday (Zeller-free, Sakamoto)."""
    t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
    yy = y - 1 if m < 3 else y
    return (yy + yy // 4 - yy // 100 + yy // 400 + t[m - 1] + d + 6) % 7

def _last_sunday(y, m):
    d = 31
    while _weekday(y, m, d) != 6:
        d -= 1
    return d

def eu_offset(y, m, d):
    """Central European offset: +2 between last Sunday of March and last
    Sunday of October (switch times ignored), otherwise +1."""
    a, b = (3, _last_sunday(y, 3)), (10, _last_sunday(y, 10))
    return 2.0 if a <= (m, d) < b else 1.0

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

def sun_vectors(lat, lon, y, m, d, h0=0.0, h1=24.0, step_min=30.0, tz=None, north=0.0):
    """Unit vectors toward the sun (x east, y north, z up, rotated by north)
    for samples above the horizon. Each sample represents step_min minutes."""
    if tz is None:
        tz = eu_offset(y, m, d)
    if step_min <= 0:
        raise ValueError("Step must be > 0")
    out = []
    k = 0
    while True:
        h = h0 + (k + 0.5) * step_min / 60.0                 # mid-interval
        if h > h1:
            break
        alt, az = sun_position(lat, lon, y, m, d, h, tz)
        if alt > 0:
            a, z = math.radians(alt), math.radians(az - north)
            out.append((math.cos(a)*math.sin(z), math.cos(a)*math.cos(z), math.sin(a)))
        k += 1
    return out

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

def summary(hours, n_sun, step_min):
    if not hours:
        return "No faces"
    return ("Faces: {0} | Sun samples: {1} ({2:.1f} h of daylight) | "
            "Sun hours min {3:.1f} / mean {4:.1f} / max {5:.1f}".format(
                len(hours), n_sun, n_sun * step_min / 60.0,
                min(hours), sum(hours) / len(hours), max(hours)))

# ------------------------------------------------------------ sun-path diagram (pure maths)
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def _sky_pt(alt, az, north, r):
    a, z = math.radians(alt), math.radians(az - north)
    return (r * math.cos(a) * math.sin(z), r * math.cos(a) * math.cos(z), r * math.sin(a))

def sunpath_data(lat, lon, year, month, day, tz=None, north=0.0, r=1.0, step_min=30.0, h0=0.0, h1=24.0):
    """Plain-data typical 3D sun-path diagram around the origin, radius r (x east, y north, z up).
    Returns dict of lists:
      ring      : [polyline]  compass circles (r and 1.04 r) on the ground
      ticks     : [polyline]  5 deg ticks (longer every 15, longest every 90)
      labels    : [(text, (x, y, z), height)]  N/E/S/W + degree numbers + month/hour tags
      months    : [(name, polyline)]  21st Dec..Jun day arcs (Jul-Nov overlap them)
      analemma  : [(hour, [polyline, ...])]  clock-hour figure-8s (standard time, no DST)
      day       : polyline   the analysed day
      suns      : [(x, y, z)] sun positions for the analysed day at Step samples
    """
    TWO = 2 * math.pi
    std = 1.0 if tz is None else tz                     # analemmas in standard time
    dtz = eu_offset(year, month, day) if tz is None else tz
    out = dict(ring=[], ticks=[], labels=[], months=[], analemma=[], day=[], suns=[])
    for rr in (r, 1.04 * r):
        out["ring"].append([(rr * math.sin(TWO * i / 144), rr * math.cos(TWO * i / 144), 0.0) for i in range(145)])
    for a in range(0, 360, 5):
        ln = 0.10 if a % 90 == 0 else (0.06 if a % 15 == 0 else 0.03)
        z = math.radians(a - north)
        out["ticks"].append([(r * (1.04 - ln) * math.sin(z), r * (1.04 - ln) * math.cos(z), 0.0),
                             (r * 1.04 * math.sin(z), r * 1.04 * math.cos(z), 0.0)])
        if a % 30 == 0 and a % 90 != 0:
            out["labels"].append((str(a), (r * 1.10 * math.sin(z), r * 1.10 * math.cos(z), 0.0), 0.035 * r))
    for a, t in ((0, "N"), (90, "E"), (180, "S"), (270, "W")):
        z = math.radians(a - north)
        out["labels"].append((t, (r * 1.16 * math.sin(z), r * 1.16 * math.cos(z), 0.0), 0.08 * r))

    def arc(m, d, tzh, step):
        pts, k = [], 0
        while k * step <= 24 * 60:
            alt, az = sun_position(lat, lon, year, m, d, k * step / 60.0, tzh)
            if alt >= 0:
                pts.append((alt, az))
            elif pts and pts[-1] is not None:
                pts.append(None)
            k += 1
        segs, cur = [], []
        for q in pts:
            if q is None:
                if len(cur) > 1:
                    segs.append(cur)
                cur = []
            else:
                cur.append(_sky_pt(q[0], q[1], north, r))
        if len(cur) > 1:
            segs.append(cur)
        return max(segs, key=len) if segs else []
    for m in (12, 1, 2, 3, 4, 5, 6):
        pl = arc(m, 21, std, 5.0)
        if pl:
            out["months"].append((MONTH_NAMES[m - 1], pl))
            out["labels"].append(("21 " + MONTH_NAMES[m - 1], pl[len(pl) // 2], 0.03 * r))
    for h in range(24):
        segs, cur = [], []
        for n in range(0, 366, 3):
            mm, dd = _md(year, n)
            alt, az = sun_position(lat, lon, year, mm, dd, float(h), std)
            if alt > 0:
                cur.append(_sky_pt(alt, az, north, r))
            elif len(cur) > 1:
                segs.append(cur); cur = []
            else:
                cur = []
        if len(cur) > 1:
            segs.append(cur)
        if segs:
            if len(segs) == 1 and len(segs[0]) > 100:     # full year above horizon: close the loop
                segs[0].append(segs[0][0])
            out["analemma"].append((h, segs))
            top = max((p for sg in segs for p in sg), key=lambda p: p[2])
            out["labels"].append(("%d:00" % h, (top[0], top[1], top[2] + 0.03 * r), 0.03 * r))
    out["day"] = arc(month, day, dtz, 5.0)
    for v in sun_vectors(lat, lon, year, month, day, h0, h1, step_min, tz, north):
        out["suns"].append((v[0] * r, v[1] * r, v[2] * r))
    return out

def _md(year, n):
    """day index 0..365 -> (month, day), clamped to the year."""
    days = [31, 28 + (1 if (year % 4 == 0 and year % 100 != 0) or year % 400 == 0 else 0),
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    n = min(n, sum(days) - 1)
    for m, dm in enumerate(days):
        if n < dm:
            return m + 1, n + 1
        n -= dm
    return 12, 31

def build_sunpath(centre, r, Lat, Lon, Month, Day, TZ, North, Step, H0=0.0, H1=24.0, year=2026):
    """Rhino geometry of the diagram: dict of curve lists + text items (text, plane, height)
    + sun spheres, all at centre (Point3d), radius r in model units."""
    import Rhino.Geometry as rg
    D = sunpath_data(Lat, Lon, year, int(Month), int(Day), TZ, North, r, Step, H0, H1)
    c = rg.Vector3d(centre)
    def crv(pl):
        return rg.PolylineCurve([rg.Point3d(x, y, z) + c for x, y, z in pl])
    G = dict(compass=[crv(p) for p in D["ring"] + D["ticks"]],
             months=[crv(p) for _, p in D["months"]],
             analemma=[crv(p) for _, segs in D["analemma"] for p in segs],
             day=[crv(D["day"])] if len(D["day"]) > 1 else [],
             suns=[rg.Sphere(rg.Point3d(x, y, z) + c, 0.018 * r).ToBrep() for x, y, z in D["suns"]],
             text=[])
    for t, (x, y, z), h in D["labels"]:
        pl = rg.Plane(rg.Point3d(x, y, z) + c, rg.Vector3d.ZAxis) if z == 0 else \
            rg.Plane(rg.Point3d(x, y, z) + c, rg.Vector3d(x, y, 0), rg.Vector3d.ZAxis) if (x or y) else \
            rg.Plane(rg.Point3d(x, y, z) + c, rg.Vector3d.ZAxis)
        if z != 0 and (x or y):                         # sky labels stand up, facing outward
            pl = rg.Plane(rg.Point3d(x, y, z) + c, rg.Vector3d(-y, x, 0), rg.Vector3d.ZAxis)
        G["text"].append((t, pl, h))
    return G

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

def build(Geo, Ctx, Lat, Lon, Month, Day, H0, H1, Step, Grid, North, TZ,
          year=2026, offset=0.01, leg_lo=None, leg_hi=None):
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    import System
    targets = _to_meshes(Geo, Grid, neat=True)
    if not targets:
        raise ValueError("Nothing to analyse")
    block = rg.Mesh()
    for m in targets + _to_meshes(Ctx, Grid):
        block.Append(m)
    block.FaceNormals.ComputeFaceNormals()
    vecs = [rg.Vector3d(*v) for v in sun_vectors(Lat, Lon, year, int(Month), int(Day),
                                                 H0, H1, Step, TZ, North)]
    dt = Step / 60.0
    mesh = rg.Mesh()
    for m in targets:                       # quads kept: neat grid cells stay one face each
        m.FaceNormals.ComputeFaceNormals()
        mesh.Append(m)
    mesh.FaceNormals.ComputeFaceNormals()
    hours = []
    for i in range(mesh.Faces.Count):
        c = mesh.Faces.GetFaceCenter(i)
        n = rg.Vector3d(mesh.FaceNormals[i])
        p = c + n * offset
        h = 0.0
        for v in vecs:
            if n * v <= 0:
                continue
            if Intersection.MeshRay(block, rg.Ray3d(p, v)) < 0:
                h += dt
        hours.append(h)
    # unweld so each face carries its own colour
    out = rg.Mesh()
    lo, hi = value_range(hours, leg_lo, leg_hi, zero=True)
    for i in range(mesh.Faces.Count):
        f = mesh.Faces[i]
        a = out.Vertices.Count
        ids = (f.A, f.B, f.C, f.D) if f.IsQuad else (f.A, f.B, f.C)
        for idx in ids:
            out.Vertices.Add(mesh.Vertices[idx])
        if f.IsQuad:
            out.Faces.AddFace(a, a + 1, a + 2, a + 3)
        else:
            out.Faces.AddFace(a, a + 1, a + 2)
        r, g, b = hours_colour(hours[i] - lo, hi - lo)
        col = System.Drawing.Color.FromArgb(r, g, b)
        for _ in ids:
            out.VertexColors.Add(col)
    out.Normals.ComputeNormals()
    try:                                    # scoreboard metrics (E001): area-weighted, m2
        import scriptcontext as sc
        import Rhino
        u = Rhino.RhinoMath.UnitScale(sc.doc.ModelUnitSystem, Rhino.UnitSystem.Meters) if sc.doc else 1.0
        ar = []
        for i in range(mesh.Faces.Count):
            f = mesh.Faces[i]
            a, b, c = mesh.Vertices[f.A], mesh.Vertices[f.B], mesh.Vertices[f.C]
            x = 0.5 * rg.Vector3d.CrossProduct(rg.Vector3d(b - a), rg.Vector3d(c - a)).Length
            if f.IsQuad:
                d = mesh.Vertices[f.D]
                x += 0.5 * rg.Vector3d.CrossProduct(rg.Vector3d(c - a), rg.Vector3d(d - a)).Length
            ar.append(x * u * u)
        tot = sum(ar) or 1.0
        sc.sticky["A001_metrics"] = dict(
            mean_hours=sum(h * a for h, a in zip(hours, ar)) / tot, area=tot,
            share_2h=sum(a for h, a in zip(hours, ar) if h >= 2.0) / tot,
            share_3h=sum(a for h, a in zip(hours, ar) if h >= 3.0) / tot,
            month=int(Month), day=int(Day), lat=Lat, lon=Lon)
    except Exception:
        pass
    return out, hours, vecs, summary(hours, len(vecs), Step)

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

def sun_legend(hours, bmin, bmax, Lat, Lon, Month, Day, leg_lo=None, leg_hi=None, unit=1.0, x_from=None):
    lo, hi = value_range(hours, leg_lo, leg_hi, zero=True)
    o, h = legend_place(bmin, bmax, unit, x_from=x_from)
    title = "Sun hours (h)\n{0} {1}  |  {2:.2f}, {3:.2f}".format(int(Day), MONTH_NAMES[int(Month) - 1], Lat, Lon)
    return legend_layout(lo, hi, lambda x: hours_colour(x - lo, hi - lo), title, o, h, n_seg=10,
                         n_lab=6, fmt="{0:.1f}", top_plus=bool(hours) and max(hours) > hi + 1e-9)

# ------------------------------------------------------------- entry points
def _gh_value(name):
    v = globals().get(name)
    return DEFAULTS[name] if v is None else v

SUNPATH_LAYERS = [("Compass", (90, 90, 90)), ("MonthArcs", (255, 120, 0)), ("Analemma", (255, 190, 0)),
                  ("AnalysedDay", (230, 0, 126)), ("Sun", (255, 120, 0)), ("Text", (60, 60, 60))]

def path_centre_radius(geo, PathR, f=1.0):
    """Diagram centre = middle of the geometry's bounding box at its base; radius PathR metres,
    0 = auto (0.75 x plan diagonal, at least 20 m)."""
    import Rhino.Geometry as rg
    bb = rg.BoundingBox.Empty
    for g in geo:
        bb.Union(g.GetBoundingBox(True))
    c = rg.Point3d(bb.Center.X, bb.Center.Y, bb.Min.Z)
    r = PathR * f if PathR > 0 else max(20.0 * f, 0.75 * bb.Min.DistanceTo(rg.Point3d(bb.Max.X, bb.Max.Y, bb.Min.Z)))
    return c, r

def bake_sunpath(doc, geo, v, f):
    import Rhino, System
    c, r = path_centre_radius(geo, v.get("PathR", 0.0), f)
    G = build_sunpath(c, r, v["Lat"], v["Lon"], v["Month"], v["Day"], v["TZ"], v["North"], v["Step"], v["H0"], v["H1"])
    par = doc.Layers.FindByFullPath("A001", -1)
    if par < 0:
        par = doc.Layers.Add("A001", System.Drawing.Color.White)
    sp = doc.Layers.FindByFullPath("A001::SunPath", -1)
    if sp < 0:
        L = Rhino.DocObjects.Layer(); L.Name = "SunPath"; L.ParentLayerId = doc.Layers[par].Id
        sp = doc.Layers.Add(L)
    lid = {}
    for nm, rgb in SUNPATH_LAYERS:
        i = doc.Layers.FindByFullPath("A001::SunPath::" + nm, -1)
        if i < 0:
            L = Rhino.DocObjects.Layer(); L.Name = nm; L.ParentLayerId = doc.Layers[sp].Id
            L.Color = System.Drawing.Color.FromArgb(*rgb)
            i = doc.Layers.Add(L)
        lid[nm] = i
    ids = []
    def att(nm):
        a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = lid[nm]; return a
    for key, nm in (("compass", "Compass"), ("months", "MonthArcs"), ("analemma", "Analemma"), ("day", "AnalysedDay")):
        for cv in G[key]:
            ids.append(doc.Objects.AddCurve(cv, att(nm)))
    for b in G["suns"]:
        ids.append(doc.Objects.AddBrep(b, att("Sun")))
    for t, pl, h in G["text"]:
        te = Rhino.Geometry.TextEntity.Create(t, pl, doc.DimStyles.Current, False, 0, 0)
        te.TextHeight = h
        te.Justification = Rhino.Geometry.TextJustification.MiddleCenter
        ids.append(doc.Objects.AddText(te, att("Text")))
    gi = doc.Groups.Add("A001 SunPath {0}-{1}".format(int(v["Month"]), int(v["Day"])))
    doc.Groups.AddToGroup(gi, [i for i in ids if i != System.Guid.Empty])

def run_command():
    import Rhino
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    from Rhino.Input.Custom import GetObject, OptionDouble, OptionInteger, OptionToggle
    key = "A001_sun_hours"
    v = dict(DEFAULTS)
    v.update(sc.sticky.get(key, {}))
    ft = Rhino.DocObjects.ObjectType
    go = GetObject()
    go.SetCommandPrompt("Select objects to analyse")
    go.GeometryFilter = ft.Mesh | ft.Brep | ft.Surface | ft.Extrusion
    o = {}
    for k in ("Lat", "Lon", "H0", "H1", "Step", "Grid", "North"):
        o[k] = OptionDouble(float(v[k]))
    o["Month"] = OptionInteger(int(v["Month"]), 1, 12)
    o["Day"] = OptionInteger(int(v["Day"]), 1, 31)
    names = [("Lat", "Latitude"), ("Lon", "Longitude"), ("Month", "Month"),
             ("Day", "Day"), ("H0", "StartHour"), ("H1", "EndHour"),
             ("Step", "StepMinutes"), ("Grid", "GridMetres"), ("North", "NorthAngle")]
    for k, lab in names:
        if k in ("Month", "Day"):
            go.AddOptionInteger(lab, o[k])
        else:
            go.AddOptionDouble(lab, o[k])
    # time zone: Auto = Central European time with summer time (NL/BE/DE/FR...)
    o_auto = OptionToggle(v["TZ"] is None, "Manual", "AutoCET")
    o_tz = OptionDouble(float(v["TZ"]) if v["TZ"] is not None else 1.0, -12.0, 14.0)
    go.AddOptionToggle("TimeZone", o_auto)
    go.AddOptionDouble("UtcOffset", o_tz)
    o_sp = OptionToggle(bool(v.get("SunPath", True)), "No", "Yes")
    o_pr = OptionDouble(float(v.get("PathR", 0.0)), 0.0, 100000.0)
    go.AddOptionToggle("SunPath", o_sp)
    go.AddOptionDouble("PathRadius", o_pr)
    o_lg = OptionToggle(bool(v.get("Legend", True)), "No", "Yes")
    o_l0 = OptionDouble(-1.0 if v.get("LegMin") is None else float(v["LegMin"]), -1.0, 100000.0)
    o_l1 = OptionDouble(-1.0 if v.get("LegMax") is None else float(v["LegMax"]), -1.0, 100000.0)
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
    v["TZ"] = None if o_auto.CurrentValue else o_tz.CurrentValue
    v["SunPath"] = o_sp.CurrentValue; v["PathR"] = o_pr.CurrentValue
    v["Legend"] = o_lg.CurrentValue
    v["LegMin"] = None if o_l0.CurrentValue < 0 else o_l0.CurrentValue
    v["LegMax"] = None if o_l1.CurrentValue < 0 else o_l1.CurrentValue
    sc.sticky[key] = v
    ctx = []
    ids = rs.GetObjects("Select shading context (Enter for none)",
                        rs.filter.mesh | rs.filter.polysurface | rs.filter.surface |
                        rs.filter.extrusion, preselect=False)
    if ids:
        ctx = [rs.coercegeometry(i) for i in ids]
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        mesh, hours, vecs, info = build(geo, ctx, v["Lat"], v["Lon"], v["Month"], v["Day"],
                                        v["H0"], v["H1"], v["Step"], v["Grid"] * f,
                                        v["North"], v["TZ"], offset=0.01 * f,
                                        leg_lo=v["LegMin"], leg_hi=v["LegMax"])
    except ValueError as e:
        print("SunHours: {0}".format(e))
        return
    idx = sc.doc.Layers.FindByFullPath("A001", -1)
    if idx < 0:
        idx = sc.doc.Layers.Add("A001", Rhino.Display.Color4f.White.AsSystemColor())
    a = Rhino.DocObjects.ObjectAttributes()
    a.LayerIndex = idx
    a.Name = "SunHours {0}-{1}".format(int(v["Month"]), int(v["Day"]))
    ids = [sc.doc.Objects.AddMesh(mesh, a)]
    if v["SunPath"]:
        bake_sunpath(sc.doc, geo, v, f)
    if v["Legend"]:
        bb = mesh.GetBoundingBox(True)
        xf = None
        if v["SunPath"]:
            c, r = path_centre_radius(geo, v.get("PathR", 0.0), f)
            xf = c.X + r
        L = sun_legend(hours, (bb.Min.X, bb.Min.Y, bb.Min.Z), (bb.Max.X, bb.Max.Y, bb.Max.Z),
                       v["Lat"], v["Lon"], v["Month"], v["Day"], v["LegMin"], v["LegMax"], f, xf)
        ids += bake_legend(sc.doc, L, "A001::Legend")
    gi = sc.doc.Groups.Add(a.Name)
    sc.doc.Groups.AddToGroup(gi, [i for i in ids if i != __import__("System").Guid.Empty])
    sc.doc.Views.Redraw()
    print(info)

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    path, text, text_pl = [], [], []
    legend, leg_text, leg_pl, leg_size = [], [], [], []
    if globals().get("Geo") is None:
        mesh, hours, sun, info = None, [], [], "Connect geometry to Geo"
    else:
        mesh, hours, sun, info = build(
            globals().get("Geo"), globals().get("Ctx"),
            *[_gh_value(k) for k in ("Lat", "Lon", "Month", "Day", "H0", "H1",
                                     "Step", "Grid", "North", "TZ")],
            leg_lo=globals().get("LegMin"), leg_hi=globals().get("LegMax"))
        _xf = None
        if _gh_value("SunPath"):
            _g = globals().get("Geo")
            _g = _g if isinstance(_g, (list, tuple)) else [_g]
            _c, _r = path_centre_radius([x for x in _g if x is not None], _gh_value("PathR"))
            _G = build_sunpath(_c, _r, *[_gh_value(k) for k in ("Lat", "Lon", "Month", "Day", "TZ", "North", "Step", "H0", "H1")])
            path = _G["compass"] + _G["months"] + _G["analemma"] + _G["day"] + _G["suns"]
            text = [t for t, _, _ in _G["text"]]
            text_pl = [p for _, p, _ in _G["text"]]
            _xf = _c.X + _r
        _bb = mesh.GetBoundingBox(True)
        _L = sun_legend(hours, (_bb.Min.X, _bb.Min.Y, _bb.Min.Z), (_bb.Max.X, _bb.Max.Y, _bb.Max.Z),
                        *[_gh_value(k) for k in ("Lat", "Lon", "Month", "Day")],
                        leg_lo=globals().get("LegMin"), leg_hi=globals().get("LegMax"), x_from=_xf)
        legend, leg_text, leg_pl, leg_size = build_legend(_L)
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        for md in [(3, 21), (6, 21), (12, 21)]:
            v = sun_vectors(51.92, 4.48, 2026, md[0], md[1], step_min=10)
            noon = max(sun_position(51.92, 4.48, 2026, md[0], md[1], h / 60.0, eu_offset(2026, *md))[0]
                       for h in range(0, 1440, 5))
            print(md, "TZ", eu_offset(2026, *md), "daylight h", round(len(v) / 6.0, 2),
                  "max alt", round(noon, 1))
