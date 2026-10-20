# r: numpy
"""
G005  Brief-driven voxel growth: a programme of requirements grows into the analysis field
=========================================================================================
Rhino 8 (Python 3 + numpy). GH component or Rhino command (alias BriefGrowth).
Uses the G001 field (sun, sky, height, noise, transit, street, wind per cell, sun
re-checked as the mass grows) but replaces G001's four percentages with a BRIEF:

  name, profile, count, unit_m2, floors, zmin, zmax, min_sun, frontage, cluster, near, away

    profile   retail | office | residential | amenity | childcare | lobby
              (sets what the item likes in the field, see PROFILES)
    count     number of units;  unit_m2  area per unit (rounded to whole cells,
              the deviation is reported)  -> hard cap: count x unit cells, never more
    floors    1, or 2 for double-height spaces (counts GFA once, occupies 2 levels)
    zmin,zmax allowed floor indices (0 = ground); -1 = no limit
    min_sun   share of yearly sun hours each cell needs (0 = none)
    frontage  1 = unit must touch the street edge at ground
    cluster   1 = units of this item want to sit together (stack / same wing)
    near/away other item names, ';'-separated (lobby near homes, gym away from homes)

Growth
    Most constrained items first (double height, ground/level rules, frontage,
    adjacency), then the rest by deficit. Each UNIT grows as a connected cluster on
    one floor from the best seed cell; if it cannot be completed the next seed is
    tried; an item that cannot fit is reported, never squeezed. Support, cantilever
    (1 cell off a grounded column), MaxGSI, the stolen-sun cost and the
    never-bury-a-home's-last-facade rule come from G001.

GH inputs
    Plot (closed curve), Brief (CSV text, header optional; default demo brief),
    Lat, Lon, MaxHeight, Cell, Floor, MaxGSI, Cantilever, WindDir, Update, Seed,
    Context, LibPath (folder with G001_voxel_growth.py), Run,
    Facade (0 Off, 1 Typology, 2 SunResponsive), Fins, Balconies   (skins from G006_voxel_facade.py)
    Pilotis (default False: no lifted units on thin auto-cores), MinSupport (0.6: share of a
    unit's cells that must stand on mass directly below; overhang max 1 cell). report ends with
    the number of cells without a load path (should be 0).
GH outputs
    boxes, item, colours, labels (TextDot-ready (pt, text)), report (per item lines),
    compliance (0..1), metrics, info, facade (meshes), facade_layer (names)
Stores sc.sticky["G005_result"].

Alias:  BriefGrowth  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\G005_brief_growth.py"
"""
from __future__ import division, print_function
import os, sys, math
import numpy as np

def _g001(libpath=""):
    here = None
    try:
        here = os.path.dirname(os.path.abspath(__file__))
    except NameError:
        pass
    for p in (libpath, here, r"C:\Scripts\GH-Library", os.path.join(os.path.expanduser("~"), "GH-Library")):
        if p and os.path.isdir(p) and p not in sys.path:
            sys.path.append(p)
    import G001_voxel_growth as g
    return g

def _g006(libpath=""):
    _g001(libpath)                                      # sets sys.path
    import G006_voxel_facade as f
    return f

DEMO_BRIEF = """name,profile,count,unit_m2,floors,zmin,zmax,min_sun,frontage,cluster,near,away
Market hall,retail,1,864,2,0,0,0,1,1,,
Shop,retail,6,144,1,0,0,0,1,0,Market hall,
Lobby,lobby,2,72,1,0,0,0,1,0,Apartment 2-bed;Apartment 3-bed,
Office floor,office,6,432,1,1,6,0,0,1,,
Gym,amenity,1,288,2,1,3,0,0,1,,Apartment 2-bed;Apartment 3-bed;Studio
Childcare,childcare,1,288,1,1,2,0.35,0,1,,
Sky bar,amenity,1,216,1,8,-1,0.4,0,1,,
Apartment 3-bed,residential,20,108,1,2,-1,0.3,0,1,,
Apartment 2-bed,residential,50,72,1,2,-1,0.25,0,1,,
Studio,residential,30,36,1,2,-1,0.15,0,1,,"""

# field weights; negative = prefers the low end
PROFILES = {
    "retail":      dict(street=0.5, transit=0.3, height=-0.2),
    "lobby":       dict(street=0.7, transit=0.3),
    "office":      dict(transit=0.35, noise=0.25, sky=0.2, height=-0.2),
    "residential": dict(sun=0.5, sky=0.2, noise=-0.2, height=0.05),
    "amenity":     dict(height=0.5, sun=0.3, wind=-0.2),
    "childcare":   dict(sun=0.5, noise=-0.3, height=-0.2),
}
FAMILY_COL = {"retail": [(255, 120, 0), (255, 170, 80)], "lobby": [(170, 170, 170)],
              "office": [(0, 133, 255), (90, 175, 255)],
              "residential": [(255, 210, 0), (255, 230, 100), (240, 180, 0)],
              "amenity": [(230, 0, 126), (255, 90, 170)], "childcare": [(0, 170, 110)]}
DAYLIGHT = ("residential", "childcare", "office")
CORE_COL = (120, 120, 120)
N6 = ((0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1))
N4 = ((0, 1), (0, -1), (1, 1), (1, -1))

def parse_brief(text):
    rows = [r.strip() for r in str(text).strip().splitlines() if r.strip() and not r.strip().startswith("#")]
    if rows and rows[0].lower().startswith("name"):
        rows = rows[1:]
    items, used = [], {}
    for r in rows:
        c = [x.strip() for x in r.split(",")] + [""] * 12
        prof = c[1].lower() or "residential"
        if prof not in PROFILES:
            raise ValueError("Unknown profile '%s' (use %s)" % (prof, ", ".join(PROFILES)))
        k = used.get(prof, 0); used[prof] = k + 1
        pal = FAMILY_COL[prof]
        items.append(dict(name=c[0], profile=prof, count=int(float(c[2] or 1)), unit_m2=float(c[3] or 36),
                          floors=max(1, int(float(c[4] or 1))), zmin=int(float(c[5] or -1)),
                          zmax=int(float(c[6] or -1)), min_sun=float(c[7] or 0), frontage=c[8] in ("1", "yes", "true"),
                          cluster=c[9] in ("1", "yes", "true"),
                          near=[x for x in c[10].split(";") if x], away=[x for x in c[11].split(";") if x],
                          colour=pal[k % len(pal)]))
    names = [i["name"] for i in items]
    for it in items:
        for n in it["near"] + it["away"]:
            if n not in names:
                raise ValueError("%s: unknown item '%s' in near/away" % (it["name"], n))
    return items

def rank(it):
    return (3 * (it["floors"] > 1) + 2 * (it["zmax"] >= 0 and it["zmax"] <= 1) + 2 * it["frontage"]
            + (it["zmin"] > 2) + len(it["near"]) + len(it["away"]) + (it["count"] == 1))

def dilate_dist(mask, steps, g):
    """Approx. 6-neighbour distance (in cells) from mask, capped at steps."""
    d = np.full(mask.shape, steps + 1.0)
    cur = mask.copy(); d[cur] = 0
    for s in range(1, steps + 1):
        nxt = cur.copy()
        for a, sh in N6:
            nxt |= G_shift(cur, sh, a)
        d[nxt & ~cur] = s
        cur = nxt
    return d

def item_score(g, F, it, items, occ, minsun_pen=0.8):
    w = PROFILES[it["profile"]]
    s = np.zeros(F["sun"].shape)
    for k, v in w.items():
        s += v * F[k] if v >= 0 else -v * (1 - F[k])
    if it["min_sun"] > 0:
        s -= minsun_pen * (F["sun"] < it["min_sun"])
    idx = {x["name"]: n + 1 for n, x in enumerate(items)}
    near = list(it["near"]) + [x["name"] for x in items if it["name"] in x["near"]]
    away = list(it["away"]) + [x["name"] for x in items if it["name"] in x["away"]]
    for n in near:
        m = occ == idx[n]
        if m.any():
            s += 0.35 * np.exp(-dilate_dist(m, 6, g) / 2.0)
    for n in away:
        m = occ == idx[n]
        if m.any():
            s -= 0.6 * (dilate_dist(m, 2, g) <= 1)
    if it["cluster"]:
        m = occ == idx[it["name"]]
        if m.any():
            s += 0.25 * np.exp(-dilate_dist(m, 4, g) / 1.5)
    if it["profile"] not in ("retail", "lobby"):
        s -= 0.35 * F.get("cast", 0.0)
    # floor-plate continuity: like cells next to built cells on the same level,
    # dislike 1-cell spindles
    filled = occ > 0
    plate = np.zeros(filled.shape)
    for a, sh in N4:
        plate += G_shift(filled, sh, a)
    s += 0.12 * np.minimum(plate, 3)
    k = np.arange(filled.shape[2])[None, None, :]
    s -= 0.3 * ((plate == 0) & (k > 0))
    b9 = filled.astype(np.int16)
    b9 = b9 + G_shift(b9, 1, 0) + G_shift(b9, -1, 0)
    b9 = b9 + G_shift(b9, 1, 1) + G_shift(b9, -1, 1)
    base = G_shift(b9, 1, 2)
    s -= 0.08 * np.clip(7 - base, 0, 4) * (k > 1)             # prefer broad bases over pencils
    return s

def run(plot_xy, prisms, roads, stops, brief=DEMO_BRIEF, lat=51.92, lon=4.48, max_h=60.0, cell=6.0,
        floor=3.5, max_gsi=0.7, cantilever=1, wind_from=225.0, update=0.1, seed=1, libpath="", log=None, min_base=4,
        facade=1, fins=True, balconies=True, smin=0.35, smax=0.9, pilotis=False, min_support=0.6, max_fill=1.0):
    g = _g001(libpath)
    items = parse_brief(brief)
    P = np.array(plot_xy, float)
    e = np.diff(np.vstack([P, P[:1]]), axis=0)
    kk = int(np.argmax(np.hypot(e[:, 0], e[:, 1])))
    G = g.Grid(P, cell, floor, max_h, math.atan2(e[kk, 1], e[kk, 0]), 2.5 * max_h,
               max([t for _, _, t in prisms] + [max_h]))
    for o, b, t in prisms:
        G.add_prism(o, b, t)
    G.ctx[np.repeat(G.inplot[:, :, None], G.nz, 2)] = False
    nx, ny, nzp = G.nx, G.ny, G.nzp
    ca = cell * cell
    for it in items:
        it["unit_cells"] = max(1, int(round(it["unit_m2"] / ca)))
        it["placed"] = 0
    sd = g.sun_dirs(lat, lon); kd, kw = g.sky_dirs(); sdl = g.local_dirs(sd, G.R)
    ctx_plot = G.ctx[:, :, :nzp]
    def relight(occ):
        s_, k_ = g.light_fields(G, occ, sd, kd, kw)
        return s_, k_, g.cast_field(occ, ctx_plot, sdl, cell, floor)
    F = g.static_fields(G, roads, stops, wind_from, max_h)
    occ = np.zeros((nx, ny, nzp), np.int16)                 # item index + 1
    unit = np.zeros((nx, ny, nzp), np.int32)
    F["sun"], F["sky"], F["cast"] = relight(occ.astype(np.int8))
    F0 = {k: v.copy() for k, v in F.items()}
    plot3 = np.repeat(G.inplot[:, :, None], nzp, 2)
    zl = np.arange(nzp)[None, None, :]
    n_plot = G.inplot.sum()
    edge = np.zeros_like(G.inplot)
    for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
        edge |= G.inplot & ~g.shift(G.inplot, sh, a, fill=False)
    rng = np.random.RandomState(seed)
    total = sum(i["count"] * i["unit_cells"] * i["floors"] for i in items)
    hard = sorted([n for n, i in enumerate(items) if rank(i) >= 3], key=lambda n: -rank(items[n]))
    soft = [n for n in range(len(items)) if n not in hard]
    failed = {}
    placed_cells = 0; next_up = update * total; uid = 0; order = []
    core_id = len(items) + 1
    daylit = np.zeros(len(items) + 2, bool)
    for n, it in enumerate(items):
        daylit[n + 1] = it["profile"] in ("residential", "childcare")

    def masks():
        filled = occ > 0
        # every placed cell was supported when placed, so anything filled carries load;
        # cantilevers only reach off cells that themselves sit on something (no chains)
        sits = filled & ((zl == 0) | g.shift(filled, 1, 2))
        col = sits
        support = ((zl == 0) & plot3) | g.shift(filled, 1, 2)
        if cantilever:
            reach = np.zeros_like(filled)
            for a, sh in N4:
                reach |= g.shift(col, sh, a)
            support |= reach & (zl > 0)
        if min_base > 0:                                        # slenderness: broad enough base below
            b9 = filled.astype(np.int16)
            b9 = b9 + G_shift(b9, 1, 0) + G_shift(b9, -1, 0)
            b9 = b9 + G_shift(b9, 1, 1) + G_shift(b9, -1, 1)
            base = G_shift(b9, 1, 2)
            support &= (base >= min_base) | (zl <= 1)
        nb = np.zeros_like(filled)
        for a, sh in N6:
            nb |= g.shift(filled, sh, a)
        free = plot3 & ~filled & support
        if filled.any():
            free &= nb | (zl == 0)
        if filled[:, :, 0].sum() >= max_gsi * n_plot:           # ground coverage cap
            free[:, :, 0] = False
        # protect homes' last facade
        opn = np.zeros(filled.shape)
        for a, sh in N4:
            opn += ~g.shift(filled | ~plot3, sh, a, fill=True)
        last = daylit[occ] & (opn <= 1)
        bury = np.zeros_like(filled)
        for a, sh in N4:
            bury |= g.shift(last, sh, a)
        return filled, free & ~bury, opn

    def place(n):
        it = items[n]
        filled, free, opn = masks()
        ok = free.copy()
        if it["zmin"] >= 0: ok &= zl >= it["zmin"]
        if it["zmax"] >= 0: ok &= zl <= it["zmax"]
        if it["floors"] > 1:
            up = np.zeros_like(ok); up[:, :, :-1] = plot3[:, :, 1:] & ~filled[:, :, 1:]
            ok &= up
        if it["profile"] in DAYLIGHT:                      # no cell buried at birth
            ok &= opn > 0
        sc = item_score(G, F, it, items, occ) + rng.uniform(0, 1e-3, ok.shape)
        seeds = np.argwhere(ok)
        if it["frontage"]:
            seeds = seeds[edge[seeds[:, 0], seeds[:, 1]] & (seeds[:, 2] == 0)]
        seeds = seeds[np.argsort(-sc[seeds[:, 0], seeds[:, 1], seeds[:, 2]])][:12]
        for i0, j0, k0 in seeds:
            S = grow_unit(it, i0, j0, k0, ok[:, :, k0], sc)
            if S and k0 > 0:                                # no floating slabs: unit mostly on mass below
                on = sum(1 for i, j in S if filled[i, j, k0 - 1])
                if on < min_support * len(S):
                    continue
            if S:
                commit(n, it, k0, S)
                return True
        if os.environ.get("G005_DEBUG"):
            print("FAIL", it["name"], "free", int(free.sum()), "ok", int(ok.sum()), "seeds", len(seeds),
                  "ok by floor", [int(x) for x in ok.sum((0, 1))][:20])
        # no supported spot: lift the unit on pilotis with its own core underneath
        if it["frontage"] or it["zmax"] == 0:
            return False
        if not pilotis:                                     # solid plinth: fill under the whole unit
            kmin = max(1, it["zmin"])
            for k0 in range(kmin, min(nzp - it["floors"] + 1, kmin + 6)):
                lay = plot3[:, :, k0] & ~filled[:, :, k0]
                if it["floors"] > 1:
                    lay &= plot3[:, :, k0 + 1] & ~filled[:, :, k0 + 1]
                if it["zmax"] >= 0 and k0 > it["zmax"]:
                    break
                below = filled[:, :, :k0]
                emp = k0 - below.sum(2)                     # cells to fill under each column
                if it["profile"] in DAYLIGHT:
                    lay &= opn[:, :, k0] > 0
                # don't break the ground-cover cap or bury homes' last facade
                if filled[:, :, 0].sum() >= max_gsi * n_plot:
                    lay &= filled[:, :, 0]
                cs = np.argwhere(lay)
                if not len(cs):
                    continue
                sk = sc.copy(); sk[:, :, k0] = sc[:, :, k0] - 0.12 * emp
                cs = cs[np.argsort(-sk[cs[:, 0], cs[:, 1], k0])][:10]
                for i0, j0 in cs:
                    S = grow_unit(it, i0, j0, k0, lay, sk)
                    if S and sum(int(emp[i, j]) for i, j in S) > max_fill * len(S) * it["floors"]:
                        continue                            # would need a big solid base: skip
                    if S:
                        for i, j in S:
                            col = occ[i, j, :k0]
                            occ[i, j, :k0] = np.where(col == 0, core_id, col)
                        commit(n, it, k0, S)
                        return True
            return False
        colfree = np.cumsum(filled, axis=2) == 0                # nothing at or below
        below_empty = np.zeros_like(colfree); below_empty[:, :, 1:] = colfree[:, :, :-1]
        pil = plot3 & ~filled & below_empty & (zl > 0)
        if it["zmin"] >= 0: pil &= zl >= it["zmin"]
        if it["zmax"] >= 0: pil &= zl <= it["zmax"]
        if it["floors"] > 1:
            up = np.zeros_like(pil); up[:, :, :-1] = plot3[:, :, 1:] & ~filled[:, :, 1:]
            pil &= up
        kmin = max(1, it["zmin"])
        for k0 in range(kmin, min(nzp - it["floors"] + 1, kmin + 4)):
            lay = pil[:, :, k0] | ok[:, :, k0]
            cs = np.argwhere(pil[:, :, k0])
            if not len(cs):
                continue
            cores = (occ == core_id).any(2)
            near_core = np.zeros((nx, ny), bool)
            if cores.any():
                c2 = cores.copy()
                for _ in range(2):
                    c3 = c2.copy()
                    for a, sh in N4:
                        c3 |= G_shift(c2, sh, a)
                    c2 = c3
                near_core = c2
            sp = sc[:, :, k0] - 0.5 + 0.45 * near_core
            cs = cs[np.argsort(-sp[cs[:, 0], cs[:, 1]])][:8]
            for i0, j0 in cs:
                S = grow_unit(it, i0, j0, k0, lay, sc)
                if S:
                    if not near_core[i0, j0]:
                        occ[i0, j0, :k0] = core_id              # new core / stair column
                    else:                                       # reuse: extend nearest core up
                        cc = np.argwhere(cores & near_core)
                        d = np.hypot(cc[:, 0] - i0, cc[:, 1] - j0); ci, cj = cc[int(np.argmin(d))]
                        col = occ[ci, cj, :k0]
                        occ[ci, cj, :k0] = np.where(col == 0, core_id, col)
                    commit(n, it, k0, S)
                    return True
        return False

    def grow_unit(it, i0, j0, k0, lay, sc):
        S = [(i0, j0)]
        taken = np.zeros((nx, ny), bool); taken[i0, j0] = True
        dseed = np.hypot(np.arange(nx)[:, None] - i0, np.arange(ny)[None, :] - j0)
        while len(S) < it["unit_cells"]:
            cand = np.zeros((nx, ny), bool); touch = np.zeros((nx, ny))
            for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
                t_ = G_shift(taken, sh, a); cand |= t_; touch += t_
            cand &= lay & ~taken
            if not cand.any():
                return None
            s2 = np.where(cand, sc[:, :, k0] + 0.5 * touch - 0.25 * dseed / math.sqrt(it["unit_cells"]), -1e9)
            i, j = np.unravel_index(int(np.argmax(s2)), s2.shape)
            S.append((i, j)); taken[i, j] = True
        return S

    def commit(n, it, k0, S):
        for i, j in S:
            for f in range(it["floors"]):
                occ[i, j, k0 + f] = n + 1; unit[i, j, k0 + f] = len(order) + 1
        order.append((len(order), n, k0, S))

    def step(n):
        nonlocal placed_cells, next_up, uid
        if place(n):
            uid += 1; items[n]["placed"] += 1
            placed_cells += items[n]["unit_cells"] * items[n]["floors"]
            if placed_cells >= next_up:
                next_up += update * total
                F["sun"], F["sky"], F["cast"] = relight(occ.astype(np.int8))
            return True
        failed[items[n]["name"]] = failed.get(items[n]["name"], 0) + 1
        return False

    for n in hard:
        while items[n]["placed"] < items[n]["count"]:
            if not step(n):
                break
    for rnd in range(4):                                    # later rounds retry items that got stuck (mass below has grown)
        active = [n for n in soft if items[n]["placed"] < items[n]["count"]]
        while active:
            need = [(items[n]["count"] - items[n]["placed"]) / items[n]["count"] for n in active]
            n = active[int(np.argmax(need))]
            if not step(n) or items[n]["placed"] >= items[n]["count"]:
                active.remove(n)
            if log and uid % 40 == 0:
                log("units placed %d" % uid)
    F["sun"], F["sky"], F["cast"] = relight(occ.astype(np.int8))
    rep, comp = report(G, items, occ, unit, F, order)
    terr = g.terraces(G, occ.astype(np.int8), F["sun"])
    els, wwr = [], {}
    if facade:
        fz = _g006(libpath)
        els, wwr = fz.build_facade(G, occ, lambda v: cell_item(items, v)["profile"], F["sun"], sd,
                                   int(facade), fins, balconies, smin, smax)
    M = metrics(G, occ, items, terr, g.poly_area(P), comp)
    return dict(G=G, g=g, items=items, occ=occ, unit=unit, order=order, F=F, F0=F0, terr=terr,
                facade=els, wwr=wwr, facade_mode=int(facade), unsupported=load_check(occ),
                report=rep, compliance=comp, metrics=M, failed=failed)

def report(G, items, occ, unit, F, order):
    ca = G.cell * G.cell
    rows = []
    area_s, adj_s, sun_s = [], [], []
    for n, it in enumerate(items):
        m = occ == n + 1
        target = it["count"] * it["unit_m2"]
        got = it["placed"] * it["unit_cells"] * ca
        a_fit = max(0.0, 1 - abs(got - target) / target)
        # adjacency: share of units with a 'near' item within 1 cell; 'away' within 1 cell = violation
        near_ok = away_bad = 0
        units = [u for u in order if u[1] == n]
        for uid_, _, k0, S in units:
            um = unit == uid_ + 1
            ring = um.copy()
            for _ in range(2):                              # within 2 cells
                r2 = ring.copy()
                for a, sh in N6:
                    r2 |= G_shift(ring, sh, a)
                ring = r2
            ring &= ~um
            if it["near"]:
                near_ok += any((ring & (occ == [x["name"] for x in items].index(nm) + 1)).any() for nm in it["near"])
            if it["away"]:
                away_bad += any((ring & (occ == [x["name"] for x in items].index(nm) + 1)).any() for nm in it["away"])
        nu = max(1, len(units))
        adj = 1.0
        if it["near"] or it["away"]:
            adj = ((near_ok / nu) if it["near"] else 1.0) * (1 - away_bad / nu)
        sun_ok = float((F["sun"][m] >= it["min_sun"]).mean()) if (m.any() and it["min_sun"] > 0) else 1.0
        area_s.append(a_fit * target); adj_s.append(adj); sun_s.append(sun_ok * target)
        rows.append(dict(name=it["name"], profile=it["profile"], units="%d/%d" % (it["placed"], it["count"]),
                         target=target, achieved=got, dev=(got - target) / target, adjacency=adj, sun_ok=sun_ok,
                         colour=it["colour"]))
    nc = int((occ == len(items) + 1).sum())
    T = sum(r["target"] for r in rows)
    rows.append(dict(name="Base (auto)", profile="core", units="%d" % nc, target=0.0, achieved=nc * ca, dev=0.0,
                     adjacency=1.0, sun_ok=1.0, colour=CORE_COL))
    comp = 0.5 * sum(area_s) / T + 0.25 * float(np.mean(adj_s)) + 0.25 * sum(sun_s) / T
    return rows, comp

def load_check(occ):
    """Cells without a load path: carried = on the ground, on a carried cell, or a 1-cell
    overhang beside a cell that stands on something carried. Returns bool grid."""
    filled = occ > 0
    car = np.zeros_like(filled)
    for k in range(filled.shape[2]):
        direct = filled[:, :, k] & (car[:, :, k - 1] if k else True)
        reach = np.zeros_like(direct)
        for a, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            reach |= G_shift(direct, sh, a)
        car[:, :, k] = direct | (filled[:, :, k] & reach & (k > 0))
    return filled & ~car

def G_shift(a, sh, axis):
    out = np.zeros_like(a)
    src = [slice(None)] * a.ndim; dst = [slice(None)] * a.ndim
    if sh > 0:
        src[axis] = slice(0, -sh); dst[axis] = slice(sh, None)
    else:
        src[axis] = slice(-sh, None); dst[axis] = slice(0, sh)
    out[tuple(dst)] = a[tuple(src)]
    return out

def metrics(G, occ, items, terr, plot_area, comp):
    ca = G.cell * G.cell
    gfa = 0.0
    for n, it in enumerate(items):
        gfa += it["placed"] * it["unit_cells"] * ca                # double height counted once
    gfa += (occ == len(items) + 1).sum() * ca                       # cores
    fp = (occ > 0).any(2).sum() * ca
    h = ((occ > 0).any((0, 1)).nonzero()[0].max() + 1) * G.floor if (occ > 0).any() else 0
    return dict(gfa=gfa, footprint=fp, fsi=gfa / plot_area, gsi=fp / plot_area,
                osr=(plot_area - fp) / gfa if gfa else 0, height=h, terrace=terr.sum() * ca,
                compliance=comp, plot_area=plot_area)

def summary(res):
    M = res["metrics"]
    s = ("G005 | brief compliance {:.0%} | GFA {:,.0f} m2, FSI {:.2f}, GSI {:.2f}, height {:.0f} m | unsupported cells {}"
         .format(M["compliance"], M["gfa"], M["fsi"], M["gsi"], M["height"], int(res.get("unsupported", np.zeros(1)).sum())))
    short = [r["name"] + " " + r["units"] for r in res["report"] if r["achieved"] < r["target"] * 0.95]
    return s + (" | short: " + ", ".join(short) if short else " | all items fitted")

def report_lines(res):
    return ["{:<16} {:>6} units  target {:>6,.0f}  got {:>6,.0f} m2 ({:+.0%})  adj {:.0%}  sun {:.0%}".format(
        r["name"], r["units"], r["target"], r["achieved"], r["dev"], r["adjacency"], r["sun_ok"]) for r in res["report"]]

def cell_item(items, v):
    if v == len(items) + 1:
        return dict(name="Core", colour=CORE_COL, profile="core")
    return items[v - 1]

# ------------------------------------------------------------------ Rhino side
def build(plot_crv, P, context=None, scale=1.0, log=None):
    import Rhino.Geometry as rg
    import System.Drawing as sdw
    g = _g001(P.get("LibPath", ""))
    ok, pl = plot_crv.TryGetPolyline()
    if not ok:
        pl = plot_crv.ToPolyline(0.01 * scale, 1.0, 0.0, 0.0).ToPolyline()
    pts = [(p.X / scale, p.Y / scale) for p in pl]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    pr, roads, stops, ll = g._site_context()
    if context:
        pr = [([(x / scale, y / scale) for x, y in o], b / scale, t / scale) for o, b, t in g._brep_prisms(context)]
    brief = P.get("Brief") or DEMO_BRIEF
    if os.path.isfile(str(brief)):
        brief = open(brief).read()
    res = run(pts, pr, roads, stops, brief, P["Lat"], P["Lon"], P["MaxHeight"], P["Cell"], P["Floor"],
              P["MaxGSI"], int(P["Cantilever"]), P["WindDir"], P["Update"], int(P["Seed"]), P.get("LibPath", ""), log,
              facade=int(P["Facade"]), fins=bool(P["Fins"]), balconies=bool(P["Balconies"]),
              pilotis=bool(P["Pilotis"]), min_support=P["MinSupport"])
    G, occ, items = res["G"], res["occ"], res["items"]
    boxes, names, cols, labels = [], [], [], []
    for i, j, k in np.argwhere(occ > 0):
        it = cell_item(items, occ[i, j, k])
        c = g.cell_corners(G, i, j, k)
        boxes.append(rg.Brep.CreateFromBox([rg.Point3d(x * scale, y * scale, z * scale) for x, y, z in c]))
        names.append(it["name"]); cols.append(sdw.Color.FromArgb(*it["colour"]))
    for uid_, n, k0, S in res["order"]:
        cs = [g.cell_corners(G, i, j, k0) for i, j in S]
        x = np.mean([p[0] for c in cs for p in c[:4]]); y = np.mean([p[1] for c in cs for p in c[:4]])
        z = (k0 + 0.5 * items[n]["floors"]) * G.floor
        labels.append((rg.Point3d(x * scale, y * scale, z * scale), items[n]["name"]))
    fac, fkind = [], []
    if res["facade"]:
        fz = _g006(P.get("LibPath", ""))
        groups = {}
        for kind, v, vs in res["facade"]:
            groups.setdefault((kind, v if kind == "wall" else 0), []).append(vs)
        for (kind, v), lst in groups.items():
            m = rg.Mesh()
            for vs in lst:
                n0 = m.Vertices.Count
                for x, y, z in vs:
                    m.Vertices.Add(x * scale, y * scale, z * scale)
                if len(vs) == 4:
                    m.Faces.AddFace(n0, n0 + 1, n0 + 2, n0 + 3)
                else:
                    for a, b, c, d in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                        m.Faces.AddFace(n0 + a, n0 + b, n0 + c, n0 + d)
            m.Normals.ComputeNormals(); m.Compact()
            col = cell_item(items, v)["colour"] if kind == "wall" else fz.FACADE_COL[kind]
            fac.append(m); fkind.append((kind if kind != "wall" else "Wall " + cell_item(items, v)["name"],
                                         sdw.Color.FromArgb(*col)))
        boxes, names, cols = [], [], []                 # facade replaces the plain boxes
    try:
        import scriptcontext as sc
        sc.sticky["G005_result"] = dict(report=res["report"], metrics=res["metrics"])
    except Exception:
        pass
    rep = report_lines(res)
    if res["wwr"]:
        rep += _g006(P.get("LibPath", "")).wwr_lines(res["wwr"])
    return boxes, names, cols, labels, rep, res["compliance"], res["metrics"], summary(res), fac, fkind

DEFAULTS = dict(Lat=51.92, Lon=4.48, MaxHeight=60.0, Cell=6.0, Floor=3.5, MaxGSI=0.7, Cantilever=1,
                WindDir=225.0, Update=0.1, Seed=1, Brief="", LibPath="", Run=True,
                Facade=1, Fins=True, Balconies=True, Pilotis=False, MinSupport=0.6)

def run_command():
    import Rhino, rhinoscriptsyntax as rs
    import scriptcontext as sc
    P = dict(DEFAULTS); P.update(sc.sticky.get("G005_opts", {}))
    go = Rhino.Input.Custom.GetObject()
    go.SetCommandPrompt("Select closed plot curve")
    go.GeometryFilter = Rhino.DocObjects.ObjectType.Curve
    opts = {}
    for k in ("Lat", "Lon", "MaxHeight", "Cell", "Floor", "MaxGSI", "WindDir", "Update"):
        opts[k] = Rhino.Input.Custom.OptionDouble(P[k]); go.AddOptionDouble(k, opts[k])
    ct = Rhino.Input.Custom.OptionToggle(bool(P["Cantilever"]), "No", "Yes"); go.AddOptionToggle("Cantilever", ct)
    fins = Rhino.Input.Custom.OptionToggle(bool(P["Fins"]), "No", "Yes"); go.AddOptionToggle("Fins", fins)
    bal = Rhino.Input.Custom.OptionToggle(bool(P["Balconies"]), "No", "Yes"); go.AddOptionToggle("Balconies", bal)
    pil = Rhino.Input.Custom.OptionToggle(bool(P["Pilotis"]), "No", "Yes"); go.AddOptionToggle("Pilotis", pil)
    msu = Rhino.Input.Custom.OptionDouble(P["MinSupport"], 0.0, 1.0); go.AddOptionDouble("MinSupport", msu)
    fmode = [int(P["Facade"])]
    modes = ["Off", "Typology", "SunResponsive"]
    fi = go.AddOptionList("Facade", modes, fmode[0])
    while True:
        r = go.Get()
        if r == Rhino.Input.GetResult.Option:
            if go.OptionIndex() == fi:
                fmode[0] = go.Option().CurrentListOptionIndex
            continue
        if r != Rhino.Input.GetResult.Object:
            return
        break
    for k, o in opts.items():
        P[k] = o.CurrentValue
    P["Cantilever"] = 1 if ct.CurrentValue else 0
    P["Facade"] = fmode[0]; P["Fins"] = fins.CurrentValue; P["Balconies"] = bal.CurrentValue
    P["Pilotis"] = pil.CurrentValue; P["MinSupport"] = msu.CurrentValue
    f = rs.OpenFileName("Brief CSV (Cancel = demo brief)", "CSV (*.csv)|*.csv||")
    P["Brief"] = f or ""
    sc.sticky["G005_opts"] = dict((k, P[k]) for k in P if k != "Run")
    crv = go.Object(0).Curve()
    scale = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    boxes, names, cols, labels, rep, comp, M, info, fac, fkind = build(crv, P, scale=scale, log=print)
    ids = []
    for b, n, c in zip(boxes, names, cols):
        lname = "G005::" + n
        if not rs.IsLayer(lname):
            rs.AddLayer(lname, (c.R, c.G, c.B))
        oid = sc.doc.Objects.AddBrep(b); rs.ObjectLayer(oid, lname); ids.append(oid)
    for m, (kn, c) in zip(fac, fkind):
        lname = "G005::Facade::" + kn
        if not rs.IsLayer(lname):
            rs.AddLayer(lname, (c.R, c.G, c.B))
        oid = sc.doc.Objects.AddMesh(m); rs.ObjectLayer(oid, lname); ids.append(oid)
    if not rs.IsLayer("G005::Labels"):
        rs.AddLayer("G005::Labels", (60, 60, 60))
    for pt, t in labels:
        d = rs.AddTextDot(t, pt); rs.ObjectLayer(d, "G005::Labels"); ids.append(d)
    rs.AddObjectsToGroup(ids, rs.AddGroup())
    sc.doc.Views.Redraw()
    for line in rep:
        print(line)
    print(info)

if __name__ == "__main__":
    try:
        ghenv  # noqa
        gl = globals()
        P = dict(DEFAULTS)
        for k in DEFAULTS:
            if gl.get(k) is not None:
                P[k] = gl.get(k)
        if gl.get("Plot") is not None and P["Run"]:
            import Rhino, scriptcontext as sc
            scale = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
            boxes, item, colours, labels, report_, compliance, metrics, info, facade, facade_layer = build(gl["Plot"], P, gl.get("Context"), scale)
            facade_layer = [k for k, c in facade_layer]
            report = report_
        else:
            boxes = item = colours = labels = report = facade = facade_layer = []
            compliance = 0.0; metrics = {}; info = "Connect a closed Plot curve"
    except NameError:
        run_command()
