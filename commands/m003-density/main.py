"""
M003  Density Metrics  (Spacemate: FSI, GSI, OSR, L + GFA per floor, envelope)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: Density).

Slices massing into floor plates and reports the Spacemate density set
(Berghauser Pont & Haupt) plus envelope figures, as plain numbers other tools
(and an optimiser loop) can read:
    GFA  gross floor area = sum of floor plates (sliced at every level)
    FSI  floor space index = GFA / plot area                 (FAR)
    GSI  ground space index = footprint / plot area           (coverage)
    OSR  open space ratio  = (1 - GSI) / FSI                 (open m2 per m2 GFA)
    L    average layers     = FSI / GSI
    form factor = envelope area / volume (1/m), facade area per N/E/S/W.
Footprint = ground-floor plate; 'projected' = union of all plates seen from
above (bigger than the footprint when the building cantilevers).

GH INPUTS:
    Mass   : closed Brep(s) / Mesh(es)  building masses
    Plot   : closed planar curve       plot boundary (optional, needed for FSI/GSI/OSR)
    Floor  : float  floor-to-floor height, metres (default 3.2)
    First  : float  ground floor height, metres (default 4.0)
    North  : float  degrees, north from +Y toward -X (default 0)
    Units  : float  model units per metre (default 1; mm model = 1000)

GH OUTPUTS:
    plates    : floor plate breps (all levels)
    levels    : level heights (model units)
    floor_gfa : GFA per level, m2
    gfa, fsi, gsi, osr, L          : numbers
    footprint, projected, plot_area : m2
    volume (m3), envelope (m2), form_factor (1/m)
    facade    : [N, E, S, W] facade area m2 ;  roof : roof area m2
    metrics   : plain dict with all of the above (also sc.sticky["M003_metrics"])
    info      : summary text

RHINO COMMAND / ALIAS:
    Alias  Density  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\M003_density_metrics.py"
    Select masses, then the plot curve (Enter = no plot). Options (metres):
    FloorHeight, GroundFloorHeight, NorthAngle, BakePlates.
    Bakes floor plates on M003::Plates and a text dot with the numbers on M003::Report.
"""
from __future__ import division, print_function
import math

DEFAULTS = dict(Floor=3.2, First=4.0, North=0.0, Units=1.0, Bake=True)
PLATE_RGB = (255, 210, 0)       # yellow pop (palette)
REPORT_RGB = (230, 0, 126)      # magenta

# ---------------------------------------------------------------- pure maths
def level_heights(z0, z1, first=4.0, floor=3.2, min_clear=2.0):
    """Floor levels from z0 up to (not including) the roof at z1."""
    if floor <= 0 or first <= 0:
        raise ValueError("Floor heights must be > 0")
    out, z = [], z0
    while z1 - z >= min_clear - 1e-9:
        out.append(z)
        z += first if len(out) == 1 else floor
    return out

def ring_area(pts):
    """Signed shoelace area of a ring [(x, y), ...]."""
    a = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i][0], pts[i][1]
        x1, y1 = pts[(i + 1) % n][0], pts[(i + 1) % n][1]
        a += x0 * y1 - x1 * y0
    return a / 2.0

def spacemate(gfa, footprint, plot):
    """dict(fsi, gsi, osr, L); None where the plot is missing."""
    if not plot or plot <= 0:
        return dict(fsi=None, gsi=None, osr=None, L=(gfa / footprint if footprint else None))
    fsi, gsi = gfa / plot, footprint / plot
    return dict(fsi=fsi, gsi=gsi, osr=((1 - gsi) / fsi if fsi > 0 else None),
                L=(fsi / gsi if gsi > 0 else None))

def building_type(L, gsi):
    """Rough Spacemate reading of the numbers (low/mid/high-rise x point/strip/block)."""
    if L is None:
        return "-"
    h = "low-rise" if L < 3.5 else ("mid-rise" if L < 7.5 else "high-rise")
    if gsi is None:
        return h
    t = "point / open" if gsi < 0.2 else ("strip" if gsi < 0.35 else "block / closed")
    return h + ", " + t

def facade_bins(normals, areas, north=0.0, vertical=0.3, roof=0.7):
    """Sum facade area by orientation. normals: (x, y, z) unit; returns
    ([N, E, S, W], roof_area). Sectors are 90 deg centred on each direction."""
    nesw = [0.0, 0.0, 0.0, 0.0]
    rf = 0.0
    for (x, y, z), a in zip(normals, areas):
        if z > roof:
            rf += a
        elif abs(z) <= vertical:
            az = (math.degrees(math.atan2(x, y)) + north) % 360.0     # 0 = north, clockwise
            nesw[int(((az + 45.0) % 360.0) // 90.0)] += a
    return nesw, rf

def summary(m):
    f = lambda v, d=2: "-" if v is None else ("{0:." + str(d) + "f}").format(v)
    return ("GFA {0:,.0f} m2 in {1} levels | plot {2} m2, footprint {3:,.0f} m2 (projected {4:,.0f}) | "
            "FSI {5} | GSI {6} | OSR {7} | L {8} ({9}) | volume {10:,.0f} m3, envelope {11:,.0f} m2, "
            "form factor {12} 1/m | facade N {13:,.0f} E {14:,.0f} S {15:,.0f} W {16:,.0f} m2, roof {17:,.0f} m2".format(
                m["gfa"], len([a for a in m["floor_gfa"] if a > 0]),
                "-" if not m["plot_area"] else "{0:,.0f}".format(m["plot_area"]),
                m["footprint"], m["projected"], f(m["fsi"]), f(m["gsi"]), f(m["osr"]), f(m["L"], 1),
                m["type"], m["volume"], m["envelope"], f(m["form_factor"], 3),
                m["facade"][0], m["facade"][1], m["facade"][2], m["facade"][3], m["roof"]))

def assemble(floor_gfa, levels, footprint, projected, plot, volume, envelope, facade, roof):
    gfa = sum(floor_gfa)
    m = dict(gfa=gfa, floor_gfa=list(floor_gfa), levels=list(levels), footprint=footprint,
             projected=projected, plot_area=plot, volume=volume, envelope=envelope,
             form_factor=(envelope / volume if volume > 0 else None), facade=list(facade), roof=roof)
    m.update(spacemate(gfa, footprint, plot))
    m["type"] = building_type(m["L"], m["gsi"])
    return m

# ------------------------------------------------------------ rhino geometry
def _as_breps(items):
    import Rhino.Geometry as rg
    if items is None:
        return []
    if not isinstance(items, (list, tuple)):
        items = [items]
    out = []
    for g in items:
        if g is None:
            continue
        if isinstance(g, rg.Extrusion):
            g = g.ToBrep()
        if isinstance(g, rg.Mesh):
            b = rg.Brep.CreateFromMesh(g, True)
            if b:
                out.append(b)
        elif isinstance(g, rg.Brep):
            out.append(g)
    return out

def _plates_at(breps, z, tol):
    """Planar floor regions (with courtyard holes) of the (already unioned) masses at z."""
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    pl = rg.Plane(rg.Point3d(0, 0, z), rg.Vector3d.ZAxis)
    out = []
    for b in breps:
        ok, cs, pts = Intersection.BrepPlane(b, pl, tol)
        if not ok or not cs:
            continue
        crvs = [c for c in rg.Curve.JoinCurves(cs, tol * 10) if c.IsClosed]
        regs = rg.Brep.CreatePlanarBreps(crvs, tol) if crvs else None
        if regs:
            out.extend(regs)
    return out

def _loops(plate, kind):
    import Rhino.Geometry as rg
    return [l.To3dCurve() for f in plate.Faces for l in f.Loops if l.LoopType == kind]

def _projected(plates, ground, tol):
    """Area seen from above: union of all outer loops, minus courtyards no level covers."""
    import Rhino.Geometry as rg
    outer = []
    for p in plates:
        for c in _loops(p, rg.BrepLoopType.Outer):
            c.Translate(0, 0, -c.PointAtStart.Z)
            outer.append(c)
    if not outer:
        return 0.0
    un = rg.Curve.CreateBooleanUnion(outer, tol) if len(outer) > 1 else outer
    un = list(un) if un else outer
    area = sum(abs(rg.AreaMassProperties.Compute(c).Area) for c in un)
    for g in ground:
        for h in _loops(g, rg.BrepLoopType.Inner):
            amp = rg.AreaMassProperties.Compute(h)
            c = amp.Centroid
            covered = False
            for p in plates:
                q = rg.Point3d(c.X, c.Y, p.GetBoundingBox(True).Min.Z)
                cp = p.ClosestPoint(q)
                if cp.DistanceTo(q) < tol * 10:
                    covered = True
                    break
            if not covered:
                area -= abs(amp.Area)
    return area

def _area(breps):
    import Rhino.Geometry as rg
    t = 0.0
    for b in breps:
        mp = rg.AreaMassProperties.Compute(b)
        if mp:
            t += mp.Area
    return t

def build(Mass, Plot, Floor, First, North, Units=1.0, tol=0.001):
    import Rhino.Geometry as rg
    breps = _as_breps(Mass)
    if not breps:
        raise ValueError("Nothing to measure: connect closed breps/meshes to Mass")
    if len(breps) > 1:                    # merge overlapping / stacked masses first
        un = rg.Brep.CreateBooleanUnion(breps, tol)
        if un:
            breps = list(un)
    u = float(Units) or 1.0
    m2 = 1.0 / (u * u)
    bb = rg.BoundingBox.Empty
    for b in breps:
        bb.Union(b.GetBoundingBox(True))
    levels = level_heights(bb.Min.Z, bb.Max.Z, First * u, Floor * u, 2.0 * u)
    plates, floor_gfa = [], []
    for i, z in enumerate(levels):
        regs = _plates_at(breps, z + 0.05 * u, tol)
        for r in regs:
            r.Translate(0, 0, -0.05 * u)
        plates.extend(regs)
        floor_gfa.append(_area(regs) * m2)
    ground = _plates_at(breps, bb.Min.Z + 0.05 * u, tol)
    footprint = _area(ground) * m2
    projected = max(_projected(plates, ground, tol) * m2, footprint)
    volume = sum(abs(rg.VolumeMassProperties.Compute(b).Volume) for b in breps
                 if b.IsSolid) / (u ** 3)
    envelope = sum(_area([b]) for b in breps) * m2
    normals, areas = [], []
    mp = rg.MeshingParameters.Default
    for b in breps:
        for ms in (rg.Mesh.CreateFromBrep(b, mp) or []):
            ms.Faces.ConvertQuadsToTriangles(); ms.FaceNormals.ComputeFaceNormals()
            for i in range(ms.Faces.Count):
                f = ms.Faces[i]
                a, bb_, c = ms.Vertices[f.A], ms.Vertices[f.B], ms.Vertices[f.C]
                ar = 0.5 * rg.Vector3d.CrossProduct(rg.Vector3d(bb_ - a), rg.Vector3d(c - a)).Length
                n = ms.FaceNormals[i]
                normals.append((n.X, n.Y, n.Z)); areas.append(ar * m2)
    facade, roof = facade_bins(normals, areas, North)
    plot = None
    if Plot is not None:
        pc = Plot if isinstance(Plot, rg.Curve) else None
        if pc is not None and pc.IsClosed:
            plot = abs(rg.AreaMassProperties.Compute(pc).Area) * m2
    m = assemble(floor_gfa, [z / u for z in levels], footprint, projected, plot, volume,
                 envelope, facade, roof)
    try:
        import scriptcontext as sc
        sc.sticky["M003_metrics"] = m
    except Exception:
        pass
    return plates, levels, m, summary(m)

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
    key = "M003_density"
    v = dict(DEFAULTS); v.update(sc.sticky.get(key, {}))
    ft = Rhino.DocObjects.ObjectType
    go = GetObject()
    go.SetCommandPrompt("Select building masses")
    go.GeometryFilter = ft.Brep | ft.Extrusion | ft.Mesh
    od = dict((k, OptionDouble(float(v[k]))) for k in ("Floor", "First", "North"))
    ob = OptionToggle(bool(v["Bake"]), "No", "Yes")
    for k, lab in (("Floor", "FloorHeight"), ("First", "GroundFloorHeight"), ("North", "NorthAngle")):
        go.AddOptionDouble(lab, od[k])
    go.AddOptionToggle("BakePlates", ob)
    while True:
        res = go.GetMultiple(1, 0)
        if res == Rhino.Input.GetResult.Option:
            go.EnablePreSelect(False, True)
            continue
        if res != Rhino.Input.GetResult.Object:
            return
        break
    mass = [go.Object(i).Geometry() for i in range(go.ObjectCount)]
    for k in od:
        v[k] = od[k].CurrentValue
    v["Bake"] = ob.CurrentValue
    sc.sticky[key] = v
    pid = rs.GetObject("Select plot boundary curve (Enter = none)", rs.filter.curve, preselect=False)
    plot = rs.coercecurve(pid) if pid else None
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        plates, levels, m, info = build(mass, plot, v["Floor"], v["First"], v["North"], f,
                                        sc.doc.ModelAbsoluteTolerance)
    except ValueError as e:
        print("Density: {0}".format(e))
        return
    _layer(sc.doc, "M003", (120, 120, 120))
    ids = []
    if v["Bake"]:
        a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = _layer(sc.doc, "Plates", PLATE_RGB, "M003")
        ids += [sc.doc.Objects.AddBrep(p, a) for p in plates]
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = _layer(sc.doc, "Report", REPORT_RGB, "M003")
    if plot is not None:
        c = Rhino.Geometry.AreaMassProperties.Compute(plot).Centroid
    else:
        bb = plates[0].GetBoundingBox(True) if plates else Rhino.Geometry.BoundingBox.Empty
        c = bb.Center
    f2 = lambda x, d=2: "-" if x is None else ("{0:." + str(d) + "f}").format(x)
    txt = "GFA {0:,.0f} m2\nFSI {1}  GSI {2}\nOSR {3}  L {4}".format(
        m["gfa"], f2(m["fsi"]), f2(m["gsi"]), f2(m["osr"]), f2(m["L"], 1))
    ids.append(sc.doc.Objects.AddTextDot(Rhino.Geometry.TextDot(txt, c), a))
    grp = rs.AddGroup(); rs.AddObjectsToGroup([i for i in ids if i], grp)
    sc.doc.Views.Redraw()
    print(info)
    for z, g in zip(m["levels"], m["floor_gfa"]):
        print("  level {0:7.2f} m : {1:9,.0f} m2".format(z, g))

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    _keys = ("gfa", "fsi", "gsi", "osr", "L", "footprint", "projected", "plot_area",
             "volume", "envelope", "form_factor", "facade", "roof", "floor_gfa")
    if globals().get("Mass") is None:
        plates, levels, metrics, info = [], [], {}, "Connect masses to Mass (and a plot curve to Plot)"
        gfa = fsi = gsi = osr = L = footprint = projected = plot_area = None
        volume = envelope = form_factor = roof = None
        facade, floor_gfa = [], []
    else:
        plates, levels, metrics, info = build(globals().get("Mass"), globals().get("Plot"),
                                              *[_gh_value(k) for k in ("Floor", "First", "North", "Units")])
        (gfa, fsi, gsi, osr, L, footprint, projected, plot_area, volume, envelope,
         form_factor, facade, roof, floor_gfa) = [metrics[k] for k in _keys]
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        print(level_heights(0, 30, 4.0, 3.2))
        print(spacemate(12000, 1500, 4000), building_type(8.0, 0.375))
        print(facade_bins([(0, 1, 0), (1, 0, 0), (0, -1, 0), (-1, 0, 0), (0, 0, 1)], [1, 2, 3, 4, 5]))
