"""
M005  Sun carve  (cut the massing so it gets MORE sun on its own skin)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: SunCarve).

Greedy search over planar cuts. Each round it tries, for every mass, cut planes
facing 8 directions (N, NE ... NW) at a few slopes and depths, measures the
year-round direct sun on the carved massing (self-shading + optional context),
and keeps the cut that adds the most sun per share of volume lost. It stops at
MaxCuts, when the volume budget MaxLoss is used, or when no cut pays back.

Why the default is Sunlit and not Total: the direct sun an opaque mass catches
equals the beam times its silhouette seen from the sun, so cutting can never
raise the TOTAL (only shift it). What a cut can do is move sun from roofs and
over-lit corners onto facades that sit in their own shadow. So by default the
score is the facade area (walls and sloped faces, not flat roofs) that gets at
least MinSun hours of direct sun on Month/Day (default 21 Feb, 3 h: close to the
Dutch TNO 19 Feb rule of thumb). Faces looking down are ignored.
Total / PerArea / PerVolume use year-round sun instead: area x cos(incidence) x
hours in sun on the 21st of every month, scaled to a year ("sun m2-hours").

Cuts only remove material from above a plane tilted UP toward its direction, so
they never create floating slabs or overhangs. Stepped = terraces: the same cut
but made as vertical steps at every floor, so floors stay flat.

Neighbours: the context facades near the masses are scored too, and their gain
counts with weight Neighbours (default 1 = a sunlit m2 next door is worth the
same as one of ours; 0 = selfish; 2 = good neighbour). Cuts only ever remove
mass, so neighbours can never get worse; the weight decides how much the search
favours cuts that give THEM sun back. Used by Sunlit and Total.

Objective:
    Sunlit    : facade m2 with >= MinSun hours on Month/Day (default)
    Total     : more sun on the whole skin (honest: a lone box rarely gains;
                it pays off where one part shades another, or with context)
    PerArea   : more sun per m2 of skin (cuts that tilt faces to the sun)
    PerVolume : more sun per m3 kept (compact sunny forms)

GH INPUTS:
    Mass      : closed Brep(s) / Extrusion(s) / closed Mesh(es); each one cut on its own
    Ctx       : optional context Breps / Meshes that cast shadows (not cut)
    Lat, Lon  : site, default Rotterdam 51.92 / 4.48 (falls back to X000 site if None)
    MaxCuts   : int, default 3
    MaxLoss   : float, max share of volume removed, default 0.2
    Slopes    : list of cut slopes in degrees from horizontal, default [30, 45, 60]
    Depths    : list of cut depths as share of the mass extent along the cut, default [0.15, 0.3, 0.45]
    Stepped   : bool, terraces at floor height instead of sloped faces (default False)
    Floor     : float, floor height for Stepped, metres (default 3.5)
    Objective : 0 Sunlit | 1 Total | 2 PerArea | 3 PerVolume (or the name), default 0
    Month, Day: test day for Sunlit (default 2, 21)
    MinSun    : hours of direct sun a facade needs on that day (default 3)
    Neighbours: weight of the neighbours' sunlit facade (default 1.0; 0 = ignore)
    Reach     : how far around the masses neighbours count, x mass height (default 3)
    MinGain   : float, minimum (% sun gained) / (% volume lost) to accept a cut, default 0.5
    Grid      : float, sample size on the skin, metres (default 3; the search runs at 2x Grid, 2x Step)
    Step      : float, sun time step in minutes (default 60 year-round; Sunlit uses Step/4)
    Units     : float, model units per metre (default 1; mm model = 1000)

GH OUTPUTS:
    carved   : carved Breps
    cutters  : cutter Breps that were applied (to see what came off)
    sun      : skin mesh coloured by sun (after; Sunlit: hours on the day, MinSun = middle of the ramp)
    before   : same, before carving
    nsun     : neighbour facades coloured the same way (after)
    ngain    : Sunlit: % of the neighbour facade we push below MinSun that the cuts give back
               (others: % change of the neighbours' sun)
    gain     : % change of the objective
    loss     : % volume removed
    log      : one line per round
    info     : summary
    (plain data in sc.sticky["M005_carve"])

RHINO COMMAND / ALIAS:
    Alias  SunCarve  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\M005_sun_carve.py"
    Select masses, Enter, then context (or Enter for none). Options: Latitude,
    Longitude, MaxCuts, MaxLoss, Stepped, FloorMetres, Objective, MinGain,
    MinSunHours, Month, Day, Neighbours, GridMetres, ShowSun, HideInput.
    Layers M005::Carved (white), M005::Cutters (hidden, magenta), M005::Sun, M005::NeighbourSun.
"""
from __future__ import division, print_function
import math

DEFAULTS = dict(Lat=51.92, Lon=4.48, MaxCuts=3, MaxLoss=0.2, Slopes=[30.0, 45.0, 60.0],
                Depths=[0.15, 0.3, 0.45], Stepped=False, Floor=3.5, Objective=0,
                Month=2, Day=21, MinSun=3.0, Neighbours=1.0, Reach=3.0,
                MinGain=0.5, Grid=3.0, Step=60.0, Units=1.0, ShowSun=True, Hide=False)
OBJECTIVES = ["Sunlit", "Total", "PerArea", "PerVolume"]
AZIMUTHS = [0, 45, 90, 135, 180, 225, 270, 315]
DIR_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# ---------------------------------------------------------------- sun (solar time)
def day_of_year(m, d):
    return sum(MONTH_DAYS[:m - 1]) + d

def sun_alt_az(lat, m, d, hour_solar):
    """Altitude, azimuth (deg, from north clockwise) at solar time. NOAA approx."""
    n = day_of_year(m, d)
    g = 2 * math.pi / 365.0 * (n - 1 + (hour_solar - 12) / 24.0)
    dec = (0.006918 - 0.399912*math.cos(g) + 0.070257*math.sin(g)
           - 0.006758*math.cos(2*g) + 0.000907*math.sin(2*g)
           - 0.002697*math.cos(3*g) + 0.00148*math.sin(3*g))
    ha = math.radians(hour_solar * 15.0 - 180.0)
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

def day_suns(lat, month, day, step_min=15.0, min_alt=2.0):
    """[(unit vector to sun, hours)] for one day, solar time."""
    out = []
    dt = step_min / 60.0
    k = 0
    while (k + 0.5) * dt < 24:
        alt, az = sun_alt_az(lat, month, day, (k + 0.5) * dt)
        if alt > min_alt:
            a, z = math.radians(alt), math.radians(az)
            out.append(((math.cos(a)*math.sin(z), math.cos(a)*math.cos(z), math.sin(a)), dt))
        k += 1
    return out

def year_suns(lat, step_min=60.0, min_alt=2.0):
    """[(unit vector to sun, hours per year it stands for)], 21st of each month."""
    out = []
    dt = step_min / 60.0
    for m in range(1, 13):
        k = 0
        while True:
            h = (k + 0.5) * dt
            if h >= 24:
                break
            alt, az = sun_alt_az(lat, m, 21, h)
            if alt > min_alt:
                a, z = math.radians(alt), math.radians(az)
                out.append(((math.cos(a)*math.sin(z), math.cos(a)*math.cos(z), math.sin(a)),
                            dt * MONTH_DAYS[m - 1]))
            k += 1
    return out

# ---------------------------------------------------------------- cuts
def cut_normal(az_deg, slope_deg):
    """Normal of a cut face that faces az (deg from N) and slopes slope (deg from horizontal)."""
    a, t = math.radians(az_deg), math.radians(slope_deg)
    return (math.sin(t)*math.sin(a), math.sin(t)*math.cos(a), math.cos(t))

def dot(a, b):
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]

def candidates(points, slopes, depths, azimuths=AZIMUTHS):
    """Cut planes for one mass: dicts with normal n, offset o (removes n.p > o)."""
    out = []
    for ai, az in enumerate(azimuths):
        for s in slopes:
            n = cut_normal(az, s)
            pr = [dot(n, p) for p in points]
            lo, hi = min(pr), max(pr)
            for f in depths:
                out.append(dict(n=n, o=hi - f * (hi - lo), az=az, slope=s, depth=f,
                                name="{0} {1:g}deg {2:g}%".format(DIR_NAMES[ai % 8], s, 100 * f)))
    return out

def cutter_boxes(cut, zmin, zmax, R, stepped=False, floor=3.5):
    """Boxes to subtract, each (origin, xaxis, yaxis, zaxis, (x0,x1), (y0,y1), (z0,z1)).
    Sloped: one box above the plane. Stepped: one vertical-faced box per floor band."""
    n, o = cut["n"], cut["o"]
    if not stepped:
        org = (n[0]*o, n[1]*o, n[2]*o)
        z = n
        ref = (0.0, 0.0, 1.0) if abs(n[2]) < 0.9 else (1.0, 0.0, 0.0)
        x = _unit(_cross(ref, z))
        y = _cross(z, x)
        return [(org, x, y, z, (-R, R), (-R, R), (0.0, R))]
    st = math.hypot(n[0], n[1])
    if st < 1e-6:                                   # flat cut = height trim
        return [((0.0, 0.0, o / n[2]), (1.0, 0, 0), (0, 1.0, 0), (0, 0, 1.0), (-R, R), (-R, R), (0.0, R))]
    h = (n[0] / st, n[1] / st, 0.0)
    y = (-h[1], h[0], 0.0)
    out = []
    k = 0
    while True:
        z0 = zmin + k * floor
        if z0 >= zmax - 1e-9:
            break
        z1 = z0 + floor
        c = (o - n[2] * z1) / st                    # plane crosses the band top here
        top = R if z1 >= zmax - 1e-9 else floor
        out.append(((h[0]*c, h[1]*c, z0), h, y, (0.0, 0.0, 1.0), (0.0, R), (-R, R), (0.0, top)))
        k += 1
    return out

def _cross(a, b):
    return (a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0])

def _unit(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)

def box_corners(b):
    org, x, y, z, (x0, x1), (y0, y1), (z0, z1) = b
    pts = []
    for zz in (z0, z1):
        for (xx, yy) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            pts.append(tuple(org[i] + x[i]*xx + y[i]*yy + z[i]*zz for i in range(3)))
    return pts

# ---------------------------------------------------------------- scoring
def sun_score(faces, suns, occluded, hours=False, min_sun=3.0, max_nz=0.95):
    """faces: [(centre, unit normal, area)]; occluded(p, d) -> bool.
    hours=False: (total sun m2h, skin area, per-face cos-weighted sun hours)
    hours=True : (facade m2 with >= min_sun h, facade m2, per-face sun hours);
                 facade = not looking down and not a flat roof (n.z < max_nz)."""
    tot, area, per = 0.0, 0.0, []
    for c, n, a in faces:
        if n[2] < -0.5 or (hours and n[2] >= max_nz):     # soffits, bottoms (and roofs for hours)
            per.append(None)
            continue
        e = 0.0
        p = (c[0] + n[0]*0.01, c[1] + n[1]*0.01, c[2] + n[2]*0.01)
        for d, w in suns:
            cs = dot(n, d)
            if cs > (0.02 if hours else 0.0) and not occluded(p, d):
                e += w if hours else cs * w
        per.append(e)
        if hours:
            tot += a if e >= min_sun - 1e-9 else 0.0
        else:
            tot += e * a
        area += a
    return tot, area, per

def objective(o, total, area, volume):
    if o == 2:
        return total / area if area > 0 else 0.0
    if o == 3:
        return total / volume if volume > 0 else 0.0
    return total

def parse_objective(v):
    if isinstance(v, str):
        t = v.strip().lower()
        for i, nm in enumerate(OBJECTIVES):
            if t.startswith(nm.lower()[:4]):
                return i
        return 0
    return max(0, min(3, int(v or 0)))

def run_greedy(state, evaluate, try_cut, cands_for, max_cuts, max_loss, obj, min_gain, log=None):
    """Greedy carve. state = list of per-mass geometry; evaluate(state) -> (total, area, volume);
    try_cut(state, m, cut) -> new state or None; cands_for(state, m) -> cuts.
    Each round keeps the cut with the best (% objective gained) / (% volume lost)."""
    t0, a0, v0 = evaluate(state)
    j0 = objective(obj, t0, a0, v0)
    cur, jc, vc = state, j0, v0
    hist = [dict(round=0, name="start", total=t0, area=a0, volume=v0, J=j0)]
    applied = []
    for rnd in range(1, int(max_cuts) + 1):
        best = None
        for m in range(len(cur)):
            for cut in cands_for(cur, m):
                new = try_cut(cur, m, cut)
                if new is None:
                    continue
                t, a, v = evaluate(new)
                if v0 - v > max_loss * v0 + 1e-9 or vc - v <= 1e-9 * v0:
                    continue
                j = objective(obj, t, a, v)
                dj = (j - jc) / abs(j0) if j0 else 0.0
                dv = (vc - v) / v0
                eff = dj / dv
                if dj > 0 and eff >= min_gain and (best is None or eff > best[0]):
                    best = (eff, new, m, cut, t, a, v, j)
        if best is None:
            if log:
                log("round {0}: no cut pays back, stop".format(rnd))
            break
        eff, cur, m, cut, t, a, v, jc = best
        vc = v
        applied.append((m, cut))
        hist.append(dict(round=rnd, name=cut["name"], mass=m, total=t, area=a, volume=v, J=jc, eff=eff))
        if log:
            log("round {0}: mass {1} cut {2} | objective {3:+.1f}% | volume -{4:.1f}% | eff {5:.2f}".format(
                rnd, m, cut["name"], 100 * (jc - j0) / abs(j0), 100 * (v0 - v) / v0, eff))
    return cur, applied, hist

def sun_colour(t):
    """0..1 -> deep blue, cyan, yellow, orange, magenta (MVRDV pops)."""
    stops = [(0.0, (40, 60, 160)), (0.3, (0, 133, 255)), (0.55, (120, 220, 90)),
             (0.75, (255, 210, 0)), (0.9, (255, 120, 0)), (1.0, (230, 0, 126))]
    t = max(0.0, min(1.0, t))
    for (a, c0), (b, c1) in zip(stops[:-1], stops[1:]):
        if t <= b:
            u = (t - a) / (b - a)
            return tuple(int(c0[i] + (c1[i] - c0[i]) * u) for i in range(3))
    return stops[-1][1]

def neighbour_text(hist, obj):
    h0, h1 = hist[0], hist[-1]
    if "nb" not in h0 or not h0.get("nb_area"):
        return 0.0, ""
    g = 100 * (h1["nb"] - h0["nb"]) / h0["nb"] if h0["nb"] else 0.0
    if obj == 0 and h0.get("nb_free") is not None:
        c0, c1 = h0["nb_free"] - h0["nb"], h0["nb_free"] - h1["nb"]
        back = 100 * (c0 - c1) / c0 if c0 > 0 else 0.0
        return back, (" | neighbour facade we push below {0:g} h: {1:,.0f} -> {2:,.0f} m2 ({3:.0f}% given back)".format(
            h0.get("min_sun", 3.0), c0, c1, back))
    if obj == 0:
        return g, " | neighbours' sunlit facade {0:,.0f} -> {1:,.0f} m2 ({2:+.1f}%)".format(h0["nb"], h1["nb"], g)
    return g, " | neighbours' sun {0:,.0f} -> {1:,.0f} m2h ({2:+.1f}%)".format(h0["nb"], h1["nb"], g)

def summary(hist, obj, min_sun=3.0):
    gain, loss, txt = _summary(hist, obj, min_sun)
    return gain, loss, txt + neighbour_text(hist, obj)[1]

def _summary(hist, obj, min_sun=3.0):
    h0, h1 = hist[0], hist[-1]
    gain = 100 * (h1["J"] - h0["J"]) / abs(h0["J"]) if h0["J"] else 0.0
    loss = 100 * (h0["volume"] - h1["volume"]) / h0["volume"] if h0["volume"] else 0.0
    if obj == 0:
        sh = lambda h: 100 * h["total"] / h["area"] if h["area"] else 0.0
        txt = ("Sun carve (Sunlit): {0} cut(s) | facade with >= {1:g} h sun {2:,.0f} -> {3:,.0f} m2 "
               "({4:.0f}% -> {5:.0f}% of facade, {6:+.1f}%) | volume -{7:.1f}%".format(
                   len(hist) - 1, min_sun, h0["total"], h1["total"], sh(h0), sh(h1), gain, loss))
        return gain, loss, txt
    txt = ("Sun carve ({0}): {1} cut(s) | objective {2:+.1f}% | volume -{3:.1f}% | "
           "sun {4:,.0f} -> {5:,.0f} m2h/yr | sun per m2 skin {6:,.0f} -> {7:,.0f} h".format(
               OBJECTIVES[obj], len(hist) - 1, gain, loss, h0["total"], h1["total"],
               h0["total"] / h0["area"] if h0["area"] else 0, h1["total"] / h1["area"] if h1["area"] else 0))
    return gain, loss, txt

# ---------------------------------------------------------------- Rhino side
def _breps(geo):
    import Rhino.Geometry as rg
    out = []
    for g in geo if isinstance(geo, (list, tuple)) else [geo]:
        if g is None:
            continue
        if hasattr(g, "Geometry") and not isinstance(g, rg.GeometryBase):
            g = g.Geometry
        if isinstance(g, rg.Extrusion):
            g = g.ToBrep()
        elif isinstance(g, rg.Mesh):
            g = rg.Brep.CreateFromMesh(g, True)
        if isinstance(g, rg.Brep) and g.IsSolid:
            out.append(g)
    return out

def _ctx_mesh(geo):
    import Rhino.Geometry as rg
    m = rg.Mesh()
    for g in geo if isinstance(geo, (list, tuple)) else ([geo] if geo is not None else []):
        if g is None:
            continue
        if hasattr(g, "Geometry") and not isinstance(g, rg.GeometryBase):
            g = g.Geometry
        if isinstance(g, rg.Extrusion):
            g = g.ToBrep()
        if isinstance(g, rg.Brep):
            for x in rg.Mesh.CreateFromBrep(g, rg.MeshingParameters.FastRenderMesh) or []:
                m.Append(x)
        elif isinstance(g, rg.Mesh):
            m.Append(g)
    return m

def _volume(b):
    import Rhino.Geometry as rg
    vp = rg.VolumeMassProperties.Compute(b)
    return abs(vp.Volume) if vp else 0.0

def build(Mass, Ctx, Lat, Lon, MaxCuts, MaxLoss, Slopes, Depths, Stepped, Floor,
          Objective, MinGain, Grid, Step, Units, Month=2, Day=21, MinSun=3.0,
          Neighbours=1.0, Reach=3.0, log=print):
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    import System
    import scriptcontext as sc
    U = float(Units)
    tol = sc.doc.ModelAbsoluteTolerance if sc.doc else 0.001 * U
    breps = _breps(Mass)
    if not breps:
        raise ValueError("No closed massing given")
    obj = parse_objective(Objective)
    if Lat is None or Lon is None:
        site = sc.sticky.get("X000_site") if hasattr(sc, "sticky") else None
        Lat = site.get("lat", DEFAULTS["Lat"]) if site else DEFAULTS["Lat"]
    hours = obj == 0
    if hours:
        suns = day_suns(float(Lat), int(Month), int(Day), float(Step) / 4.0)
        suns_c = day_suns(float(Lat), int(Month), int(Day), float(Step) / 2.0)
    else:
        suns = year_suns(float(Lat), float(Step))
        suns_c = year_suns(float(Lat), 2 * float(Step))  # the search runs coarse (2x grid, 2x step)
    ctx = _ctx_mesh(Ctx)
    bb = rg.BoundingBox.Empty
    for b in breps:
        bb.Union(b.GetBoundingBox(True))
    R = 10.0 * max(bb.Diagonal.Length, 1.0)
    grid = float(Grid) * U
    def mparams(edge):
        mp = rg.MeshingParameters.Default
        mp.MaximumEdgeLength = edge
        mp.SimplePlanes = False
        mp.GridMinCount = 2
        return mp
    mp_fine, mp_coarse = mparams(grid), mparams(2 * grid)
    wn = float(Neighbours or 0.0) if obj in (0, 1) else 0.0
    reach = float(Reach or 3.0) * max(bb.Max.Z - bb.Min.Z, 1.0)

    def face_list(mesh):
        mesh.Faces.ConvertQuadsToTriangles()
        mesh.FaceNormals.ComputeFaceNormals()
        out = []
        for i in range(mesh.Faces.Count):
            f = mesh.Faces[i]
            a, b2, c = mesh.Vertices[f.A], mesh.Vertices[f.B], mesh.Vertices[f.C]
            ar = 0.5 * rg.Vector3d.CrossProduct(rg.Vector3d(b2.X - a.X, b2.Y - a.Y, b2.Z - a.Z),
                                               rg.Vector3d(c.X - a.X, c.Y - a.Y, c.Z - a.Z)).Length
            n = mesh.FaceNormals[i]
            out.append((((a.X + b2.X + c.X) / 3.0, (a.Y + b2.Y + c.Y) / 3.0, (a.Z + b2.Z + c.Z) / 3.0),
                        (n.X, n.Y, n.Z), ar / (U * U)))
        return out

    def neighbour_mesh(mp):
        """Context faces within Reach of the masses, meshed at sample size."""
        src = rg.Mesh()
        for g in Ctx if isinstance(Ctx, (list, tuple)) else ([Ctx] if Ctx is not None else []):
            if g is None:
                continue
            if hasattr(g, "Geometry") and not isinstance(g, rg.GeometryBase):
                g = g.Geometry
            if isinstance(g, rg.Extrusion):
                g = g.ToBrep()
            if isinstance(g, rg.Brep):
                for x in rg.Mesh.CreateFromBrep(g, mp) or []:
                    src.Append(x)
            elif isinstance(g, rg.Mesh):
                src.Append(g)
        src.Faces.ConvertQuadsToTriangles()
        out = rg.Mesh()
        for i in range(src.Faces.Count):
            f = src.Faces[i]
            pts = [src.Vertices[f.A], src.Vertices[f.B], src.Vertices[f.C]]
            cx = sum(p.X for p in pts) / 3.0; cy = sum(p.Y for p in pts) / 3.0; cz = sum(p.Z for p in pts) / 3.0
            if (bb.Min.X - reach <= cx <= bb.Max.X + reach and bb.Min.Y - reach <= cy <= bb.Max.Y + reach
                    and cz <= bb.Max.Z):
                k = out.Vertices.Count
                for p in pts:
                    out.Vertices.Add(p)
                out.Faces.AddFace(k, k + 1, k + 2)
        return out
    nb_mesh = {True: neighbour_mesh(mp_fine), False: neighbour_mesh(mp_coarse)} if (wn > 0 or obj in (0, 1)) and Ctx else {True: rg.Mesh(), False: rg.Mesh()}
    nb_faces = {True: face_list(nb_mesh[True]), False: face_list(nb_mesh[False])}
    mp_c = rg.MeshingParameters.FastRenderMesh
    cache = {}

    def skin(state, fine=False):
        key = (fine,) + tuple(id(b) for b in state)
        mp_s = mp_fine if fine else mp_coarse
        sn = suns if fine else suns_c
        if key in cache:
            return cache[key]
        occ = rg.Mesh()
        occ.Append(ctx)
        samp = rg.Mesh()
        for b in state:
            for x in rg.Mesh.CreateFromBrep(b, mp_c) or []:
                occ.Append(x)
            for x in rg.Mesh.CreateFromBrep(b, mp_s) or []:
                samp.Append(x)
        faces = face_list(samp)

        def occluded(p, d):
            return Intersection.MeshRay(occ, rg.Ray3d(rg.Point3d(p[0] + d[0]*0.05*U, p[1] + d[1]*0.05*U, p[2] + d[2]*0.05*U),
                                                      rg.Vector3d(d[0], d[1], d[2]))) >= 0
        t, a, per = sun_score(faces, sn, occluded, hours, float(MinSun))
        tn, an, pern = sun_score(nb_faces[fine], sn, occluded, hours, float(MinSun)) if nb_faces[fine] else (0.0, 0.0, [])
        v = sum(_volume(b) for b in state) / U**3
        cache[key] = (t + wn * tn, a, v, samp, per, t, tn, an, pern)
        return cache[key]

    def evaluate(state):
        t, a, v = skin(state)[:3]
        return t, a, v

    def cands_for(state, m):
        pts = [(p.X, p.Y, p.Z) for p in state[m].GetBoundingBox(True).GetCorners()]
        return candidates(pts, [float(s) for s in Slopes], [float(d) for d in Depths])

    def to_brep(bx):
        org, x, y, z, ix, iy, iz = bx
        pl = rg.Plane(rg.Point3d(*org), rg.Vector3d(*x), rg.Vector3d(*y))
        return rg.Box(pl, rg.Interval(*ix), rg.Interval(*iy), rg.Interval(*iz)).ToBrep()

    def try_cut(state, m, cut):
        b = state[m]
        bbm = b.GetBoundingBox(True)
        boxes = cutter_boxes(cut, bbm.Min.Z, bbm.Max.Z, R, bool(Stepped), float(Floor) * U)
        cutters = [to_brep(bx) for bx in boxes]
        res = rg.Brep.CreateBooleanDifference([b], cutters, tol)
        if not res or len(res) != 1 or not res[0].IsSolid:
            return None
        new = list(state)
        new[m] = res[0]
        cut["_cutters"] = cutters
        return new

    state, applied, hist = run_greedy(breps, evaluate, try_cut, cands_for, MaxCuts, float(MaxLoss),
                                      obj, float(MinGain), log)
    c0, a0, v0, samp0, per0, t0, n0, na0, pern0 = skin(breps, True)
    nb_free = None
    if hours and nb_faces[True]:
        def occ_ctx(p, d):
            return Intersection.MeshRay(ctx, rg.Ray3d(rg.Point3d(p[0] + d[0]*0.05*U, p[1] + d[1]*0.05*U, p[2] + d[2]*0.05*U),
                                                      rg.Vector3d(d[0], d[1], d[2]))) >= 0
        nb_free = sun_score(nb_faces[True], suns, occ_ctx, True, float(MinSun))[0]
    c1, a1, v1, samp1, per1, t1, n1, na1, pern1 = skin(state, True)
    hist[0].update(total=t0, area=a0, volume=v0, J=objective(obj, c0, a0, v0), nb=n0, nb_area=na0,
                   nb_free=nb_free, min_sun=float(MinSun))
    hist[-1].update(total=t1, area=a1, volume=v1, J=objective(obj, c1, a1, v1), nb=n1, nb_area=na1)
    vmax = (2.0 * float(MinSun)) if hours else max([p for p in per0 + per1 if p is not None] or [1.0])

    def coloured(samp, per):
        m = rg.Mesh()
        for i in range(samp.Faces.Count):
            f = samp.Faces[i]
            k = m.Vertices.Count
            for vi in (f.A, f.B, f.C):
                m.Vertices.Add(samp.Vertices[vi])
            m.Faces.AddFace(k, k + 1, k + 2)
            c = sun_colour((per[i] or 0.0) / vmax) if per[i] is not None else (200, 200, 200)
            for _ in range(3):
                m.VertexColors.Add(System.Drawing.Color.FromArgb(c[0], c[1], c[2]))
        m.Normals.ComputeNormals()
        return m

    gain, loss, info = summary(hist, obj, float(MinSun))
    ngain = neighbour_text(hist, obj)[0]   # Sunlit: % of the shade we cast on neighbours that the cuts give back
    lines = ["round {0}: {1}".format(h["round"], h["name"]) for h in hist]
    cutters = []
    for m, cut in applied:
        cutters += cut.get("_cutters", [])
    data = dict(objective=OBJECTIVES[obj], gain=gain, loss=loss, cuts=[dict(mass=m, az=c["az"], slope=c["slope"],
                depth=c["depth"], name=c["name"]) for m, c in applied],
                sun_before=t0, sun_after=t1, volume_before=v0, volume_after=v1,
                neighbours_before=n0, neighbours_after=n1, neighbour_gain=ngain, neighbour_weight=wn)
    try:
        sc.sticky["M005_carve"] = data
    except Exception:
        pass
    nsun = coloured(nb_mesh[True], pern1) if pern1 else rg.Mesh()
    return state, cutters, coloured(samp1, per1), coloured(samp0, per0), nsun, gain, ngain, loss, lines, info

# ------------------------------------------------------------ command
def _gh_value(name):
    v = globals().get(name)
    return DEFAULTS.get(name) if v is None else v

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
    key = "M005_sun_carve"
    v = dict(DEFAULTS); v.update(sc.sticky.get(key, {}))
    ft = Rhino.DocObjects.ObjectType
    go = GetObject()
    go.SetCommandPrompt("Select massing to carve for sun")
    go.GeometryFilter = ft.Brep | ft.Extrusion | ft.Mesh
    o_lat = OptionDouble(float(v["Lat"]), -89.0, 89.0)
    o_lon = OptionDouble(float(v["Lon"]), -180.0, 180.0)
    o_cuts = OptionInteger(int(v["MaxCuts"]), 1, 20)
    o_loss = OptionDouble(float(v["MaxLoss"]), 0.01, 0.9)
    o_step = OptionToggle(bool(v["Stepped"]), "No", "Yes")
    o_floor = OptionDouble(float(v["Floor"]), 1.0, 20.0)
    o_gain = OptionDouble(float(v["MinGain"]), 0.0, 100.0)
    o_min = OptionDouble(float(v["MinSun"]), 0.25, 24.0)
    o_mon = OptionInteger(int(v["Month"]), 1, 12)
    o_day = OptionInteger(int(v["Day"]), 1, 31)
    o_nb = OptionDouble(float(v["Neighbours"]), 0.0, 10.0)
    o_grid = OptionDouble(float(v["Grid"]), 0.5, 50.0)
    o_show = OptionToggle(bool(v["ShowSun"]), "No", "Yes")
    o_hide = OptionToggle(bool(v["Hide"]), "No", "Yes")
    obj = [parse_objective(v["Objective"])]

    def add_opts():
        i = go.AddOptionList("Objective", OBJECTIVES, obj[0])
        go.AddOptionDouble("Latitude", o_lat)
        go.AddOptionDouble("Longitude", o_lon)
        go.AddOptionInteger("MaxCuts", o_cuts)
        go.AddOptionDouble("MaxLoss", o_loss)
        go.AddOptionToggle("Stepped", o_step)
        go.AddOptionDouble("FloorMetres", o_floor)
        go.AddOptionDouble("MinGain", o_gain)
        go.AddOptionDouble("MinSunHours", o_min)
        go.AddOptionInteger("Month", o_mon)
        go.AddOptionInteger("Day", o_day)
        go.AddOptionDouble("Neighbours", o_nb)
        go.AddOptionDouble("GridMetres", o_grid)
        go.AddOptionToggle("ShowSun", o_show)
        go.AddOptionToggle("HideInput", o_hide)
        return i
    oi = add_opts()
    while True:
        res = go.GetMultiple(1, 0)
        if res == Rhino.Input.GetResult.Option:
            if go.OptionIndex() == oi:
                obj[0] = go.Option().CurrentListOptionIndex
                go.ClearCommandOptions()
                oi = add_opts()
            go.EnablePreSelect(False, True)
            continue
        if res != Rhino.Input.GetResult.Object:
            return
        break
    objs = [go.Object(i) for i in range(go.ObjectCount)]
    ids = set(o.ObjectId for o in objs)
    gc = GetObject()
    gc.SetCommandPrompt("Select context that casts shadows (Enter for none)")
    gc.GeometryFilter = ft.Brep | ft.Extrusion | ft.Mesh
    gc.EnablePreSelect(False, True)
    gc.AcceptNothing(True)
    ctx = []
    if gc.GetMultiple(0, 0) == Rhino.Input.GetResult.Object:
        ctx = [gc.Object(i).Geometry() for i in range(gc.ObjectCount) if gc.Object(i).ObjectId not in ids]
    v.update(Lat=o_lat.CurrentValue, Lon=o_lon.CurrentValue, MaxCuts=o_cuts.CurrentValue,
             MaxLoss=o_loss.CurrentValue, Stepped=o_step.CurrentValue, Floor=o_floor.CurrentValue,
             Objective=obj[0], MinGain=o_gain.CurrentValue, MinSun=o_min.CurrentValue,
             Month=o_mon.CurrentValue, Day=o_day.CurrentValue, Neighbours=o_nb.CurrentValue, Grid=o_grid.CurrentValue,
             ShowSun=o_show.CurrentValue, Hide=o_hide.CurrentValue)
    sc.sticky[key] = v
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)

    def log(s):
        print("SunCarve " + s)
        Rhino.RhinoApp.Wait()
    try:
        carved, cutters, sun, before, nsun, gain, ngain, loss, lines, info = build(
            [o.Geometry() for o in objs], ctx, v["Lat"], v["Lon"], v["MaxCuts"], v["MaxLoss"],
            v["Slopes"], v["Depths"], v["Stepped"], v["Floor"], v["Objective"], v["MinGain"],
            v["Grid"], v["Step"], f, v["Month"], v["Day"], v["MinSun"], v["Neighbours"], v["Reach"], log)
    except ValueError as e:
        print("SunCarve: {0}".format(e))
        return
    _layer(sc.doc, "M005", (255, 255, 255))
    gi = sc.doc.Groups.Add("SunCarve {0}".format(OBJECTIVES[v["Objective"]]))
    a = Rhino.DocObjects.ObjectAttributes()
    a.LayerIndex = _layer(sc.doc, "Carved", (255, 255, 255), "M005")
    for b in carved:
        sc.doc.Groups.AddToGroup(gi, [sc.doc.Objects.AddBrep(b, a)])
    a2 = Rhino.DocObjects.ObjectAttributes()
    li = _layer(sc.doc, "Cutters", (230, 0, 126), "M005")
    a2.LayerIndex = li
    for c in cutters:
        sc.doc.Objects.AddBrep(c, a2)
    sc.doc.Layers[li].IsVisible = False
    if v["ShowSun"]:
        a3 = Rhino.DocObjects.ObjectAttributes()
        a3.LayerIndex = _layer(sc.doc, "Sun", (255, 210, 0), "M005")
        sc.doc.Groups.AddToGroup(gi, [sc.doc.Objects.AddMesh(sun, a3)])
        if nsun.Faces.Count:
            a4 = Rhino.DocObjects.ObjectAttributes()
            a4.LayerIndex = _layer(sc.doc, "NeighbourSun", (0, 133, 255), "M005")
            sc.doc.Groups.AddToGroup(gi, [sc.doc.Objects.AddMesh(nsun, a4)])
    if v["Hide"]:
        for o in objs:
            sc.doc.Objects.Hide(o.ObjectId, True)
    sc.doc.Views.Redraw()
    print(info)

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    _l = _gh_value("Lat"); _o = _gh_value("Lon")
    carved, cutters, sun, before, nsun, gain, ngain, loss, log, info = build(
        Mass, _gh_value("Ctx"), _l, _o, _gh_value("MaxCuts"), _gh_value("MaxLoss"),  # noqa: F821
        _gh_value("Slopes") or DEFAULTS["Slopes"], _gh_value("Depths") or DEFAULTS["Depths"],
        _gh_value("Stepped"), _gh_value("Floor"), _gh_value("Objective"), _gh_value("MinGain"),
        _gh_value("Grid"), _gh_value("Step"), _gh_value("Units"), _gh_value("Month"), _gh_value("Day"),
        _gh_value("MinSun"), _gh_value("Neighbours"), _gh_value("Reach"), log=lambda s: None)
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        # self-test of the pure maths
        s = year_suns(51.92, 60.0)
        print("sun samples", len(s), "hours/yr", round(sum(w for _, w in s)))
        c = candidates([(0, 0, 0), (10, 10, 30)], [45.0], [0.2])
        print(len(c), "cands; first", c[0]["name"], [round(x, 3) for x in c[0]["n"]], round(c[0]["o"], 2))
        print(len(cutter_boxes(c[4], 0, 30, 100, True, 3.5)), "stepped boxes for", c[4]["name"])
