"""
M004  Pixelate massing  (cube voxels or tetrahedral grid)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: Pixelate).

Turns any closed massing (Breps, extrusions, meshes; several may overlap) into
pixels on a WORLD-aligned grid, so separate masses pixelate on the same grid:
    Cube  : box voxels Size x Size x Height
    Tri   : triangle grid in plan (equilateral, side Size), each triangle extruded
            Height -> triangular-prism pixels, alternating up / down
    Stagger : the Tri pixels, but every floor shifted by (s/2, s*sqrt3/6) in an
            A-B-C cycle (tetrahedral close-packing order), so each pixel sits over
            the joints of the floor below, like brickwork. Always separate prisms.
    CubeStagger : cubes with every other floor shifted (s/2, s/2), so each cube
            sits over the corners of 4 cubes below. Always separate cubes.
    Tetra : each grid cube split into 6 congruent tetrahedra (Kuhn / Freudenthal
            triangulation, a conforming space-filling tetrahedral grid) and each
            tetrahedron kept on its own -> faceted, diagonal "pixel" look
A pixel is kept when its centre lies inside the massing (vertical ray parity per
column, one ray per column x offset; overlapping masses are unioned).

Gap = 1 gives one clean solid skin (only the faces between full and empty pixels);
Gap < 1 shrinks every pixel about its centre so each one reads separately.

GH INPUTS:
    Mass   : closed Brep(s) / Extrusion(s) / Mesh(es)
    Size   : float  pixel size in plan, metres (default 3.0)
    Height : float  pixel height, metres (0 = same as Size; e.g. 3.5 = floor height)
    Mode   : int or str  0 / "cube" (default)  |  1 / "tetra"  |  2 / "tri"  |  3 / "stagger"  |  4 / "cubestagger"
    Gap    : float  0.1..1, pixel scale (default 1.0 = solid skin)
    Colour : bool   colour by height (default False = white massing)
    Units  : float  model units per metre (default 1; mm model = 1000)

GH OUTPUTS:
    mesh    : pixelated mesh
    centres : pixel centre points
    cells   : pixel indices "i,j,k" (cube) or "i,j,k,t" (tetra: tet 0-5, tri/stagger: 0 up / 1 down)
    count   : number of pixels
    volume  : pixelated volume, m3
    info    : summary text
    (plain data also in sc.sticky["M004_pixels"] for downstream tools)

RHINO COMMAND / ALIAS:
    Alias  Pixelate  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\M004_pixelate.py"
    Select masses, Enter. Options (metres): Mode Cube/Tetra/Tri/Stagger/CubeStagger, SizeMetres,
    HeightMetres (0 = Size), Gap, ColourByHeight, HideInput, Capture, ZoomToResult.
    Bakes one mesh on layer M004::Cube / Tetra / Tri / Stagger / CubeStagger, grouped.
    Capture=Yes (default) saves a PNG of the active viewport (2x its size, current
    display mode, no grid/axes) with a caption strip (command, settings, pixel count,
    volume, date, file). ZoomToResult=Yes zooms to the new mesh for the shot and puts
    your camera back afterwards. Saved to <your .3dm folder>/captures/, or to
    Desktop/GH-Library captures/ if the file is unsaved; the path prints on the command line.
    Tip: point captures/ at a synced Google Drive folder by saving the .3dm there.
"""
from __future__ import division, print_function
import math

DEFAULTS = dict(Size=3.0, Height=0.0, Mode=0, Gap=1.0, Colour=False, Units=1.0, Hide=False,
                Capture=True, Zoom=True)

# MVRDV-ish ramp for colour by height: blue, green, yellow, orange, magenta
RAMP = [(0, 133, 255), (120, 220, 90), (255, 210, 0), (255, 120, 0), (230, 0, 126)]

# Kuhn decomposition of the unit cube along the main diagonal (0,0,0)-(1,1,1):
# one tetrahedron per axis order -> 6 congruent tets, conforming between cubes.
def _kuhn():
    out = []
    for p in ((0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)):
        c = [0, 0, 0]
        tet = [tuple(c)]
        for ax in p:
            c[ax] = 1
            tet.append(tuple(c))
        out.append(tet)
    return out
KUHN = _kuhn()
CUBE_CORNERS = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
CUBE_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
TET_FACES = [(0, 1, 2), (0, 1, 3), (0, 2, 3), (1, 2, 3)]
# triangle grid in plan (skewed lattice a, b: x = (a + b/2) s, y = b s sqrt3/2), prism per floor
TRI_CORNERS = [[(0, 0), (1, 0), (0, 1)], [(1, 0), (1, 1), (0, 1)]]      # up, down
PRISM_FACES = [(0, 1, 2), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)]
SQ3 = math.sqrt(3.0) / 2.0
MODE_NAMES = ["Cube", "Tetra", "Tri", "Stagger", "CubeStagger"]

def cube_shift(k, sx):
    """Odd floors move (s/2, s/2): every cube sits on the corners of 4 cubes below."""
    return (sx / 2.0, sx / 2.0) if k % 2 else (0.0, 0.0)

def stagger_shift(k, sx):
    """ABC stacking: floor k moves (k mod 3) x (s/2, s sqrt3/6), i.e. onto the triangle centroids below."""
    p = k % 3
    return (p * sx / 2.0, p * sx * SQ3 / 3.0)

def parse_mode(m):
    """0 cube | 1 tetra | 2 tri (triangular prisms)."""
    if isinstance(m, str):
        t = m.strip().lower()
        if t.startswith("cubest") or t.startswith("cube_st") or t.startswith("cube st"):
            return 4
        return 3 if t.startswith("st") else (2 if t.startswith("tri") else (1 if t.startswith("te") else 0))
    try:
        return max(0, min(4, int(m)))
    except (TypeError, ValueError):
        return 0

def centre_offsets(mode):
    """Pixel centre offsets inside one grid cube, in cube units: [(t, (u, v, w))]."""
    if mode == 0:
        return [(0, (0.5, 0.5, 0.5))]
    out = []
    for t, tet in enumerate(KUHN):
        out.append((t, tuple(sum(p[a] for p in tet) / 4.0 for a in range(3))))
    return out

def hits_to_intervals(zs, eps):
    """Sorted ray hits -> inside intervals [(z0, z1)] by parity (near-duplicates merged)."""
    zs = sorted(zs)
    clean = []
    for z in zs:
        if clean and abs(z - clean[-1]) < eps:
            clean.pop()                      # double hit on a shared edge: count once
            clean.append(z)
            continue
        clean.append(z)
    return [(clean[i], clean[i + 1]) for i in range(0, len(clean) - 1, 2)]

def union_intervals(iv):
    iv = sorted(iv)
    out = []
    for a, b in iv:
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out

def grid_range(lo, hi, s):
    return int(math.floor(lo / s)), int(math.ceil(hi / s))

def pixelate(intervals_fn, bbox, sx, sz, mode=0, jitter=1e-5):
    """intervals_fn(x, y) -> [(z0, z1)] inside intervals of the massing along a vertical line.
    bbox = ((x0, y0, z0), (x1, y1, z1)). Returns cells: [(i, j, k, t)] world grid indices."""
    if sx <= 0 or sz <= 0:
        raise ValueError("Pixel size must be > 0")
    (x0, y0, z0), (x1, y1, z1) = bbox
    cols = []                                       # (i, j, t, x, y, w, phase)
    if mode in (2, 3):
        h = sx * SQ3
        for ph in ((None,) if mode == 2 else (0, 1, 2)):
            dx, dy = (0.0, 0.0) if ph is None else stagger_shift(ph, sx)
            j0, j1 = grid_range(y0 - dy, y1 - dy, h)
            for j in range(j0, j1):
                i0 = int(math.floor((x0 - dx - (j + 1) * sx / 2.0) / sx)) - 1
                i1 = int(math.ceil((x1 - dx - j * sx / 2.0) / sx)) + 1
                for i in range(i0, i1):
                    for t, (u, v) in enumerate(((1 / 3.0, 1 / 3.0), (2 / 3.0, 2 / 3.0))):
                        a, b = i + u, j + v
                        cols.append((i, j, t, (a + b / 2.0 + jitter) * sx + dx, (b + 1.7 * jitter) * h + dy, 0.5, ph))
    elif mode == 4:
        for ph in (0, 1):
            dx, dy = cube_shift(ph, sx)
            i0, i1 = grid_range(x0 - dx, x1 - dx, sx)
            j0, j1 = grid_range(y0 - dy, y1 - dy, sx)
            for i in range(i0, i1):
                for j in range(j0, j1):
                    cols.append((i, j, 0, (i + 0.5 + jitter) * sx + dx, (j + 0.5 + 1.7 * jitter) * sx + dy, 0.5, ph))
    else:
        i0, i1 = grid_range(x0, x1, sx)
        j0, j1 = grid_range(y0, y1, sx)
        for i in range(i0, i1):
            for j in range(j0, j1):
                for t, (u, v, w) in centre_offsets(mode):
                    cols.append((i, j, t, (i + u + jitter) * sx, (j + v + 1.7 * jitter) * sx, w, None))
    if len(cols) > 2400000:
        raise ValueError("Too many columns ({0}); use a bigger pixel size".format(len(cols)))
    cells = []
    if True:
        for i, j, t, x, y, w, ph in cols:
            if True:
                for a, b in intervals_fn(x, y):
                    k0 = int(math.ceil(a / sz - w))
                    k1 = int(math.floor(b / sz - w))
                    for k in range(k0, k1 + 1):
                        zc = (k + w) * sz
                        if ph is not None and k % (2 if mode == 4 else 3) != ph:
                            continue
                        if a < zc < b:
                            cells.append((i, j, k, t))
    return sorted(set(cells))

def stagger_points(cell, sx, sz):
    """6 xyz corners of a staggered triangular prism pixel (bottom 3, top 3)."""
    i, j, k, t = cell
    dx, dy = stagger_shift(k, sx)
    out = []
    for z in (k * sz, (k + 1) * sz):
        for a, b in TRI_CORNERS[t]:
            out.append(((i + a + (j + b) / 2.0) * sx + dx, (j + b) * sx * SQ3 + dy, z))
    return out

def cell_corners(cell, mode):
    """Lattice corners (integer keys) of a pixel."""
    i, j, k, t = cell
    if mode == 2:
        tri = TRI_CORNERS[t]
        return [(i + a, j + b, k) for a, b in tri] + [(i + a, j + b, k + 1) for a, b in tri]
    base = CUBE_CORNERS if mode == 0 else KUHN[t]
    return [(i + a, j + b, k + c) for a, b, c in base]

def lattice_point(key, sx, sz, mode):
    if mode == 2:
        return ((key[0] + key[1] / 2.0) * sx, key[1] * sx * SQ3, key[2] * sz)
    return (key[0] * sx, key[1] * sx, key[2] * sz)

def face_list(mode):
    return CUBE_FACES if mode in (0, 4) else (TET_FACES if mode == 1 else PRISM_FACES)

def corner_points(cell, sx, sz, mode):
    if mode == 3:
        return stagger_points(cell, sx, sz)
    if mode == 4:
        i, j, k, t = cell
        dx, dy = cube_shift(k, sx)
        return [((i + a) * sx + dx, (j + b) * sx + dy, (k + c) * sz) for a, b, c in CUBE_CORNERS]
    return [lattice_point(q, sx, sz, mode) for q in cell_corners(cell, mode)]

def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _cross(a, b): return (a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0])
def _dot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]

def pixel_mesh(cells, sx, sz, mode=0, gap=1.0):
    """Mesh data (vertices xyz, faces as index tuples, outward). gap >= 1: welded outer skin
    only; gap < 1: every pixel shrunk about its centroid, closed on its own."""
    fl = face_list(mode)
    P = lambda key: lattice_point(key, sx, sz, mode)
    verts, faces = [], []
    if gap >= 1.0 - 1e-9 and mode not in (3, 4):          # stagger layers don't share faces: always separate prisms
        count, owner = {}, {}
        for c in cells:
            cs = cell_corners(c, mode)
            cen = tuple(sum(q[a] for q in cs) / len(cs) for a in range(3))
            for f in fl:
                keys = [cs[n] for n in f]
                fk = tuple(sorted(keys))
                count[fk] = count.get(fk, 0) + 1
                owner[fk] = (keys, cen)
        vid = {}
        for fk, n in count.items():
            if n != 1:
                continue
            keys, cen = owner[fk]
            pts = [P(q) for q in keys]
            nrm = _cross(_sub(pts[1], pts[0]), _sub(pts[2], pts[0]))
            fc = tuple(sum(p[a] for p in pts) / len(pts) for a in range(3))
            if _dot(nrm, _sub(fc, P(cen))) < 0:
                keys = keys[::-1]
            idx = []
            for q in keys:
                if q not in vid:
                    vid[q] = len(verts)
                    verts.append(P(q))
                idx.append(vid[q])
            faces.append(tuple(idx))
        return verts, faces
    g = max(0.05, min(1.0, gap))
    for c in cells:
        cs = corner_points(c, sx, sz, mode)
        cen = tuple(sum(p[a] for p in cs) / len(cs) for a in range(3))
        b = len(verts)
        for p in cs:
            verts.append(tuple(cen[a] + (p[a] - cen[a]) * g for a in range(3)))
        for f in fl:
            pts = [verts[b + n] for n in f]
            nrm = _cross(_sub(pts[1], pts[0]), _sub(pts[2], pts[0]))
            fc = tuple(sum(p[a] for p in pts) / len(pts) for a in range(3))
            ff = f if _dot(nrm, _sub(fc, cen)) >= 0 else f[::-1]
            faces.append(tuple(b + n for n in ff))
    return verts, faces

def cell_centre(cell, sx, sz, mode):
    ps = corner_points(cell, sx, sz, mode)
    return tuple(sum(p[a] for p in ps) / len(ps) for a in range(3))

def pixel_volume(sx, sz, mode):
    if mode in (2, 3):
        return sx * sx * SQ3 / 2.0 * sz
    return sx * sx * sz / (1.0 if mode in (0, 4) else 6.0)

def ramp(t):
    t = max(0.0, min(1.0, t)) * (len(RAMP) - 1)
    i = min(int(t), len(RAMP) - 2)
    u = t - i
    return tuple(int(RAMP[i][a] + (RAMP[i + 1][a] - RAMP[i][a]) * u) for a in range(3))

def summary(cells, sx, sz, mode, units=1.0):
    n = len(cells)
    v = n * pixel_volume(sx, sz, mode) / units ** 3
    return n, v, "{0}: {1} pixels of {2:.2f} x {2:.2f} x {3:.2f} m | volume {4:.0f} m3".format(
        MODE_NAMES[mode], n, sx / units, sz / units, v)

# ------------------------------------------------------------ rhino geometry
def to_meshes(geo):
    import Rhino.Geometry as rg
    mp = rg.MeshingParameters.Default
    out = []
    for g in geo if isinstance(geo, (list, tuple)) else [geo]:
        if g is None:
            continue
        if hasattr(g, "Geometry"):
            g = g.Geometry
        if isinstance(g, rg.Extrusion):
            g = g.ToBrep()
        if isinstance(g, rg.Surface):
            g = g.ToBrep()
        if isinstance(g, rg.Brep):
            ms = rg.Mesh.CreateFromBrep(g, mp)
            m = rg.Mesh()
            for x in ms or []:
                m.Append(x)
        elif isinstance(g, rg.Mesh):
            m = g.DuplicateMesh()
        else:
            continue
        m.Normals.ComputeNormals()
        out.append(m)
    return out

def build(Mass, Size, Height, Mode, Gap, Colour, Units):
    import Rhino.Geometry as rg
    from Rhino.Geometry.Intersect import Intersection
    import System
    mode = parse_mode(Mode)
    sx = float(Size) * Units
    sz = (float(Height) if Height and float(Height) > 0 else float(Size)) * Units
    meshes = to_meshes(Mass)
    if not meshes:
        raise ValueError("No closed massing given")
    open_n = sum(1 for m in meshes if not m.IsClosed)
    bb = rg.BoundingBox.Empty
    for m in meshes:
        bb.Union(m.GetBoundingBox(True))
    zlo, zhi = bb.Min.Z - sz, bb.Max.Z + sz
    eps = 1e-6 * max(1.0, bb.Diagonal.Length)
    boxes = [m.GetBoundingBox(True) for m in meshes]

    def intervals(x, y):
        iv = []
        ln = rg.Line(rg.Point3d(x, y, zlo), rg.Point3d(x, y, zhi))
        for m, b in zip(meshes, boxes):
            if not (b.Min.X <= x <= b.Max.X and b.Min.Y <= y <= b.Max.Y):
                continue
            r = Intersection.MeshLine(m, ln)
            if isinstance(r, tuple):
                r = r[0]
            if r:
                iv += hits_to_intervals([p.Z for p in r], eps)
        return union_intervals(iv)

    cells = pixelate(intervals, ((bb.Min.X, bb.Min.Y, bb.Min.Z), (bb.Max.X, bb.Max.Y, bb.Max.Z)), sx, sz, mode)
    verts, faces = pixel_mesh(cells, sx, sz, mode, float(Gap))
    mesh = rg.Mesh()
    for p in verts:
        mesh.Vertices.Add(p[0], p[1], p[2])
    for f in faces:
        if len(f) == 4:
            mesh.Faces.AddFace(f[0], f[1], f[2], f[3])
        else:
            mesh.Faces.AddFace(f[0], f[1], f[2])
    if Colour and verts:
        z0 = min(p[2] for p in verts); z1 = max(p[2] for p in verts)
        for p in verts:
            c = ramp((p[2] - z0) / (z1 - z0) if z1 > z0 else 0)
            mesh.VertexColors.Add(System.Drawing.Color.FromArgb(c[0], c[1], c[2]))
    mesh.Normals.ComputeNormals()
    mesh.Compact()
    n, vol, info = summary(cells, sx, sz, mode, Units)
    if open_n:
        info += " | WARNING {0} input mesh(es) not closed: result may be patchy".format(open_n)
    centres = [rg.Point3d(*cell_centre(c, sx, sz, mode)) for c in cells]
    keys = [("{0},{1},{2}".format(*c[:3]) if mode == 0 else "{0},{1},{2},{3}".format(*c)) for c in cells]
    data = dict(mode=MODE_NAMES[mode].lower(), size=sx / Units, height=sz / Units,
                cells=[list(c) for c in cells], count=n, volume=vol)
    try:
        import scriptcontext as sc
        sc.sticky["M004_pixels"] = data
    except Exception:
        pass
    return mesh, centres, keys, n, vol, info

# ------------------------------------------------------------ command
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

# ---- viewport capture (shared snippet: same function goes into other commands) ----
def capture_folder(doc):
    import os
    import System
    path = doc.Path
    if path:
        return os.path.join(os.path.dirname(path), "captures")
    desk = System.Environment.GetFolderPath(System.Environment.SpecialFolder.Desktop)
    return os.path.join(desk, "GH-Library captures")

def capture_view(doc, tag, caption, zoom_ids=None, scale=2.0, folder=None):
    """Save the active viewport as a PNG with a caption strip; returns the path (or None)."""
    import os
    import datetime
    import Rhino
    import System
    import System.Drawing
    import System.Drawing.Text
    import System.Drawing.Imaging
    SD = System.Drawing
    view = doc.Views.ActiveView
    if view is None:
        return None
    vp = view.ActiveViewport
    saved = None
    if zoom_ids:
        saved = Rhino.DocObjects.ViewportInfo(vp)
        bb = Rhino.Geometry.BoundingBox.Empty
        for gid in zoom_ids:
            o = doc.Objects.FindId(gid)
            if o is not None:
                bb.Union(o.Geometry.GetBoundingBox(True))
        if bb.IsValid:
            vp.ZoomBoundingBox(bb)
            view.Redraw()
    try:
        w, h = int(vp.Size.Width * scale), int(vp.Size.Height * scale)
        bmp = None
        try:
            vc = Rhino.Display.ViewCapture()
            vc.Width, vc.Height = w, h
            vc.ScaleScreenItems = False
            vc.DrawAxes = False
            vc.DrawGrid = False
            vc.DrawGridAxes = False
            vc.TransparentBackground = False
            bmp = vc.CaptureToBitmap(view)
        except Exception:
            bmp = None
        if bmp is None:
            bmp = view.CaptureToBitmap(SD.Size(w, h), False, False, False)
        if bmp is None:
            return None
        stamp = datetime.datetime.now()
        lines = [caption, "{0}   {1}".format(stamp.strftime("%Y-%m-%d %H:%M"), doc.Name or "unsaved file")]
        g = SD.Graphics.FromImage(bmp)
        g.TextRenderingHint = SD.Text.TextRenderingHint.AntiAlias
        fs = max(10.0, bmp.Height / 55.0)
        font = SD.Font("Arial", float(fs), SD.FontStyle.Regular, SD.GraphicsUnit.Pixel)
        bold = SD.Font("Arial", float(fs), SD.FontStyle.Bold, SD.GraphicsUnit.Pixel)
        strip = int(fs * 1.5 * len(lines) + fs)
        g.FillRectangle(SD.SolidBrush(SD.Color.FromArgb(235, 255, 255, 255)), 0, bmp.Height - strip, bmp.Width, strip)
        g.FillRectangle(SD.SolidBrush(SD.Color.FromArgb(255, 255, 210, 0)), 0, bmp.Height - strip, int(fs * 0.4), strip)
        ink = SD.SolidBrush(SD.Color.FromArgb(255, 30, 30, 30))
        grey = SD.SolidBrush(SD.Color.FromArgb(255, 110, 110, 110))
        for i, t in enumerate(lines):
            g.DrawString(t, bold if i == 0 else font, ink if i == 0 else grey,
                         SD.PointF(float(fs), float(bmp.Height - strip + fs * 0.5 + i * fs * 1.5)))
        g.Dispose()
        folder = folder or capture_folder(doc)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        path = os.path.join(folder, "{0}_{1}.png".format(tag, stamp.strftime("%Y%m%d_%H%M%S")))
        bmp.Save(path, SD.Imaging.ImageFormat.Png)
        bmp.Dispose()
        return path
    finally:
        if saved is not None:
            vp.SetViewProjection(saved, True)
            view.Redraw()

def run_command():
    import Rhino
    import scriptcontext as sc
    from Rhino.Input.Custom import GetObject, OptionDouble, OptionToggle
    key = "M004_pixelate"
    v = dict(DEFAULTS); v.update(sc.sticky.get(key, {}))
    ft = Rhino.DocObjects.ObjectType
    go = GetObject()
    go.SetCommandPrompt("Select massing to pixelate")
    go.GeometryFilter = ft.Brep | ft.Extrusion | ft.Mesh
    mode = [parse_mode(v["Mode"])]
    o_size = OptionDouble(float(v["Size"]), 0.01, 10000.0)
    o_h = OptionDouble(float(v["Height"]), 0.0, 10000.0)
    o_gap = OptionDouble(float(v["Gap"]), 0.1, 1.0)
    o_col = OptionToggle(bool(v["Colour"]), "No", "Yes")
    o_hide = OptionToggle(bool(v["Hide"]), "No", "Yes")
    o_cap = OptionToggle(bool(v.get("Capture", True)), "No", "Yes")
    o_zoom = OptionToggle(bool(v.get("Zoom", True)), "No", "Yes")
    mode_opt = go.AddOptionList("Mode", MODE_NAMES, mode[0])
    go.AddOptionDouble("SizeMetres", o_size)
    go.AddOptionDouble("HeightMetres", o_h)
    go.AddOptionDouble("Gap", o_gap)
    go.AddOptionToggle("ColourByHeight", o_col)
    go.AddOptionToggle("HideInput", o_hide)
    go.AddOptionToggle("Capture", o_cap)
    go.AddOptionToggle("ZoomToResult", o_zoom)
    while True:
        res = go.GetMultiple(1, 0)
        if res == Rhino.Input.GetResult.Option:
            if go.OptionIndex() == mode_opt:
                mode[0] = go.Option().CurrentListOptionIndex
                go.ClearCommandOptions()
                mode_opt = go.AddOptionList("Mode", MODE_NAMES, mode[0])
                go.AddOptionDouble("SizeMetres", o_size)
                go.AddOptionDouble("HeightMetres", o_h)
                go.AddOptionDouble("Gap", o_gap)
                go.AddOptionToggle("ColourByHeight", o_col)
                go.AddOptionToggle("HideInput", o_hide)
                go.AddOptionToggle("Capture", o_cap)
                go.AddOptionToggle("ZoomToResult", o_zoom)
            go.EnablePreSelect(False, True)
            continue
        if res != Rhino.Input.GetResult.Object:
            return
        break
    objs = [go.Object(i) for i in range(go.ObjectCount)]
    v.update(Mode=mode[0], Size=o_size.CurrentValue, Height=o_h.CurrentValue,
             Gap=o_gap.CurrentValue, Colour=o_col.CurrentValue, Hide=o_hide.CurrentValue,
             Capture=o_cap.CurrentValue, Zoom=o_zoom.CurrentValue)
    sc.sticky[key] = v
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        mesh, centres, keys, n, vol, info = build([o.Geometry() for o in objs], v["Size"], v["Height"],
                                                  v["Mode"], v["Gap"], v["Colour"], f)
    except ValueError as e:
        print("Pixelate: {0}".format(e))
        return
    if n == 0:
        print("Pixelate: no pixel centre fell inside the massing - try a smaller SizeMetres")
        return
    _layer(sc.doc, "M004", (255, 255, 255))
    name = MODE_NAMES[v["Mode"]]
    a = Rhino.DocObjects.ObjectAttributes()
    a.LayerIndex = _layer(sc.doc, name, (255, 255, 255), "M004")
    a.Name = "Pixelate {0} {1:g} m".format(name, v["Size"])
    gid = sc.doc.Objects.AddMesh(mesh, a)
    gi = sc.doc.Groups.Add(a.Name)
    sc.doc.Groups.AddToGroup(gi, [gid])
    if v["Hide"]:
        for o in objs:
            sc.doc.Objects.Hide(o.ObjectId, True)
    sc.doc.Views.Redraw()
    print(info)
    if v["Capture"]:
        try:
            cap = "M004 Pixelate  |  {0} {1:g} m  |  {2}".format(name, v["Size"], info.replace("\n", "  |  "))
            path = capture_view(sc.doc, "M004_{0}_{1:g}m".format(name, v["Size"]), cap,
                                [gid] if v["Zoom"] else None)
            print("Pixelate: capture saved -> {0}".format(path) if path else "Pixelate: no active view to capture")
        except Exception as e:
            print("Pixelate: capture failed ({0})".format(e))

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    mesh, centres, cells, count, volume, info = None, [], [], 0, 0.0, "Connect massing to Mass"
    if globals().get("Mass") is not None:
        try:
            mesh, centres, cells, count, volume, info = build(
                globals().get("Mass"), *[_gh_value(k) for k in ("Size", "Height", "Mode", "Gap", "Colour", "Units")])
        except ValueError as e:
            info = str(e)
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        # self-test: sphere r=10 at origin, analytic intervals
        def sph(x, y, r=10.0):
            d = r * r - x * x - y * y
            return [(-math.sqrt(d), math.sqrt(d))] if d > 0 else []
        for mode in (0, 1, 2, 3, 4):
            for s in (2.0, 1.0, 0.5):
                c = pixelate(sph, ((-10, -10, -10), (10, 10, 10)), s, s, mode)
                v, f = pixel_mesh(c, s, s, mode)
                print("mode", mode, "size", s, "pixels", len(c), "vol", round(len(c) * pixel_volume(s, s, mode), 1),
                      "(sphere 4188.8)", "skin faces", len(f))
