"""
S001  Spiral Staircase Generator
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a plain Rhino script/command (prompts for values, bakes geometry).

GH INPUTS (all optional, set type hints accordingly):
    C   : Point3d  base centre                         (default 0,0,0)
    Ro  : float    outer radius                        (default 1.0)
    Ri  : float    inner / column radius               (default 0.1)
    H   : float    floor-to-floor height               (default 3.0)
    Rmax: float    max riser height                    (default 0.19)
    Rot : float    total rotation in degrees           (default 360)
    T   : float    tread thickness                     (default 0.05)
    Ov  : float    tread overlap in degrees (nosing)   (default 2)
    CW  : bool     clockwise ascent                    (default False)
    Hr  : float    handrail height above nosing        (default 0.9)
    Pr  : float    handrail pipe radius, 0 = curve only (default 0.025)

GH OUTPUTS:
    treads, column, rail, balusters, info

RHINO COMMAND / ALIAS:
    Alias  SpiralStair  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\S001_spiral_staircase.py"
    Click a base point; set options on the command line in METRES (values are
    remembered; output is scaled to the document units).
"""
from __future__ import division, print_function
import math

# ---------------------------------------------------------------- pure math
def compute_layout(H=3.0, Rmax=0.19, Rot=360.0, Ro=1.0, Ri=0.1, CW=False):
    """Rhino-free stair maths. Returns dict; testable in any Python."""
    if H <= 0 or Rmax <= 0:
        raise ValueError("H and Rmax must be > 0")
    if Ri >= Ro:
        raise ValueError("Inner radius must be smaller than outer radius")
    risers = int(math.ceil(H / Rmax - 1e-9))
    riser = H / risers
    treads = risers - 1                      # top floor slab is the last step
    if treads < 1:
        raise ValueError("Height too low for a stair")
    step_ang = math.radians(Rot) / treads
    sign = -1.0 if CW else 1.0
    walk_r = Ri + (Ro - Ri) * 2.0 / 3.0      # walkline at 2/3 of tread width
    going = walk_r * abs(step_ang)
    steps = []
    for i in range(treads):
        a0 = sign * i * step_ang
        a1 = sign * (i + 1) * step_ang
        steps.append((a0, a1, (i + 1) * riser))   # top-of-tread height
    return dict(risers=risers, riser=riser, treads=treads,
                step_ang=step_ang, going=going, walk_r=walk_r,
                blondel=2 * riser + going, steps=steps, sign=sign)

# ------------------------------------------------------------ rhino geometry
def build(C, Ro, Ri, H, Rmax, Rot, T, Ov, CW, Hr, Pr, tol=0.001):
    import Rhino.Geometry as rg
    L = compute_layout(H, Rmax, Rot, Ro, Ri, CW)
    ov = math.radians(Ov) * L["sign"]
    treads = []
    for (a0, a1, z) in L["steps"]:
        a1o = a1 + ov
        pl = rg.Plane(rg.Point3d(C.X, C.Y, C.Z + z), rg.Vector3d.ZAxis)
        def pt(r, a):
            return pl.PointAt(r * math.cos(a), r * math.sin(a))
        am = (a0 + a1o) / 2.0
        outer = rg.Arc(pt(Ro, a0), pt(Ro, am), pt(Ro, a1o)).ToNurbsCurve()
        inner = rg.Arc(pt(Ri, a1o), pt(Ri, am), pt(Ri, a0)).ToNurbsCurve()
        pc = rg.PolyCurve()
        pc.Append(outer)
        pc.Append(rg.Line(pt(Ro, a1o), pt(Ri, a1o)))
        pc.Append(inner)
        pc.Append(rg.Line(pt(Ri, a0), pt(Ro, a0)))
        srf = rg.Surface.CreateExtrusion(pc, rg.Vector3d(0, 0, -T))
        b = srf.ToBrep().CapPlanarHoles(tol) if srf else None
        if b:
            treads.append(b)
    # central column
    base = rg.Plane(C, rg.Vector3d.ZAxis)
    column = rg.Cylinder(rg.Circle(base, Ri), H).ToBrep(True, True)
    # handrail: helix through outer nosings, inset by 0.05
    rr = Ro - 0.05
    pts = []
    n = max(24, L["treads"] * 4)
    a_end = L["sign"] * L["treads"] * L["step_ang"]
    z0, z1 = L["riser"] + Hr, L["treads"] * L["riser"] + Hr
    for k in range(n + 1):
        t = k / n
        a = a_end * t
        pts.append(rg.Point3d(C.X + rr * math.cos(a), C.Y + rr * math.sin(a),
                              C.Z + z0 + (z1 - z0) * t))
    rail = rg.Curve.CreateInterpolatedCurve(pts, 3)
    # balusters: one per tread, from tread top up to the rail centreline
    balusters = []
    for (a0, a1, z) in L["steps"]:
        am = (a0 + a1) / 2.0
        t = am / a_end
        top = z0 + (z1 - z0) * t
        bpl = rg.Plane(rg.Point3d(C.X + rr * math.cos(am), C.Y + rr * math.sin(am),
                                  C.Z + z), rg.Vector3d.ZAxis)
        balusters.append(rg.Cylinder(rg.Circle(bpl, 0.008), top - z).ToBrep(True, True))
    if Pr and Pr > 0:
        pipes = rg.Brep.CreatePipe(rail, Pr, False, rg.PipeCapMode.Round,
                                   True, tol, math.radians(1))
        if pipes:
            rail = pipes[0]
    info = ("Risers: {0} x {1:.3f} m | Treads: {2} | Going @ walkline: {3:.3f} m"
            " | 2R+G: {4:.3f} m (comfort ~0.60-0.65)").format(
        L["risers"], L["riser"], L["treads"], L["going"], L["blondel"])
    return treads, column, rail, balusters, info

# ------------------------------------------------------------- entry points
DEFAULTS = dict(Ro=1.0, Ri=0.1, H=3.0, Rmax=0.19, Rot=360.0,
                T=0.05, Ov=2.0, CW=False, Hr=0.9, Pr=0.025)

def _gh_value(name):
    v = globals().get(name)
    return DEFAULTS[name] if v is None else v

def run_command():
    """Rhino command: pick base point, edit options on the command line, bake."""
    import Rhino
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    import Rhino.Geometry as rg
    from Rhino.Input.Custom import GetPoint, OptionDouble, OptionToggle
    key = "S001_spiral_stair"
    v = dict(DEFAULTS)
    v.update(sc.sticky.get(key, {}))
    labels = [("Ro", "OuterRadius"), ("Ri", "ColumnRadius"), ("H", "Height"),
              ("Rmax", "MaxRiser"), ("Rot", "Rotation"), ("T", "TreadThickness"),
              ("Ov", "Overlap"), ("Hr", "HandrailHeight"), ("Pr", "RailRadius")]
    gp = GetPoint()
    gp.SetCommandPrompt("Base centre of spiral stair")
    opts = {}
    for k, lab in labels:
        opts[k] = OptionDouble(float(v[k]))
        gp.AddOptionDouble(lab, opts[k])
    opt_cw = OptionToggle(bool(v["CW"]), "CCW", "CW")
    gp.AddOptionToggle("Direction", opt_cw)
    while True:
        res = gp.Get()
        if res == Rhino.Input.GetResult.Option:
            continue
        if res != Rhino.Input.GetResult.Point:
            return
        break
    C = gp.Point()
    for k, _ in labels:
        v[k] = opts[k].CurrentValue
    v["CW"] = opt_cw.CurrentValue
    sc.sticky[key] = v
    # options are in metres; scale result to the document's units (mm, cm, ...)
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        treads, column, rail, balusters, info = build(
            C, v["Ro"], v["Ri"], v["H"], v["Rmax"], v["Rot"], v["T"], v["Ov"],
            v["CW"], v["Hr"], v["Pr"], sc.doc.ModelAbsoluteTolerance / f)
    except ValueError as e:
        print("SpiralStair: {0}".format(e))
        return
    if abs(f - 1.0) > 1e-9:
        xf = rg.Transform.Scale(rg.Point3d(C), f)
        for g in treads + [column, rail] + balusters:
            g.Transform(xf)
    rs.EnableRedraw(False)
    ids = [sc.doc.Objects.AddBrep(b) for b in treads + [column] + balusters]
    if isinstance(rail, rg.Brep):
        ids.append(sc.doc.Objects.AddBrep(rail))
    else:
        ids.append(sc.doc.Objects.AddCurve(rail))
    grp = rs.AddGroup()
    rs.AddObjectsToGroup([i for i in ids if i], grp)
    rs.EnableRedraw(True)
    sc.doc.Views.Redraw()
    print(info)

try:
    ghenv  # noqa: F821  (exists only inside Grasshopper)
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    import Rhino.Geometry as _rg
    _C = globals().get("C") or _rg.Point3d.Origin
    treads, column, rail, balusters, info = build(
        _C, *[_gh_value(k) for k in ("Ro", "Ri", "H", "Rmax", "Rot",
                                     "T", "Ov", "CW", "Hr", "Pr")])
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:                     # plain Python: maths self-test
        L = compute_layout()
        print(L["risers"], round(L["riser"], 4), L["treads"],
              round(L["going"], 4), round(L["blondel"], 4))
