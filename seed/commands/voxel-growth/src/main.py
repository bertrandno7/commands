# r: numpy
"""
G001  Voxel growth massing: an analysis field over the plot, then programme grows into it
==========================================================================================
Rhino 8 (Python 3 + numpy). GH component or Rhino command (alias VoxelGrowth).

Idea
    1. The plot is filled with an empty 3D grid of cells (Cell x Cell x Floor m).
    2. Each cell carries analysis attributes (0..1):
         sun      share of yearly sun hours reaching the cell (21st of each month,
                  hourly), blocked by the context AND by the mass grown so far
         sky      sky-view fraction (daylight proxy), same blockers
         height   z / MaxHeight (view, prestige)
         noise    road noise proxy: road class / distance (X000 roads)
         transit  closeness to stops (metro/train count double) (X000 stops)
         street   ground cell on the plot edge (frontage)
         wind     exposure: height x openness toward the prevailing wind
    3. Programmes grow one cell at a time. The programme furthest behind its
       target share picks the free frontier cell it likes best:
         retail       ground/first floor, street + transit
         office       transit, tolerates noise and depth, lower half
         residential  sun + sky + quiet + height, must keep an open facade,
                      needs >= MinSun of the yearly sun
         amenity      high, sunny, sheltered "public crown"
       plus a clustering bonus for same-programme neighbours. Cells need support
       below (or a Cantilever of 1 cell next to a supported cell).
    4. Every Update share of the target, sun/sky are recomputed with the new
       mass, so later cells react to the shadows of earlier ones.
    5. Roof cells with high sun become terraces (green, not counted as GFA).

GH inputs (all optional except Plot)
    Plot        closed planar curve (model units, drawn in the X000 site frame)
    Lat, Lon    site (default Rotterdam 51.92, 4.48)
    FSI         target floor space index (default 4.0)
    MaxHeight   m (default 60)
    Cell        plan cell size m (default 6.0)
    Floor       floor height m (default 3.5)
    Mix         "retail,office,residential,amenity" shares (default "0.1,0.3,0.5,0.1")
    MinSun      residential minimum share of yearly sun hours (default 0.25)
    MaxGSI      max share of the plot built at ground (default 0.7, keeps public space)
    Cantilever  0/1 cells (default 1)
    WindDir     prevailing wind FROM, deg (default 225 = SW, Rotterdam)
    Update      recompute sun/sky every this share of target (default 0.1)
    Context     optional Breps/Meshes; else sc.sticky["X000_site"] buildings
    Run         bool
GH outputs
    boxes, program, colours, sun, sky, metrics, info
Stores sc.sticky["G001_result"] (plain data: cells, programme ids, fields, metrics)
for M003/A002/W002 and the future evaluate/optimise loop.

Alias:  VoxelGrowth  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\G001_voxel_growth.py"
"""
from __future__ import division, print_function
import math
import numpy as np

PROGRAMS = ["retail", "office", "residential", "amenity"]
PCOL = {"retail": (255, 120, 0), "office": (0, 133, 255), "residential": (255, 210, 0),
        "amenity": (230, 0, 126), "terrace": (120, 220, 90)}
DEFAULTS = dict(Lat=51.92, Lon=4.48, FSI=4.0, MaxHeight=60.0, Cell=6.0, Floor=3.5,
                Mix="0.1,0.3,0.5,0.1", MinSun=0.25, Cantilever=1, WindDir=225.0,
                Update=0.1, MaxGSI=0.7, Seed=1, Run=True)
ROAD_W = {"motorway": 1.0, "trunk": 1.0, "primary": 0.9, "secondary": 0.7, "secondary_link": 0.6,
          "tertiary": 0.5, "busway": 0.5, "residential": 0.25, "unclassified": 0.25,
          "service": 0.1, "living_street": 0.05}

# ------------------------------------------------------------------ sun
def sun_dirs(lat, lon, step_h=1.0):
    """Unit vectors (x east, y north, z up) toward the sun, 21st of each month,
    whole day in solar-ish local time (tz = lon/15, so any site works)."""
    tz = round(lon / 15.0)
    out = []
    for m in range(1, 13):
        n = int(30.4 * (m - 1) + 21)
        h = step_h / 2.0
        while h < 24:
            g = 2 * math.pi / 365.0 * (n - 1 + (h - 12) / 24.0)
            eot = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                            - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
            dec = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g)
                   - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
                   - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
            ha = math.radians(((h * 60 + eot + 4 * lon - 60 * tz) / 4.0) % 360.0 - 180.0)
            la = math.radians(lat)
            cz = math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(ha)
            if cz > 0.02:
                zen = math.acos(cz); s = math.sin(zen)
                ca = (math.sin(la) * math.cos(zen) - math.sin(dec)) / (math.cos(la) * s)
                az = math.degrees(math.acos(max(-1.0, min(1.0, ca))))
                az = (180 + az) % 360 if ha > 0 else (540 - az) % 360
                a, z = math.pi / 2 - zen, math.radians(az)
                out.append((math.cos(a) * math.sin(z), math.cos(a) * math.cos(z), math.sin(a)))
            h += step_h
    return np.array(out)

def sky_dirs(n_alt=4, n_az=12):
    out = []
    for i in range(n_alt):
        a = math.radians((i + 0.5) * 90.0 / n_alt)
        k = max(4, int(round(n_az * math.cos(a))))
        for j in range(k):
            z = 2 * math.pi * (j + 0.5) / k
            out.append((math.cos(a) * math.sin(z), math.cos(a) * math.cos(z), math.sin(a)))
    d = np.array(out)
    w = d[:, 2] / d[:, 2].sum()                    # cosine weighted (horizontal-ish)
    return d, w

# ------------------------------------------------------------------ grid
class Grid(object):
    """Plot-aligned voxel grid + a larger world grid for context occlusion."""
    def __init__(self, plot_xy, cell, floor, max_h, angle, margin, ctx_top):
        self.cell, self.floor, self.angle = cell, floor, angle
        c, s = math.cos(angle), math.sin(angle)
        self.R = np.array([[c, -s], [s, c]])          # local -> world
        P = np.array(plot_xy, float)
        L = P @ self.R                                  # world -> local (R orthonormal)
        self.o = L.min(0) - margin
        self.nx = int(math.ceil((L[:, 0].max() - L[:, 0].min() + 2 * margin) / cell))
        self.ny = int(math.ceil((L[:, 1].max() - L[:, 1].min() + 2 * margin) / cell))
        self.nz = int(math.ceil(max(max_h, ctx_top) / floor)) + 1
        self.nzp = int(math.floor(max_h / floor + 1e-6))
        self.plot_local = L
        ix, iy = np.meshgrid(np.arange(self.nx), np.arange(self.ny), indexing="ij")
        self.cx = self.o[0] + (ix + 0.5) * cell
        self.cy = self.o[1] + (iy + 0.5) * cell
        self.inplot = points_in_poly(self.cx, self.cy, L)
        self.ctx = np.zeros((self.nx, self.ny, self.nz), bool)

    def world_xy(self, lx, ly):
        p = np.stack([lx, ly], -1) @ self.R.T
        return p[..., 0], p[..., 1]

    def to_local(self, xy):
        return np.array(xy, float) @ self.R

    def add_prism(self, outer, base, top):
        L = self.to_local(outer)
        lo, hi = L.min(0), L.max(0)
        i0 = max(0, int((lo[0] - self.o[0]) / self.cell)); i1 = min(self.nx, int((hi[0] - self.o[0]) / self.cell) + 1)
        j0 = max(0, int((lo[1] - self.o[1]) / self.cell)); j1 = min(self.ny, int((hi[1] - self.o[1]) / self.cell) + 1)
        if i0 >= i1 or j0 >= j1:
            return
        m = points_in_poly(self.cx[i0:i1, j0:j1], self.cy[i0:i1, j0:j1], L)
        zc = (np.arange(self.nz) + 0.5) * self.floor
        zm = (zc >= base) & (zc < top)
        if m.any() and zm.any():
            sub = self.ctx[i0:i1, j0:j1, :]
            sub[np.ix_(np.arange(i1 - i0), np.arange(j1 - j0), np.nonzero(zm)[0])] |= m[:, :, None]

def points_in_poly(x, y, poly):
    """Even-odd test, vectorised over arrays x, y."""
    x = np.asarray(x, float); y = np.asarray(y, float)
    inside = np.zeros(x.shape, bool)
    P = np.asarray(poly, float)
    n = len(P)
    for k in range(n):
        x0, y0 = P[k]; x1, y1 = P[(k + 1) % n]
        c = ((y0 > y) != (y1 > y)) & (x < (x1 - x0) * (y - y0) / ((y1 - y0) + 1e-12) + x0)
        inside ^= c
    return inside

def march(solid, idx, dirs, cell, floor, max_len):
    """For cells idx (N,3) and directions (D,3) return (N,D) bool 'open'
    (ray from the cell centre leaves the grid without hitting solid)."""
    nx, ny, nz = solid.shape
    N, D = len(idx), len(dirs)
    p0 = np.stack([(idx[:, 0] + 0.5) * cell, (idx[:, 1] + 0.5) * cell, (idx[:, 2] + 0.5) * floor], -1)
    step = 0.5 * min(cell, floor)
    open_ = np.ones((N, D), bool)
    alive = np.ones((N, D), bool)
    t = step
    while t < max_len and alive.any():
        q = p0[:, None, :] + dirs[None, :, :] * t
        i = np.floor(q[..., 0] / cell).astype(int)
        j = np.floor(q[..., 1] / cell).astype(int)
        k = np.floor(q[..., 2] / floor).astype(int)
        out = (i < 0) | (i >= nx) | (j < 0) | (j >= ny) | (k >= nz)
        own = (i == idx[:, 0:1]) & (j == idx[:, 1:2]) & (k == idx[:, 2:3])
        ok = alive & ~out & ~own & (k >= 0)
        hit = np.zeros((N, D), bool)
        hit[ok] = solid[i[ok], j[ok], k[ok]]
        open_ &= ~hit
        alive &= ~out & ~hit & (k >= 0)
        t += step
    return open_

def cast_field(occ, ctx_plot, sdirs, cell, floor, prog=3):
    """Shadow-casting cost: for every empty cell, how many (home, sun sample)
    rays of the current `prog` cells pass through it before being blocked.
    Building there would steal that sun. Normalised 0..1."""
    nx, ny, nz = occ.shape
    idx = np.argwhere(occ == prog)
    acc = np.zeros(occ.shape)
    if not len(idx):
        return acc
    solid = (occ > 0) | ctx_plot
    p0 = np.stack([(idx[:, 0] + 0.5) * cell, (idx[:, 1] + 0.5) * cell, (idx[:, 2] + 0.5) * floor], -1)
    step = 0.5 * min(cell, floor)
    alive = np.ones((len(idx), len(sdirs)), bool)
    seen = np.zeros(occ.shape, np.int64)
    t = step
    L = math.hypot(nx * cell, ny * cell) + nz * floor
    while t < L and alive.any():
        q = p0[:, None, :] + sdirs[None, :, :] * t
        i = np.floor(q[..., 0] / cell).astype(int); j = np.floor(q[..., 1] / cell).astype(int)
        k = np.floor(q[..., 2] / floor).astype(int)
        out = (i < 0) | (i >= nx) | (j < 0) | (j >= ny) | (k >= nz) | (k < 0)
        own = (i == idx[:, 0:1]) & (j == idx[:, 1:2]) & (k == idx[:, 2:3])
        ok = alive & ~out & ~own
        hit = np.zeros(alive.shape, bool); hit[ok] = solid[i[ok], j[ok], k[ok]]
        free = ok & ~hit
        np.add.at(acc, (i[free], j[free], k[free]), 1.0)
        alive &= ~out & ~hit
        t += step
    m = acc.max()
    return acc / m if m > 0 else acc

# ------------------------------------------------------------------ fields
def static_fields(G, roads, stops, wind_from, max_h):
    """height, noise, transit, street, wind per plot cell (arrays nx,ny,nzp)."""
    nzp = G.nzp
    zc = (np.arange(nzp) + 0.5) * G.floor
    wx, wy = G.world_xy(G.cx, G.cy)
    # noise: max over roads of class / (1 + d/15), slight drop with height
    nz2 = np.zeros(G.cx.shape)
    for r in roads or []:
        w = ROAD_W.get(r.get("kind"), 0.15)
        pts = np.array([p[:2] for p in r["pts"]], float)
        if len(pts) < 2 or r.get("tunnel"):
            continue
        a, b = pts[:-1], pts[1:]
        d = seg_dist(wx, wy, a, b)
        nz2 = np.maximum(nz2, w / (1.0 + d / 15.0))
    noise = np.clip(nz2[:, :, None] * (1.0 - 0.4 * zc[None, None, :] / max(max_h, 1)), 0, 1)
    # transit: best of exp(-d/300), metro/train x1, tram/bus x0.6
    tr = np.zeros(G.cx.shape)
    for s in stops or []:
        k = 1.0 if s.get("kind") in ("metro", "train", "metro entrance", "station") else 0.6
        d = np.hypot(wx - s["x"], wy - s["y"])
        tr = np.maximum(tr, k * np.exp(-d / 300.0))
    transit = np.repeat(tr[:, :, None], nzp, 2)
    height = np.broadcast_to(zc / max(max_h, 1), G.cx.shape + (nzp,)).copy()
    # street frontage: plot cell with a non-plot neighbour
    ip = G.inplot
    edge = np.zeros_like(ip)
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        edge |= ip & ~np.roll(np.roll(ip, di, 0), dj, 1)
    street = np.zeros(G.cx.shape + (nzp,)); street[:, :, 0] = edge; street[:, :, 1] = 0.5 * edge
    # wind exposure: height x how far the cell sits on the windward side
    a = math.radians(wind_from)
    wv = np.array([math.sin(a), math.cos(a)]) @ G.R          # local dir toward wind source
    proj = (G.cx - G.cx[ip].mean()) * wv[0] + (G.cy - G.cy[ip].mean()) * wv[1]
    span = np.abs(proj[ip]).max() + 1e-9
    windward = np.clip(0.5 + 0.5 * proj / span, 0, 1)
    wind = np.clip(windward[:, :, None] * (0.3 + 0.7 * height), 0, 1)
    return dict(height=height, noise=noise, transit=transit, street=street, wind=wind)

def seg_dist(x, y, a, b):
    """Distance from points (x,y arrays) to a polyline given by segments a->b."""
    P = np.stack([x, y], -1)[..., None, :]
    ab = b - a
    t = np.clip(((P - a) * ab).sum(-1) / ((ab * ab).sum(-1) + 1e-12), 0, 1)
    q = a + t[..., None] * ab
    return np.sqrt(((P - q) ** 2).sum(-1)).min(-1)

def light_fields(G, occ, sdirs, kdirs, kw, cells=None):
    """sun (share of yearly sun samples) and sky (cosine-weighted) for plot cells."""
    solid = G.ctx.copy()
    solid[:, :, :G.nzp] |= occ > 0
    if cells is None:
        cells = np.argwhere(np.repeat(G.inplot[:, :, None], G.nzp, 2))
    L = math.hypot(G.nx * G.cell, G.ny * G.cell) + G.nz * G.floor
    ld = local_dirs(sdirs, G.R)
    kd = local_dirs(kdirs, G.R)
    sun = march(solid, cells, ld, G.cell, G.floor, L).mean(1)
    sky = (march(solid, cells, kd, G.cell, G.floor, L) * kw[None, :]).sum(1)
    S = np.zeros((G.nx, G.ny, G.nzp)); K = np.zeros_like(S)
    S[cells[:, 0], cells[:, 1], cells[:, 2]] = sun
    K[cells[:, 0], cells[:, 1], cells[:, 2]] = sky
    return S, K

def local_dirs(d, R):
    xy = d[:, :2] @ R                                     # world -> local
    return np.column_stack([xy, d[:, 2]])

# ------------------------------------------------------------------ growth
def scores(F, p, minsun):
    s, k, h, n, t, st, w = (F[x] for x in ("sun", "sky", "height", "noise", "transit", "street", "wind"))
    if p == "retail":
        return 0.5 * st + 0.3 * t + 0.2 * (1 - h)
    if p == "office":
        return 0.35 * t + 0.25 * n + 0.2 * (1 - h) + 0.2 * k
    if p == "residential":
        v = 0.45 * s + 0.2 * k + 0.2 * (1 - n) + 0.15 * h
        return np.where(s >= minsun, v, v - 0.6)
    if p == "amenity":
        return 0.5 * h * h + 0.3 * s + 0.2 * (1 - w)
    raise ValueError(p)

def grow(G, F, mix, n_target, minsun, cantilever, update, relight, rng, log=None, shade_w=0.35, max_gsi=0.7):
    nx, ny, nzp = G.nx, G.ny, G.nzp
    occ = np.zeros((nx, ny, nzp), np.int8)                # 0 empty, 1.. programme
    target = np.array([m * n_target for m in mix])
    done = np.zeros(len(PROGRAMS))
    order = []
    plot3 = np.repeat(G.inplot[:, :, None], nzp, 2)
    n_plot = G.inplot.sum()
    zl = np.arange(nzp)[None, None, :]
    next_up = update * n_target
    S = {p: scores(F, p, minsun) for p in PROGRAMS}
    frames = []
    while done.sum() < n_target:
        filled = occ > 0
        col = np.cumprod(filled, axis=2).astype(bool)        # grounded columns
        ground = (zl == 0) & plot3
        support = ground | shift(col, 1, 2)                  # on top of a column
        if cantilever:                                       # 1 cell off a column, same level
            reach = np.zeros_like(filled)
            for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
                reach |= shift(col, sh, a)
            support |= reach & (zl > 0)
        nb_any = np.zeros_like(filled)
        for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1)):
            nb_any |= shift(filled, sh, a)
        res_cells = occ == 3
        open_res = np.zeros(filled.shape)
        for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            open_res += ~shift(filled | ~plot3, sh, a, fill=True)
        last = res_cells & (open_res <= 1)                   # homes with one facade left
        bury = np.zeros_like(filled)
        for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            bury |= shift(last, sh, a)
        free = plot3 & ~filled & support
        fp = filled.any(2)
        if fp.sum() >= max_gsi * n_plot:                     # footprint cap: keep open ground
            free &= np.repeat(fp[:, :, None], nzp, 2)
        if filled.any():
            free &= nb_any | ground                          # stay attached (ground seeds ok)
        if not free.any():
            break
        need = (target - done) / np.maximum(target, 1)
        pi = int(np.argmax(need))
        p = PROGRAMS[pi]
        sc = S[p].copy()
        same = np.zeros(filled.shape)
        for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1)):
            same += shift(occ == pi + 1, sh, a)
        sc += (0.3 if p == "amenity" else 0.12) * np.minimum(same, 3)
        if p != "retail":
            sc -= shade_w * F.get("cast", 0.0)              # don't steal homes' sun
        sc[bury] -= 3.0                                     # never bury a home's last facade
        if p == "retail":
            sc[:, :, 2:] -= 5.0
        if p == "residential":
            # must keep >= 1 open horizontal face after placement
            op = np.zeros(filled.shape)
            for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
                op += ~shift(filled | ~plot3, sh, a, fill=True)
            sc[op == 0] -= 2.0
        sc += rng.uniform(0, 1e-3, sc.shape)
        sc[~free] = -1e9
        i, j, k = np.unravel_index(int(np.argmax(sc)), sc.shape)
        if sc[i, j, k] < -100:
            break
        occ[i, j, k] = pi + 1; done[pi] += 1; order.append((i, j, k, pi))
        if done.sum() >= next_up and done.sum() < n_target:
            next_up += update * n_target
            F["sun"], F["sky"], F["cast"] = relight(occ)
            S = {q: scores(F, q, minsun) for q in PROGRAMS}
            frames.append(occ.copy())
            if log:
                log("grown %d / %d cells, sun/sky updated" % (done.sum(), n_target))
    return occ, order, frames

def shift(a, sh, axis, fill=False):
    """np.roll without wrap-around (vacated cells get `fill`)."""
    out = np.full_like(a, fill)
    src = [slice(None)] * a.ndim; dst = [slice(None)] * a.ndim
    if sh > 0:
        src[axis] = slice(0, -sh); dst[axis] = slice(sh, None)
    else:
        src[axis] = slice(-sh, None); dst[axis] = slice(0, sh)
    out[tuple(dst)] = a[tuple(src)]
    return out

def terraces(G, occ, sun, thresh=0.5):
    filled = occ > 0
    top = filled.copy(); top[:, :, :-1] &= ~filled[:, :, 1:]
    roof_sun = np.zeros_like(sun)
    roof_sun[:, :, :-1] = sun[:, :, 1:]                  # sun just above the roof
    t = top & (roof_sun >= thresh)
    t[:, :, -1] = top[:, :, -1]
    return t

def metrics(G, occ, F, terr, plot_area, minsun):
    ca = G.cell * G.cell
    out = {"cell_area": ca, "plot_area": plot_area}
    gfa = (occ > 0).sum() * ca
    fp = (occ > 0).any(2).sum() * ca
    out.update(gfa=gfa, footprint=fp, fsi=gfa / plot_area, gsi=fp / plot_area,
               osr=(plot_area - fp) / gfa if gfa else 0, L=gfa / fp if fp else 0,
               height=((occ > 0).any((0, 1)).nonzero()[0].max() + 1) * G.floor if gfa else 0,
               terrace=terr.sum() * ca)
    for n, p in enumerate(PROGRAMS):
        m = occ == n + 1
        out["gfa_" + p] = m.sum() * ca
        out["sun_" + p] = float(F["sun"][m].mean()) if m.any() else 0.0
    r = occ == 3
    out["res_ok"] = float((F["sun"][r] >= minsun).mean()) if r.any() else 0.0
    return out

def run(plot_xy, prisms, roads, stops, lat=51.92, lon=4.48, fsi=4.0, max_h=60.0, cell=6.0,
        floor=3.5, mix=(0.1, 0.3, 0.5, 0.1), minsun=0.25, cantilever=1, wind_from=225.0,
        update=0.1, seed=1, margin=None, log=None, shade_w=0.35, max_gsi=0.7):
    """plot_xy: [(x,y)] world metres; prisms: [(outer[(x,y)], base, top)] context."""
    P = np.array(plot_xy, float)
    e = np.diff(np.vstack([P, P[:1]]), axis=0)
    k = int(np.argmax(np.hypot(e[:, 0], e[:, 1])))
    angle = math.atan2(e[k, 1], e[k, 0])
    if margin is None:
        margin = 2.5 * max_h
    ctx_top = max([t for _, _, t in prisms] + [max_h])
    G = Grid(P, cell, floor, max_h, angle, margin, ctx_top)
    for outer, b, t in prisms:
        G.add_prism(outer, b, t)
    G.ctx[np.repeat(G.inplot[:, :, None], G.nz, 2)] = False      # plot is cleared
    mix = np.array(mix, float); mix = mix / mix.sum()
    plot_area = poly_area(P)
    n_target = int(round(fsi * plot_area / (cell * cell)))
    sd = sun_dirs(lat, lon); kd, kw = sky_dirs()
    F = static_fields(G, roads, stops, wind_from, max_h)
    ctx_plot = G.ctx[:, :, :G.nzp]
    sdl = local_dirs(sd, G.R)
    def relight(occ):
        s_, k_ = light_fields(G, occ, sd, kd, kw)
        return s_, k_, cast_field(occ, ctx_plot, sdl, G.cell, G.floor)
    F["sun"], F["sky"], F["cast"] = relight(np.zeros((G.nx, G.ny, G.nzp), np.int8))
    F0 = {k2: v.copy() for k2, v in F.items()}
    rng = np.random.RandomState(seed)
    occ, order, frames = grow(G, F, mix, n_target, minsun, cantilever, update, relight, rng, log, shade_w, max_gsi)
    F["sun"], F["sky"], F["cast"] = relight(occ)
    terr = terraces(G, occ, F["sun"])
    M = metrics(G, occ, F, terr, plot_area, minsun)
    return dict(G=G, occ=occ, order=order, frames=frames, F=F, F0=F0, terr=terr, metrics=M,
                n_target=n_target, sun_n=len(sd))

def poly_area(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))

def cell_corners(G, i, j, k):
    """8 world corners of plot cell (i,j,k)."""
    x0, y0 = G.o[0] + i * G.cell, G.o[1] + j * G.cell
    loc = np.array([[x0, y0], [x0 + G.cell, y0], [x0 + G.cell, y0 + G.cell], [x0, y0 + G.cell]])
    w = loc @ G.R.T
    z0, z1 = k * G.floor, (k + 1) * G.floor
    return [(p[0], p[1], z0) for p in w] + [(p[0], p[1], z1) for p in w]

def summary(M, n_sun):
    return ("G001 | GFA {:,.0f} m2, FSI {:.2f}, GSI {:.2f}, OSR {:.2f}, L {:.1f}, height {:.0f} m | "
            "retail {:,.0f}, office {:,.0f}, residential {:,.0f}, amenity {:,.0f} m2 | "
            "terraces {:,.0f} m2 | residential mean sun {:.0%}, {:.0%} meet MinSun | {} sun samples"
            ).format(M["gfa"], M["fsi"], M["gsi"], M["osr"], M["L"], M["height"], M["gfa_retail"],
                     M["gfa_office"], M["gfa_residential"], M["gfa_amenity"], M["terrace"],
                     M["sun_residential"], M["res_ok"], n_sun)

def plain(res):
    G = res["G"]; occ = res["occ"]
    cells = [(int(i), int(j), int(k), PROGRAMS[occ[i, j, k] - 1]) for i, j, k in np.argwhere(occ > 0)]
    return dict(cells=cells, cell=G.cell, floor=G.floor, origin=list(G.o), angle=G.angle,
                metrics=res["metrics"],
                sun=[float(res["F"]["sun"][i, j, k]) for i, j, k, _ in cells],
                sky=[float(res["F"]["sky"][i, j, k]) for i, j, k, _ in cells])

# ------------------------------------------------------------------ Rhino side
def _site_context():
    import scriptcontext as sc
    S = sc.sticky.get("X000_site")
    if not S:
        return [], [], [], None
    pr = [(b["outer"], b["base"], b["top"]) for b in S.get("buildings", [])]
    return pr, S.get("roads", []), S.get("stops", []), (S.get("lat"), S.get("lon"))

def _brep_prisms(objs):
    import Rhino.Geometry as rg
    out = []
    for g in objs or []:
        bb = g.GetBoundingBox(True)                     # context as bounding prisms
        out.append(([(bb.Min.X, bb.Min.Y), (bb.Max.X, bb.Min.Y), (bb.Max.X, bb.Max.Y), (bb.Min.X, bb.Max.Y)],
                    bb.Min.Z, bb.Max.Z))
    return out

def build(plot_crv, P, context=None, scale=1.0, log=None):
    import Rhino.Geometry as rg
    import System.Drawing as sd
    ok, pl = plot_crv.TryGetPolyline()
    if not ok:
        pl = plot_crv.ToPolyline(0.01 * scale, 1.0, 0.0, 0.0).ToPolyline()
    pts = [(p.X / scale, p.Y / scale) for p in pl]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    pr, roads, stops, ll = _site_context()
    if context:
        pr = [([(x / scale, y / scale) for x, y in o], b / scale, t / scale) for o, b, t in _brep_prisms(context)]
    mix = [float(x) for x in str(P["Mix"]).split(",")]
    res = run(pts, pr, roads, stops, P["Lat"], P["Lon"], P["FSI"], P["MaxHeight"], P["Cell"], P["Floor"],
              mix, P["MinSun"], int(P["Cantilever"]), P["WindDir"], P["Update"], int(P["Seed"]), log=log,
              max_gsi=P["MaxGSI"])
    G, occ = res["G"], res["occ"]
    boxes, prog, cols, sun, sky = [], [], [], [], []
    for i, j, k in np.argwhere(occ > 0):
        c = cell_corners(G, i, j, k)
        boxes.append(rg.Brep.CreateFromBox([rg.Point3d(x * scale, y * scale, z * scale) for x, y, z in c]))
        p = PROGRAMS[occ[i, j, k] - 1]
        prog.append(p); cols.append(sd.Color.FromArgb(*PCOL[p]))
        sun.append(float(res["F"]["sun"][i, j, k])); sky.append(float(res["F"]["sky"][i, j, k]))
    for i, j, k in np.argwhere(res["terr"]):
        c = cell_corners(G, i, j, k + 1)[:4]
        z = c[0][2] + 0.05
        boxes.append(rg.Brep.CreateFromCornerPoints(*[rg.Point3d(x * scale, y * scale, z * scale) for x, y, _ in c],
                                                    tolerance=0.001))
        prog.append("terrace"); cols.append(sd.Color.FromArgb(*PCOL["terrace"])); sun.append(0.0); sky.append(0.0)
    info = summary(res["metrics"], res["sun_n"])
    try:
        import scriptcontext as sc
        sc.sticky["G001_result"] = plain(res)
    except Exception:
        pass
    return boxes, prog, cols, sun, sky, res["metrics"], info

def run_command():
    import Rhino, rhinoscriptsyntax as rs
    import scriptcontext as sc
    import Rhino.Geometry as rg
    P = dict(DEFAULTS); P.update(sc.sticky.get("G001_opts", {}))
    pr, roads, stops, ll = _site_context()
    if ll and ll[0] is not None and "Lat" not in sc.sticky.get("G001_opts", {}):
        P["Lat"], P["Lon"] = ll
    go = Rhino.Input.Custom.GetObject()
    go.SetCommandPrompt("Select closed plot curve")
    go.GeometryFilter = Rhino.DocObjects.ObjectType.Curve
    opts = {}
    for k in ("Lat", "Lon", "FSI", "MaxHeight", "Cell", "Floor", "MinSun", "MaxGSI", "WindDir", "Update"):
        opts[k] = Rhino.Input.Custom.OptionDouble(P[k])
        go.AddOptionDouble(k, opts[k])
    ct = Rhino.Input.Custom.OptionToggle(bool(P["Cantilever"]), "No", "Yes")
    go.AddOptionToggle("Cantilever", ct)
    while True:
        r = go.Get()
        if r == Rhino.Input.GetResult.Option:
            continue
        if r != Rhino.Input.GetResult.Object:
            return
        break
    for k, o in opts.items():
        P[k] = o.CurrentValue
    P["Cantilever"] = 1 if ct.CurrentValue else 0
    s = rs.GetString("Mix retail,office,residential,amenity", P["Mix"])
    if s:
        P["Mix"] = s
    sc.sticky["G001_opts"] = dict((k, P[k]) for k in P if k != "Run")
    crv = go.Object(0).Curve()
    scale = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    boxes, prog, cols, sun, sky, M, info = build(crv, P, scale=scale, log=print)
    ids = []
    for b, p, c in zip(boxes, prog, cols):
        lname = "G001::" + p.capitalize()
        if not rs.IsLayer(lname):
            rs.AddLayer(lname, (c.R, c.G, c.B))
        oid = sc.doc.Objects.AddBrep(b)
        rs.ObjectLayer(oid, lname); ids.append(oid)
    rs.AddObjectsToGroup(ids, rs.AddGroup())
    sc.doc.Views.Redraw()
    print(info)

if __name__ == "__main__":
    try:
        ghenv  # noqa
        g = globals()
        P = dict(DEFAULTS)
        for k in DEFAULTS:
            v = g.get(k)
            if v is not None:
                P[k] = v
        if g.get("Plot") is not None and P["Run"]:
            import Rhino, scriptcontext as sc
            scale = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
            boxes, program, colours, sun, sky, metrics_, info = build(g["Plot"], P, g.get("Context"), scale)
        else:
            boxes = program = colours = sun = sky = []
            metrics_ = {}; info = "Connect a closed Plot curve"
        metrics = metrics_
    except NameError:
        run_command()
