"""
G006  Voxel facade: programme-specific skins for G005 / G001 voxel massing
==========================================================================
Pure maths module (numpy only), used by G005 (Facade option) and usable by any
voxel result: occ grid + a function cell -> profile.

Facade modes
    0 Off
    1 Typology       each programme has its own skin
    2 SunResponsive  same skins, opening width shrinks with the face's yearly sun
                     (Max..Min, like F002) for homes, offices and childcare

Typologies (per exposed 6 m face, 3.5 m floor)
    retail / lobby  storefront: 1.5 m glass panes, thin mullions, ground floor to 3.0 m
    office          ribbon window 0.9-3.1 m, 1.5 m panes; optional vertical fins on
                    east/west faces (Fins)
    residential     two punched windows; French doors + 1.5 m balcony with glass rail
                    on sunny south/east/west faces (Balconies)
    amenity         floor-to-ceiling glazing, 2 m panes
    childcare       three low-sill windows (0.45 m sill, child height)
    core            closed

Face sun = cell sun fraction (G001 ray-marched) x orientation factor (mean
max(0, n.s) over the year's sun directions, normalised to the best orientation).
Approximate: orientation and obstruction are combined per cell, not per face.

Output: list of elements (kind, verts) with kind in wall / glass / reveal / fin /
balcony / rail and verts a quad (4 pts) or box (8 pts), plus per-face WWR stats.
"""
from __future__ import division, print_function
import math
import numpy as np

MODES = ("Off", "Typology", "SunResponsive")
FACADE_COL = {"glass": (150, 195, 230), "reveal": (225, 225, 222), "fin": (250, 250, 250),
              "balcony": (250, 250, 250), "rail": (190, 225, 245)}
FACES = ((0, -1, (0, 3, 7, 4)), (0, 1, (2, 1, 5, 6)), (1, -1, (1, 0, 4, 5)), (1, 1, (3, 2, 6, 7)))

def shift(a, sh, axis):
    out = np.zeros_like(a)
    src = [slice(None)] * a.ndim; dst = [slice(None)] * a.ndim
    if sh > 0:
        src[axis] = slice(0, -sh); dst[axis] = slice(sh, None)
    else:
        src[axis] = slice(-sh, None); dst[axis] = slice(0, sh)
    out[tuple(dst)] = a[tuple(src)]
    return out

def orient_factor(sun_world, R):
    """Factor per local face normal (axis, sign) from yearly sun directions."""
    d = np.asarray(sun_world, float)
    out = {}
    for axis, sign, _ in FACES:
        nl = np.zeros(2); nl[axis] = sign
        nw = R @ nl
        out[(axis, sign)] = float(np.maximum(0, d[:, 0] * nw[0] + d[:, 1] * nw[1]).mean())
    m = max(out.values()) or 1.0
    return dict((k, v / m) for k, v in out.items()), R

def layout(profile, cw, fh, k, s, mode, smin, smax, balcony):
    """Openings for one face: list of (u0, u1, v0, v1) in metres on the face."""
    def panes(u0, u1, v0, v1, w, gap):
        n = max(1, int(round((u1 - u0) / w)))
        pw = (u1 - u0) / n
        return [(u0 + i * pw + gap / 2, u0 + (i + 1) * pw - gap / 2, v0, v1) for i in range(n)]
    f = 1.0
    if mode == 2 and profile in ("residential", "office", "childcare"):
        f = smax - (smax - smin) * min(1.0, max(0.0, s))           # more sun -> smaller
        f = f / smax
    if profile in ("retail", "lobby"):
        v0 = 0.0 if k == 0 else 0.3
        return panes(0.15, cw - 0.15, v0, min(fh - 0.4, 3.0 + v0 * 0), 1.5, 0.1)
    if profile == "office":
        w = (cw - 0.3) * f
        c = cw / 2
        return panes(c - w / 2, c + w / 2, 0.9, fh - 0.4, 1.5, 0.08)
    if profile == "amenity":
        return panes(0.1, cw - 0.1, 0.1, fh - 0.25, 2.0, 0.08)
    if profile == "childcare":
        w = 1.2 * f
        return [(c - w / 2, c + w / 2, 0.45, 2.4) for c in (cw / 6, cw / 2, 5 * cw / 6)]
    if profile == "residential":
        w = 1.8 * f
        v0 = 0.05 if balcony else 0.6
        return [(c - w / 2, c + w / 2, v0, 2.6) for c in (cw / 4, 3 * cw / 4)]
    return []

def build_facade(G, occ, profile_of, cell_sun, sun_world, mode=1, fins=True, balconies=True,
                 smin=0.35, smax=0.9, recess=0.2, inplot=None):
    """Return (elements, stats). profile_of(v) -> profile name for occ value v."""
    if mode == 0:
        return [], {}
    of, R = orient_factor(sun_world, G.R)
    filled = occ > 0
    nx, ny, nz = filled.shape
    cw, fh = G.cell, G.floor
    els = []
    stats = {}
    south = R.T @ np.array([0.0, -1.0])                           # world south in local
    for axis, sign, quad in FACES:
        nb = shift(filled, -sign, axis)                            # neighbour in +sign direction
        exposed = filled & ~nb
        nl = np.zeros(2); nl[axis] = sign
        nw2 = R @ nl
        nwv = np.array([nw2[0], nw2[1], 0.0])
        ew = abs(nw2[0]) > 0.7                                     # east/west facing
        sunny_side = (nw2 @ np.array([0.0, -1.0])) > -0.3         # not north-ish
        for i, j, k in np.argwhere(exposed):
            v = int(occ[i, j, k])
            prof = profile_of(v)
            c = [np.array(p, float) for p in _corners(G, i, j, k)]
            p0, p1, p3 = c[quad[0]], c[quad[1]], c[quad[3]]
            u = (p1 - p0) / cw; up = (p3 - p0) / fh
            s = float(cell_sun[i, j, k]) * of[(axis, sign)]
            bal = (balconies and prof == "residential" and k >= 1 and sunny_side and s >= 0.35)
            ops = layout(prof, cw, fh, k, s, mode, smin, smax, bal) if prof != "core" else []
            P = lambda a, b, d=0.0: p0 + u * a + up * b + nwv * d
            # wall = face minus openings, as strips
            if not ops:
                els.append(("wall", v, [P(0, 0), P(cw, 0), P(cw, fh), P(0, fh)]))
            else:
                ops = sorted(ops)
                vlo = min(o[2] for o in ops); vhi = max(o[3] for o in ops)
                if vlo > 1e-3:
                    els.append(("wall", v, [P(0, 0), P(cw, 0), P(cw, vlo), P(0, vlo)]))
                if vhi < fh - 1e-3:
                    els.append(("wall", v, [P(0, vhi), P(cw, vhi), P(cw, fh), P(0, fh)]))
                xs = [0.0]
                for (u0, u1, v0, v1) in ops:
                    if u0 > xs[-1] + 1e-3:
                        els.append(("wall", v, [P(xs[-1], vlo), P(u0, vlo), P(u0, vhi), P(xs[-1], vhi)]))
                    if v0 > vlo + 1e-3:
                        els.append(("wall", v, [P(u0, vlo), P(u1, vlo), P(u1, v0), P(u0, v0)]))
                    if v1 < vhi - 1e-3:
                        els.append(("wall", v, [P(u0, v1), P(u1, v1), P(u1, vhi), P(u0, vhi)]))
                    els.append(("glass", v, [P(u0, v0, -recess), P(u1, v0, -recess), P(u1, v1, -recess), P(u0, v1, -recess)]))
                    for a, b in (((u0, v0), (u1, v0)), ((u1, v0), (u1, v1)), ((u1, v1), (u0, v1)), ((u0, v1), (u0, v0))):
                        els.append(("reveal", v, [P(a[0], a[1]), P(b[0], b[1]), P(b[0], b[1], -recess), P(a[0], a[1], -recess)]))
                    xs.append(u1)
                if xs[-1] < cw - 1e-3:
                    els.append(("wall", v, [P(xs[-1], vlo), P(cw, vlo), P(cw, vhi), P(xs[-1], vhi)]))
            if fins and prof == "office" and ew:
                for a in np.arange(0.0, cw + 1e-6, 1.5):
                    a = min(max(a, 0.05), cw - 0.05)
                    els.append(("fin", v, _box(P(a - 0.05, 0), u, up, nwv, 0.1, fh, 0.5)))
            if bal:
                els.append(("balcony", v, _box(P(0.3, -0.2), u, up, nwv, cw - 0.6, 0.2, 1.5)))
                q0 = P(0.3, 0.0, 1.5); q1 = P(cw - 0.3, 0.0, 1.5)
                els.append(("rail", v, [q0, q1, q1 + up * 1.1, q0 + up * 1.1]))
            g_area = sum((o[1] - o[0]) * (o[3] - o[2]) for o in ops)
            st = stats.setdefault(prof, [0.0, 0.0])
            st[0] += cw * fh; st[1] += g_area
    wwr = dict((p, (a[1] / a[0] if a[0] else 0.0, a[0], a[1])) for p, a in stats.items())
    return els, wwr

def _corners(G, i, j, k):
    x0, y0 = G.o[0] + i * G.cell, G.o[1] + j * G.cell
    loc = np.array([[x0, y0], [x0 + G.cell, y0], [x0 + G.cell, y0 + G.cell], [x0, y0 + G.cell]])
    w = loc @ G.R.T
    z0, z1 = k * G.floor, (k + 1) * G.floor
    return [(p[0], p[1], z0) for p in w] + [(p[0], p[1], z1) for p in w]

def _box(o, u, up, n, du, dv, dn):
    """8 corners: bottom quad then top quad (box_mesh order) from origin o."""
    a = o; b = o + u * du; c = b + n * dn; d = a + n * dn
    return [a, b, c, d, a + up * dv, b + up * dv, c + up * dv, d + up * dv]

def wwr_lines(wwr):
    return ["{:<12} WWR {:.0%}  ({:,.0f} m2 glass / {:,.0f} m2 facade)".format(p, r, g, a)
            for p, (r, a, g) in sorted(wwr.items())]
