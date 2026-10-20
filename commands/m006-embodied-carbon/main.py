"""
M006  Embodied Carbon Estimate  (early-stage, CarbonSpace-style quantities x factors,
      checked against a HENN CarbonBudget 1.5 C budget; reuse vs new)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: EmbodiedCarbon).

"Rough is good enough": quantities come straight from the massing (floor plates,
footprint, facade, roof), each multiplied by a kg CO2e per m2 factor for the chosen
structure / facade system. Factors are Okobaudat-order ballpark values (A1-A3,
fossil GWP; biogenic storage reported separately, not subtracted), then
    A4-A5 transport + construction   +7 % of A1-A3
    B4    replacements over 50 years  MEP x1, fit-out x1, roof x0.5, glazing x0.3 ...
    C1-C4 end of life                 +3 % (mineral / steel), +8 % (timber)
Result = kg CO2e (A1-A5, B4, C1-C4) total and per m2 GFA, the same module scope as
the HENN budget (Betti et al. 2025, Buildings & Cities 6(1), doi 10.5334/bc.664;
open v1 spreadsheet, zenodo 15773791): embodied budget per m2 NFA for the completion
year and use mix (area weighted). NFA = GFA x NetRatio (default 0.82).

Reuse vs new: give the existing building as Existing. Per level, floor area of the new
massing inside the existing plates counts as REUSED structure (repair factor), the rest
as NEW; existing area not kept is DEMOLISHED (C1 only). An all-new baseline of the same
massing is always computed too, so you see the carbon saved by reuse.

GH INPUTS:
    Mass      : closed Brep(s)/Mesh(es)  proposed massing
    Existing  : closed Brep(s)          existing building(s) to keep where they overlap (optional)
    Structure : str   Concrete | Steel | Hybrid | Timber                   (default Concrete)
    Facade    : str   Curtain | Brick | Precast | Timber | Metal           (default Brick)
    WWR       : float window-to-wall ratio 0..1                            (default 0.4)
    KeepFacade: bool  reused part keeps its facade (refurbished)           (default False)
    Mix       : str   use mix "residential:0.7, office:0.3" (residential, office, retail,
                      parking, culture, health, science, industry)         (default residential)
    Year      : int   completion year 2020..2050                           (default 2030)
    Basement  : int   basement levels under the footprint                  (default 0)
    NetRatio  : float NFA / GFA                                            (default 0.82)
    Floor, First : floor-to-floor / ground floor height, metres (3.2 / 4.0)
    Bar       : bool  draw the stacked carbon bar + budget line            (default True)
    Units     : float model units per metre                                (default 1)
GH OUTPUTS:
    plates    : floor plates (new + reused), plate_col: colours (reused emerald, new orange)
    bar, bar_col, bar_text, bar_pl, bar_size : stacked bar meshes + labels (-> Text Tag 3D)
    total     : t CO2e (A-C) ; intensity : kg CO2e/m2 GFA ; budget : kg CO2e/m2 GFA
    ratio     : intensity / budget ; breakdown : [(element, t CO2e)]
    baseline  : t CO2e if everything were new ; saved : t CO2e saved by reuse
    metrics   : plain dict (also sc.sticky["M006_carbon"]) ; info : summary text

RHINO COMMAND / ALIAS:
    Alias  EmbodiedCarbon  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\M006_embodied_carbon.py"
    Select masses, then existing buildings (Enter = all new). Options: Structure, Facade,
    WWR, KeepFacade, Use, Year, Basement, FloorHeight, GroundFloorHeight, Bar.
    Bakes plates on M006::New / M006::Reused and the bar on M006::Bar, grouped.
"""
from __future__ import division, print_function
import math, os, sys

DEFAULTS = dict(Structure="Concrete", Facade="Brick", WWR=0.4, KeepFacade=False,
                Mix="residential", Year=2030, Basement=0, NetRatio=0.82,
                Floor=3.2, First=4.0, Bar=True, Units=1.0)
STRUCTURES = ["Concrete", "Steel", "Hybrid", "Timber"]
FACADES = ["Curtain", "Brick", "Precast", "Timber", "Metal"]
USES = ["residential", "office", "retail", "parking", "culture", "health", "science", "industry"]

# --------------------------------------------------------------- carbon factors
# kg CO2e (A1-A3, fossil) per m2 of element. Ballpark early-stage values in the
# Okobaudat / IStructE range; edit here (or pass Factors=dict in GH) to calibrate.
STRUCT = {   # frame + floors per m2 GFA | substructure weight | biogenic kg per m2 GFA | EoL
    "Concrete": dict(frame=190.0, weight=1.00, bio=0.0, eol=0.03),
    "Steel":    dict(frame=210.0, weight=0.85, bio=0.0, eol=0.03),
    "Hybrid":   dict(frame=120.0, weight=0.75, bio=-110.0, eol=0.05),   # CLT slabs, steel/RC frame + core
    "Timber":   dict(frame=85.0,  weight=0.60, bio=-210.0, eol=0.08),   # CLT + glulam, RC core
}
REUSED_FRAME = 15.0          # repair / strengthening of kept structure, per m2 GFA
SUB_FOOT = 250.0             # piles + caps + ground slab per m2 footprint (NL soft soil)
SUB_BASEMENT = 450.0         # per m2 basement floor (walls, slab, excavation)
REUSED_SUB = 0.2             # kept foundations: share of new substructure (strengthening)
GLAZING = 280.0              # aluminium frame, triple glazing, per m2 glazed
OPAQUE = {"Curtain": 260.0, "Brick": 110.0, "Precast": 130.0, "Timber": 45.0, "Metal": 95.0}
REFURB_FACADE = 25.0         # kept facade: insulation + new glazing share, per m2
ROOF = 70.0                  # insulation, membrane, parapets per m2 roof
FITOUT = {"residential": 55.0, "office": 45.0, "retail": 40.0, "parking": 5.0,
          "culture": 50.0, "health": 60.0, "science": 60.0, "industry": 20.0}
MEP = {"residential": 55.0, "office": 85.0, "retail": 70.0, "parking": 10.0,
       "culture": 80.0, "health": 120.0, "science": 120.0, "industry": 50.0}
DEMOLITION = 15.0            # C1 per m2 demolished GFA
A4A5 = 0.07
B4 = dict(MEP=1.0, Fitout=1.0, Roof=0.5, Glazing=0.3, Opaque=0.1, Structure=0.0, Substructure=0.0)

# HENN CarbonBudget v1 (zenodo 15773791, Data sheet): EMBODIED budget per m2 NFA,
# kg CO2e for completion years 2020..2050 (A1-A5, B4, C1-C4, 50-year period).
BUDGET_Y0 = 2020
BUDGET_EC = {
    "office":      [1027,1027,891,777,681,599,566,533,478,429,410,366,342,305,271,247,232,204,178,153,130,122,108,95,82,70,62,50,38,26,26],
    "science":     [1069,1069,928,809,709,624,590,556,498,447,427,382,356,317,282,257,241,212,185,159,135,127,112,99,86,73,64,52,39,27,27],
    "industry":    [770,770,668,583,511,449,425,400,358,322,308,275,256,228,203,185,174,153,133,115,97,91,81,71,62,53,46,37,28,20,20],
    "health":      [1155,1155,1002,874,766,673,637,600,538,483,461,412,384,343,305,278,261,229,200,172,146,137,121,107,93,79,69,56,42,29,29],
    "culture":     [1069,1069,928,809,709,624,590,556,498,447,427,382,356,317,282,257,241,212,185,159,135,127,112,99,86,73,64,52,39,27,27],
    "parking":     [770,770,668,583,511,449,425,400,358,322,308,275,256,228,203,185,174,153,133,115,97,91,81,71,62,53,46,37,28,20,20],
    "retail":      [1119,1119,968,841,732,638,596,556,494,439,415,366,340,300,265,239,223,195,169,144,122,114,100,88,76,64,57,45,34,24,13],
    "residential": [613,613,546,491,445,407,355,326,300,277,264,226,207,189,172,154,137,123,110,97,84,76,69,62,56,49,41,34,27,20,11],
}
BUDGET_OC = {   # operational (B6.1, CRREM) per m2 NFA, for reference only
    "office":      [555,500,450,403,359,320,284,251,222,196,172,152,133,117,103,92,82,74,67,63,59,56,54,52,51,50,49,48,48,47,47],
    "residential": [321,287,257,228,202,178,157,137,120,104,90,78,67,58,50,43,37,33,29,26,24,23,21,20,20,19,18,18,18,18,17],
    "retail":      [726,654,587,525,468,416,369,325,287,252,221,193,169,148,130,114,101,90,82,76,71,67,64,62,60,59,57,57,56,55,55],
}

# element colours (MVRDV palette pops) for bar + legend
ELEMENTS = [("Substructure", (120, 120, 120)), ("Structure", (255, 120, 0)),
            ("Facade", (0, 133, 255)), ("Roof", (150, 205, 255)), ("Fit-out", (255, 210, 0)),
            ("MEP", (230, 0, 126)), ("A4-A5", (190, 190, 190)), ("B4 replace", (255, 160, 200)),
            ("C end of life", (90, 90, 90)), ("Demolition", (40, 40, 40))]
NEW_RGB, REUSED_RGB = (255, 120, 0), (0, 170, 110)

# ---------------------------------------------------------------- pure maths
def parse_mix(mix):
    """'residential:0.7, office:0.3' (or a list of pairs / one name) -> {use: share}, sums to 1."""
    if not mix:
        return {"residential": 1.0}
    if isinstance(mix, dict):
        items = list(mix.items())
    elif isinstance(mix, (list, tuple)):
        items = []
        for s in mix:
            items += list(parse_mix(s).items())
    else:
        items = []
        for part in str(mix).replace(";", ",").split(","):
            part = part.strip()
            if not part:
                continue
            if ":" in part:
                k, v = part.split(":", 1)
                items.append((k.strip(), float(v)))
            else:
                items.append((part, 1.0))
    out = {}
    for k, v in items:
        k = k.strip().lower()
        k = {"housing": "residential", "res": "residential", "logistics": "parking",
             "shop": "retail", "shops": "retail", "lab": "science", "offices": "office"}.get(k, k)
        if k not in USES:
            raise ValueError("Unknown use '{0}' (use one of {1})".format(k, ", ".join(USES)))
        out[k] = out.get(k, 0.0) + max(0.0, float(v))
    t = sum(out.values())
    if t <= 0:
        raise ValueError("Use mix shares must be > 0")
    return dict((k, v / t) for k, v in out.items())

def budget_per_nfa(mix, year, table=None):
    """Area-weighted HENN embodied budget, kg CO2e per m2 NFA, for a completion year."""
    table = table or BUDGET_EC
    i = int(round(min(max(year, BUDGET_Y0), BUDGET_Y0 + 30))) - BUDGET_Y0
    return sum(s * table[u][i] for u, s in mix.items() if u in table)

def _weighted(d, mix):
    return sum(s * d[u] for u, s in mix.items())

def estimate(q, structure="Concrete", facade="Brick", wwr=0.4, keep_facade=False,
             mix=None, year=2030, net_ratio=0.82):
    """q: quantities in m2: gfa, gfa_reused, footprint, footprint_reused, facade, roof,
    basement (m2 basement floor), demolished (m2 existing GFA removed).
    Returns dict with breakdown {element: kg}, total kg, intensity, budget, ratio ..."""
    s = STRUCT[structure]
    mix = mix if isinstance(mix, dict) else parse_mix(mix)
    wwr = min(max(float(wwr), 0.0), 1.0)
    gfa = max(q["gfa"], 1e-9)
    g_re = min(q.get("gfa_reused", 0.0), gfa)
    g_new = gfa - g_re
    f_re = min(q.get("footprint_reused", 0.0), q["footprint"])
    f_new = q["footprint"] - f_re
    keep = (g_re / gfa) if keep_facade else 0.0
    fac_keep = q["facade"] * keep
    fac_new = q["facade"] - fac_keep
    a = {}
    a["Substructure"] = SUB_FOOT * s["weight"] * (f_new + REUSED_SUB * f_re) + SUB_BASEMENT * q.get("basement", 0.0)
    a["Structure"] = s["frame"] * g_new + REUSED_FRAME * g_re
    glaz = GLAZING * fac_new * wwr
    opaq = OPAQUE[facade] * fac_new * (1 - wwr)
    a["Facade"] = glaz + opaq + REFURB_FACADE * fac_keep
    a["Roof"] = ROOF * q["roof"]
    a["Fit-out"] = _weighted(FITOUT, mix) * gfa
    a["MEP"] = _weighted(MEP, mix) * gfa
    a13 = sum(a.values())
    b = dict(a)
    b["A4-A5"] = A4A5 * a13
    b["B4 replace"] = (B4["MEP"] * a["MEP"] + B4["Fitout"] * a["Fit-out"] + B4["Roof"] * a["Roof"]
                       + B4["Glazing"] * glaz + B4["Opaque"] * opaq)
    mineral = a13 - a["Structure"]
    b["C end of life"] = 0.03 * mineral + s["eol"] * a["Structure"]
    b["Demolition"] = DEMOLITION * q.get("demolished", 0.0)
    total = sum(b.values())
    nfa = gfa * net_ratio
    bud_nfa = budget_per_nfa(mix, year)
    budget_total = bud_nfa * nfa
    return dict(breakdown=b, a1a3=a13, total=total, gfa=gfa, gfa_reused=g_re, nfa=nfa,
                intensity=total / gfa, intensity_nfa=total / nfa,
                budget_nfa=bud_nfa, budget=budget_total / gfa, budget_total=budget_total,
                ratio=total / budget_total if budget_total > 0 else None,
                biogenic=s["bio"] * g_new, structure=structure, facade=facade, wwr=wwr,
                mix=mix, year=int(year), net_ratio=net_ratio, quantities=dict(q))

def compare(q, **kw):
    """Estimate with reuse, plus the all-new baseline of the same massing."""
    r = estimate(q, **kw)
    q0 = dict(q, gfa_reused=0.0, footprint_reused=0.0, demolished=q.get("demolished", 0.0) + q.get("gfa_reused", 0.0))
    kw0 = dict(kw, keep_facade=False)
    b = estimate(q0, **kw0)
    r["baseline"] = b["total"]
    r["saved"] = b["total"] - r["total"]
    return r

def verdict(ratio):
    if ratio is None:
        return "-"
    if ratio <= 1.0:
        return "within 1.5 C budget"
    if ratio <= 1.5:
        return "over budget x{0:.2f}".format(ratio)
    return "far over budget x{0:.2f}".format(ratio)

def summary(r):
    mix = ", ".join("{0} {1:.0f}%".format(k, 100 * v) for k, v in sorted(r["mix"].items(), key=lambda kv: -kv[1]))
    s = ("{0} frame, {1} facade (WWR {2:.0f}%) | {3} | GFA {4:,.0f} m2 ({5:,.0f} reused) | "
         "embodied A-C {6:,.0f} t CO2e = {7:.0f} kg/m2 GFA | 1.5 C budget {8} {9:.0f} kg/m2 GFA "
         "({10:.0f}/m2 NFA) -> {11}".format(
             r["structure"], r["facade"], 100 * r["wwr"], mix, r["gfa"], r["gfa_reused"],
             r["total"] / 1000.0, r["intensity"], r["year"], r["budget"], r["budget_nfa"], verdict(r["ratio"])))
    if r.get("gfa_reused", 0) > 0 and "baseline" in r:
        s += " | all-new {0:,.0f} t, reuse saves {1:,.0f} t ({2:.0f}%)".format(
            r["baseline"] / 1000.0, r["saved"] / 1000.0, 100.0 * r["saved"] / max(r["baseline"], 1e-9))
    if r["biogenic"] < 0:
        s += " | biogenic stored {0:,.0f} t (not counted)".format(-r["biogenic"] / 1000.0)
    return s

def bar_layout(r, origin=(0.0, 0.0, 0.0), height=20.0, width=4.0, gap=2.0, unit=1.0):
    """Stacked bar(s) as boxes: [(label, rgb, (x0, y0, z0, x1, y1, z1))], texts [(str, (x,y,z), size)].
    Bar height = intensity scaled so the budget line sits at `height`. Second bar = all-new baseline."""
    ox, oy, oz = origin
    scale = height / max(r["budget"], 1e-9)
    boxes, texts = [], []
    ts = max(height / 22.0, 0.3 * unit)
    bars = [("This option", r["breakdown"], r["total"])]
    if r.get("gfa_reused", 0) > 0 and "baseline" in r:
        bars.append(("All new", None, r["baseline"]))
    names = [n for n, _ in ELEMENTS]
    top_max = 0.0
    for bi, (lab, bd, tot) in enumerate(bars):
        x0 = ox + bi * (width + gap)
        z = oz
        if bd is None:                         # baseline: single grey block
            h = tot / r["gfa"] * scale
            boxes.append((lab, (170, 170, 170), (x0, oy, z, x0 + width, oy + width, z + h)))
            z += h
        else:
            for n in names:
                v = bd.get(n, 0.0)
                if v <= 0:
                    continue
                h = v / r["gfa"] * scale
                rgb = dict(ELEMENTS)[n]
                boxes.append((n, rgb, (x0, oy, z, x0 + width, oy + width, z + h)))
                if bi == 0 and h > ts * 1.2:
                    texts.append(("{0} {1:.0f}".format(n, v / r["gfa"]), (x0 + width + 0.4 * ts, oy, z + h / 2 - ts / 2), ts))
                z += h
        texts.append(("{0}\n{1:.0f} kg/m2".format(lab, tot / r["gfa"]), (x0, oy, z + 0.6 * ts), ts * 1.1))
        top_max = max(top_max, z)
    w_all = len(bars) * width + (len(bars) - 1) * gap
    line = (ox - 0.5 * width, oy, oz + height, ox + w_all + 6 * ts * 3, oy, oz + height)
    texts.append(("1.5 C budget {0}: {1:.0f} kg/m2 GFA".format(r["year"], r["budget"]),
                  (line[3] - 6 * ts * 3, oy, oz + height + 0.3 * ts), ts))
    texts.append(("Embodied carbon A1-C4, kg CO2e/m2 GFA", (ox, oy, oz - 1.6 * ts), ts))
    return boxes, line, texts, top_max

# ------------------------------------------------------------ rhino geometry
def _m003(libpath=""):
    here = None
    try:
        here = os.path.dirname(os.path.abspath(__file__))
    except NameError:
        pass
    for p in (libpath, here, r"C:\Scripts\GH-Library", os.path.join(os.path.expanduser("~"), "GH-Library")):
        if p and os.path.isdir(p) and p not in sys.path:
            sys.path.append(p)
    import M003_density_metrics as m3
    return m3

def _union(breps, tol):
    import Rhino.Geometry as rg
    if len(breps) > 1:
        un = rg.Brep.CreateBooleanUnion(breps, tol)
        if un:
            return list(un)
    return breps

def _outer_inner(plates):
    import Rhino.Geometry as rg
    out = []
    for p in plates:
        for f in p.Faces:
            for l in f.Loops:
                out.append((l.To3dCurve(), l.LoopType == rg.BrepLoopType.Outer))
    return out

def _overlap(new_plates, old_plates, tol):
    """Area of new plates lying inside old plates (same level)."""
    import Rhino.Geometry as rg
    if not new_plates or not old_plates:
        return 0.0, []
    keep = []
    area = 0.0
    for a in new_plates:
        for b in old_plates:
            # planar regions: intersect outer loops (courtyard holes ignored: early-stage)
            ca = [c for c, o in _outer_inner([a]) if o]
            cb = [c for c, o in _outer_inner([b]) if o]
            for x in ca:
                for y in cb:
                    ix = rg.Curve.CreateBooleanIntersection(x, y, tol)
                    if not ix:
                        continue
                    regs = rg.Brep.CreatePlanarBreps(list(ix), tol) or []
                    for g in regs:
                        mp = rg.AreaMassProperties.Compute(g)
                        if mp:
                            area += mp.Area
                            keep.append(g)
    return area, keep

def quantities(Mass, Existing, Floor, First, Basement, Units, tol, m3):
    """Slice massing (+ existing) with M003 helpers -> quantities dict + plates."""
    import Rhino.Geometry as rg
    u = float(Units) or 1.0
    m2 = 1.0 / (u * u)
    breps = _union(m3._as_breps(Mass), tol)
    if not breps:
        raise ValueError("Nothing to measure: connect closed breps/meshes to Mass")
    old = _union(m3._as_breps(Existing), tol) if Existing else []
    plates, levels, met, _ = m3.build(breps, None, Floor, First, 0.0, u, tol)
    bb = rg.BoundingBox.Empty
    for b in breps + old:
        bb.Union(b.GetBoundingBox(True))
    reused_area, reused_plates, new_plates = 0.0, [], []
    for z in levels:
        nps = m3._plates_at(breps, z + 0.05 * u, tol)
        ops = m3._plates_at(old, z + 0.05 * u, tol) if old else []
        a, keep = _overlap(nps, ops, tol)
        for g in keep:
            g.Translate(0, 0, -0.05 * u)
        reused_area += a
        reused_plates += keep
    for p in plates:
        new_plates.append(p)
    old_gfa = 0.0
    fr = 0.0
    if old:
        obb = rg.BoundingBox.Empty
        for b in old:
            obb.Union(b.GetBoundingBox(True))
        for z in m3.level_heights(obb.Min.Z, obb.Max.Z, First * u, Floor * u, 2.0 * u):
            old_gfa += m3._area(m3._plates_at(old, z + 0.05 * u, tol))
        g0n = m3._plates_at(breps, bb.Min.Z + 0.05 * u, tol)
        g0o = m3._plates_at(old, bb.Min.Z + 0.05 * u, tol)
        fr, _ = _overlap(g0n, g0o, tol)
    facade = sum(met["facade"])
    q = dict(gfa=met["gfa"], gfa_reused=reused_area * m2, footprint=met["footprint"],
             footprint_reused=fr * m2, facade=facade, roof=met["roof"],
             basement=met["footprint"] * int(Basement),
             demolished=max(0.0, old_gfa * m2 - reused_area * m2))
    return q, new_plates, reused_plates, levels, breps

def _box_mesh(x0, y0, z0, x1, y1, z1, rgb):
    import Rhino.Geometry as rg
    import System
    bx = rg.Box(rg.BoundingBox(rg.Point3d(x0, y0, z0), rg.Point3d(x1, y1, z1)))
    m = rg.Mesh.CreateFromBox(bx, 1, 1, 1)
    m.VertexColors.CreateMonotoneMesh(System.Drawing.Color.FromArgb(*rgb))
    return m

def build(Mass, Existing=None, Structure="Concrete", Facade="Brick", WWR=0.4, KeepFacade=False,
          Mix="residential", Year=2030, Basement=0, NetRatio=0.82, Floor=3.2, First=4.0,
          Bar=True, Units=1.0, tol=0.001, libpath=""):
    import Rhino.Geometry as rg
    m3 = _m003(libpath)
    st = _pick(Structure, STRUCTURES)
    fa = _pick(Facade, FACADES)
    q, plates, reused, levels, breps = quantities(Mass, Existing, Floor, First, Basement, Units, tol, m3)
    r = compare(q, structure=st, facade=fa, wwr=WWR, keep_facade=bool(KeepFacade),
                mix=parse_mix(Mix), year=int(Year), net_ratio=float(NetRatio))
    u = float(Units) or 1.0
    bb = rg.BoundingBox.Empty
    for b in breps:
        bb.Union(b.GetBoundingBox(True))
    bars, texts = [], []
    if Bar:
        size = max(bb.Max.X - bb.Min.X, bb.Max.Y - bb.Min.Y)
        h = max(0.5 * size, 10.0 * u)
        origin = (bb.Max.X + 0.15 * size + 2 * u, bb.Center.Y, bb.Min.Z)
        boxes, line, txt, _ = bar_layout(r, origin, h, max(h / 6.0, 1.0 * u), max(h / 10.0, 0.5 * u), u)
        for lab, rgb, (x0, y0, z0, x1, y1, z1) in boxes:
            bars.append((_box_mesh(x0, y0, z0, x1, y1, z1, rgb), rgb))
        bars.append((rg.LineCurve(rg.Point3d(*line[:3]), rg.Point3d(*line[3:])), (230, 0, 126)))
        texts = txt
    r["info"] = summary(r)
    try:
        import scriptcontext as sc
        sc.sticky["M006_carbon"] = dict((k, v) for k, v in r.items() if k != "info")
    except Exception:
        pass
    return plates, reused, bars, texts, r

def _pick(v, options):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return options[int(v) % len(options)]
    s = str(v).strip().lower()
    for o in options:
        if o.lower().startswith(s[:3]):
            return o
    raise ValueError("'{0}' not in {1}".format(v, options))

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

def _text_plane(p):
    import Rhino.Geometry as rg
    return rg.Plane(rg.Point3d(*p), rg.Vector3d.XAxis, rg.Vector3d.ZAxis)   # upright, facing -Y

def run_command():
    import Rhino, System
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    from Rhino.Input.Custom import GetObject, OptionDouble, OptionInteger, OptionToggle
    key = "M006_carbon_opts"
    v = dict(DEFAULTS); v.update(sc.sticky.get(key, {}))
    v["Use"] = v.get("Use", "residential")
    ft = Rhino.DocObjects.ObjectType
    go = GetObject()
    go.SetCommandPrompt("Select proposed masses")
    go.GeometryFilter = ft.Brep | ft.Extrusion | ft.Mesh
    o_wwr = OptionDouble(float(v["WWR"]), 0.0, 1.0)
    o_year = OptionInteger(int(v["Year"]), 2020, 2050)
    o_base = OptionInteger(int(v["Basement"]), 0, 10)
    o_fl = OptionDouble(float(v["Floor"])); o_fi = OptionDouble(float(v["First"]))
    o_keep = OptionToggle(bool(v["KeepFacade"]), "No", "Yes")
    o_bar = OptionToggle(bool(v["Bar"]), "No", "Yes")
    while True:
        go.ClearCommandOptions()
        i_st = go.AddOptionList("Structure", STRUCTURES, STRUCTURES.index(_pick(v["Structure"], STRUCTURES)))
        i_fa = go.AddOptionList("Facade", FACADES, FACADES.index(_pick(v["Facade"], FACADES)))
        i_use = go.AddOptionList("Use", [x.capitalize() for x in USES], USES.index(v["Use"]))
        go.AddOptionDouble("WWR", o_wwr)
        go.AddOptionToggle("KeepFacade", o_keep)
        go.AddOptionInteger("Year", o_year)
        go.AddOptionInteger("Basement", o_base)
        go.AddOptionDouble("FloorHeight", o_fl)
        go.AddOptionDouble("GroundFloorHeight", o_fi)
        go.AddOptionToggle("Bar", o_bar)
        res = go.GetMultiple(1, 0)
        if res == Rhino.Input.GetResult.Option:
            idx = go.OptionIndex(); li = go.Option().CurrentListOptionIndex
            if idx == i_st: v["Structure"] = STRUCTURES[li]
            elif idx == i_fa: v["Facade"] = FACADES[li]
            elif idx == i_use: v["Use"] = USES[li]
            go.EnablePreSelect(False, True)
            continue
        if res != Rhino.Input.GetResult.Object:
            return
        break
    mass = [go.Object(i).Geometry() for i in range(go.ObjectCount)]
    v.update(WWR=o_wwr.CurrentValue, Year=o_year.CurrentValue, Basement=o_base.CurrentValue,
             Floor=o_fl.CurrentValue, First=o_fi.CurrentValue, KeepFacade=o_keep.CurrentValue,
             Bar=o_bar.CurrentValue)
    sc.sticky[key] = v
    ids = rs.GetObjects("Select EXISTING buildings to keep (Enter = all new)", rs.filter.polysurface | rs.filter.extrusion | rs.filter.mesh, preselect=False)
    old = [rs.coercegeometry(i) for i in ids] if ids else None
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    try:
        plates, reused, bars, texts, r = build(mass, old, v["Structure"], v["Facade"], v["WWR"],
                                               v["KeepFacade"], v["Use"], v["Year"], v["Basement"],
                                               v["NetRatio"], v["Floor"], v["First"], v["Bar"], f,
                                               sc.doc.ModelAbsoluteTolerance)
    except Exception as e:
        print("EmbodiedCarbon: {0}".format(e))
        return
    _layer(sc.doc, "M006", (120, 120, 120))
    out = []
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = _layer(sc.doc, "New", NEW_RGB, "M006")
    out += [sc.doc.Objects.AddBrep(p, a) for p in plates]
    if reused:
        a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = _layer(sc.doc, "Reused", REUSED_RGB, "M006")
        out += [sc.doc.Objects.AddBrep(p, a) for p in reused]
    if bars:
        li = _layer(sc.doc, "Bar", (40, 40, 40), "M006")
        for g, rgb in bars:
            a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = li
            a.ColorSource = Rhino.DocObjects.ObjectColorSource.ColorFromObject
            a.ObjectColor = System.Drawing.Color.FromArgb(*rgb)
            out.append(sc.doc.Objects.AddMesh(g, a) if isinstance(g, Rhino.Geometry.Mesh) else sc.doc.Objects.AddCurve(g, a))
        a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = li
        for s, p, h in texts:
            out.append(sc.doc.Objects.AddText(s, _text_plane(p), h, "Arial", False, False, a))
    grp = rs.AddGroup(); rs.AddObjectsToGroup([i for i in out if i], grp)
    sc.doc.Views.Redraw()
    print(r["info"])
    for n, _ in ELEMENTS:
        x = r["breakdown"].get(n, 0.0)
        if x > 0:
            print("  {0:<14} {1:9,.0f} t  {2:6.0f} kg/m2".format(n, x / 1000.0, x / r["gfa"]))

try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    if globals().get("Mass") is None:
        plates, plate_col, bar, bar_col, bar_text, bar_pl, bar_size = [], [], [], [], [], [], []
        total = intensity = budget = ratio = baseline = saved = None
        breakdown, metrics, info = [], {}, "Connect masses to Mass (and the existing building to Existing for reuse)"
    else:
        import System
        import Rhino.Geometry as _rg
        _p, _re, _bars, _txt, metrics = build(
            globals().get("Mass"), globals().get("Existing"),
            *[_gh_value(k) for k in ("Structure", "Facade", "WWR", "KeepFacade", "Mix", "Year",
                                     "Basement", "NetRatio", "Floor", "First", "Bar", "Units")])
        plates = _p + _re
        plate_col = [System.Drawing.Color.FromArgb(*NEW_RGB)] * len(_p) + [System.Drawing.Color.FromArgb(*REUSED_RGB)] * len(_re)
        bar = [g for g, _ in _bars]
        bar_col = [System.Drawing.Color.FromArgb(*c) for _, c in _bars]
        bar_text = [s for s, _, _ in _txt]
        bar_pl = [_text_plane(p) for _, p, _ in _txt]
        bar_size = [h for _, _, h in _txt]
        total = metrics["total"] / 1000.0
        intensity, budget, ratio = metrics["intensity"], metrics["budget"], metrics["ratio"]
        baseline, saved = metrics["baseline"] / 1000.0, metrics["saved"] / 1000.0
        breakdown = ["{0}: {1:,.0f} t".format(n, metrics["breakdown"].get(n, 0) / 1000.0) for n, _ in ELEMENTS
                     if metrics["breakdown"].get(n, 0) > 0]
        info = metrics["info"]
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        q = dict(gfa=10000, footprint=1250, facade=6000, roof=1250)
        print(summary(compare(q, structure="Concrete", mix="office", year=2030)))
        print(summary(compare(q, structure="Timber", mix="office", year=2030)))
