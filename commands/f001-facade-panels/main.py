"""
F001  Facade Panelizer  (with flat / warped check)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: FacadePanels).

Splits a surface into a grid of quad panels close to a target size, measures how
warped each panel is (distance between its two diagonals) and sorts them into
flat (buildable as flat glass/sheet) and warped panels.

GH INPUTS:
    S    : Surface/Brep  facade surface (single face)
    W    : float  target panel width  in model units   (default 1.5)
    Hp   : float  target panel height in model units   (default 1.5)
    J    : float  joint width between panels           (default 0.02)
    Tol  : float  max warp to count as flat             (default 0.005)
    Flip : bool   swap U/V directions                   (default False)

GH OUTPUTS:
    panels, flat, warped, warp, info
    (warp = list of warp values, same order as panels)

RHINO COMMAND / ALIAS:
    Alias  FacadePanels  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\F001_facade_panelizer.py"
    Pick a surface; options are in METRES (Tol in mm) and are remembered;
    panels bake to layers F001::Flat (green) and F001::Warped (red), grouped.
"""
from __future__ import division, print_function
import math

# ---------------------------------------------------------------- pure math
def _sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def _dot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def _cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def _len(a): return math.sqrt(_dot(a, a))

def quad_warp(p0, p1, p2, p3):
    """Warp of quad p0-p1-p2-p3 (in order): shortest distance between the
    diagonals p0-p2 and p1-p3. 0 for a perfectly flat panel."""
    d1, d2 = _sub(p2, p0), _sub(p3, p1)
    n = _cross(d1, d2)
    ln = _len(n)
    if ln < 1e-12:                      # parallel diagonals (degenerate)
        return 0.0
    return abs(_dot(_sub(p1, p0), n)) / ln

def grid_counts(len_u, len_v, W, Hp):
    """Number of panels along U and V, as close as possible to target size."""
    if W <= 0 or Hp <= 0:
        raise ValueError("Panel sizes must be > 0")
    return max(1, int(round(len_u / W))), max(1, int(round(len_v / Hp)))

def shrink(pts, J):
    """Pull quad corners toward the centroid so panels leave a joint ~J wide."""
    if not J:
        return pts
    c = tuple(sum(p[i] for p in pts) / 4.0 for i in range(3))
    out = []
    for p in pts:
        v = _sub(p, c)
        L = _len(v)
        # corner sits on a diagonal: move J/2*sqrt(2) to open J/2 each side
        k = max(0.0, (L - J / 2.0 * math.sqrt(2)) / L) if L > 0 else 1.0
        out.append((c[0] + v[0]*k, c[1] + v[1]*k, c[2] + v[2]*k))
    return out

def summary(warps, Tol):
    flat = sum(1 for w in warps if w <= Tol)
    mx = max(warps) if warps else 0.0
    return ("Panels: {0} | Flat: {1} | Warped: {2} | Max warp: {3:.4f}"
            .format(len(warps), flat, len(warps) - flat, mx))

# ------------------------------------------------------------ rhino geometry
def _face(S):
    import Rhino.Geometry as rg
    if isinstance(S, rg.Brep):
        return S.Faces[0]
    if isinstance(S, rg.Surface):
        return S
    raise ValueError("Input must be a surface or single-face brep")

def build(S, W, Hp, J, Tol, Flip, tol=0.001):
    import Rhino.Geometry as rg
    srf = _face(S)
    if Flip:
        srf = srf.Transpose()
    du, dv = srf.Domain(0), srf.Domain(1)
    # measure real lengths along the middle isocurves
    len_u = srf.IsoCurve(0, dv.Mid).GetLength()
    len_v = srf.IsoCurve(1, du.Mid).GetLength()
    nu, nv = grid_counts(len_u, len_v, W, Hp)
    P = [[srf.PointAt(du.ParameterAt(i / nu), dv.ParameterAt(j / nv))
          for j in range(nv + 1)] for i in range(nu + 1)]
    panels, flat, warped, warps = [], [], [], []
    for i in range(nu):
        for j in range(nv):
            q = [P[i][j], P[i+1][j], P[i+1][j+1], P[i][j+1]]
            t = [(p.X, p.Y, p.Z) for p in q]
            w = quad_warp(*t)
            t = shrink(t, J)
            c = [rg.Point3d(*p) for p in t]
            b = rg.Brep.CreateFromCornerPoints(c[0], c[1], c[2], c[3], tol)
            if b is None:
                continue
            panels.append(b); warps.append(w)
            (flat if w <= Tol else warped).append(b)
    return panels, flat, warped, warps, summary(warps, Tol)

# ------------------------------------------------------------- entry points
DEFAULTS = dict(W=1.5, Hp=1.5, J=0.02, Tol=0.005, Flip=False)

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
    """Rhino command: pick surface, edit options, bake to Flat/Warped layers."""
    import Rhino
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    from Rhino.Input.Custom import GetObject, OptionDouble, OptionToggle
    key = "F001_facade_panelizer"
    v = dict(DEFAULTS)
    v.update(sc.sticky.get(key, {}))
    shown = dict(v); shown["Tol"] = v["Tol"] * 1000.0      # mm on screen
    labels = [("W", "PanelWidth"), ("Hp", "PanelHeight"),
              ("J", "Joint"), ("Tol", "FlatToleranceMM")]
    go = GetObject()
    go.SetCommandPrompt("Select facade surface")
    go.GeometryFilter = Rhino.DocObjects.ObjectType.Surface
    go.SubObjectSelect = True
    opts = {}
    for k, lab in labels:
        opts[k] = OptionDouble(float(shown[k]))
        go.AddOptionDouble(lab, opts[k])
    opt_flip = OptionToggle(bool(v["Flip"]), "No", "Yes")
    go.AddOptionToggle("SwapUV", opt_flip)
    while True:
        res = go.Get()
        if res == Rhino.Input.GetResult.Option:
            continue
        if res != Rhino.Input.GetResult.Object:
            return
        break
    face = go.Object(0).Face()
    for k, _ in labels:
        v[k] = opts[k].CurrentValue
    v["Tol"] = v["Tol"] / 1000.0
    v["Flip"] = opt_flip.CurrentValue
    sc.sticky[key] = v
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        panels, flat, warped, warps, info = build(
            face, v["W"] * f, v["Hp"] * f, v["J"] * f, v["Tol"] * f,
            v["Flip"], sc.doc.ModelAbsoluteTolerance)
    except ValueError as e:
        print("FacadePanels: {0}".format(e))
        return
    _layer(sc.doc, "F001", (120, 120, 120))
    lf = _layer(sc.doc, "Flat", (60, 170, 90), "F001")
    lw = _layer(sc.doc, "Warped", (220, 70, 60), "F001")
    rs.EnableRedraw(False)
    ids = []
    for b in flat:
        a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = lf
        ids.append(sc.doc.Objects.AddBrep(b, a))
    for b in warped:
        a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = lw
        ids.append(sc.doc.Objects.AddBrep(b, a))
    grp = rs.AddGroup()
    rs.AddObjectsToGroup([i for i in ids if i], grp)
    rs.EnableRedraw(True)
    sc.doc.Views.Redraw()
    # report warp in mm regardless of doc units
    print(info.replace("Max warp: ", "Max warp (doc units): "))

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    _S = globals().get("S")
    if _S is None:
        panels, flat, warped, warp, info = [], [], [], [], "Connect a surface to S"
    else:
        panels, flat, warped, warp, info = build(
            _S, *[_gh_value(k) for k in ("W", "Hp", "J", "Tol", "Flip")])
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:                    # plain Python: maths self-test
        print(quad_warp((0,0,0),(1,0,0),(1,1,0),(0,1,0)))      # flat -> 0
        print(round(quad_warp((0,0,0),(1,0,0),(1,1,0.1),(0,1,0)), 4))  # 0.1 lifted corner
        print(grid_counts(30.0, 18.0, 1.5, 1.5))
