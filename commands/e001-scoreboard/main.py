"""
E001  Option Scoreboard  (save design options with their metrics, score, rank, radar chart)
Works in: Rhino 7 GhPython (IronPython 2.7) and Rhino 8 Script component (Python 3).
Also runs as a Rhino command (alias: Scoreboard).

The "evaluate" step of the generative loop. Every library tool leaves its latest
numbers in sc.sticky; E001 takes a SNAPSHOT of all of them as one named option:
    M003_metrics  GFA, FSI, GSI, form factor          (Density)
    M006_carbon   kg CO2e/m2, budget ratio, t saved   (EmbodiedCarbon)
    A001_metrics  share of facade >= 2 h sun, mean h  (SunHours)
    A002_metrics  mean kWh/m2, total kWh              (SolarRadiation)
    W002_metrics  share of ground class D/E, danger   (WindComfort)
    G005_result   brief compliance                    (BriefGrowth)
    M005_carve    sun gain, volume lost               (SunCarve)
Workflow: model option A -> run the tools -> Save "A" -> change the design -> rerun ->
Save "B" ... -> Compare. Options persist in a JSON next to the .3dm
(<name>_E001_options.json), so they survive closing Rhino.

Scoring (relative to the set, like a design jury, not absolute):
    each scored metric -> 0..1 across the options (best = 1, worst = 0, min-max),
    or with a target ("fsi:4") 1 - |value - target| / largest miss in the set;
    score = weighted mean x 100. A metric counts only when >= 2 options have it;
    an option missing a counted metric gets 0 for it (and is flagged).
    Pareto: an option is "front" when no other option is at least as good on every
    scored metric and better on one. Weights default 1 for the headline metrics,
    0 (shown, not scored) for the rest; change with Weights "carbon:2, sun:1, fsi:0".
A warning is printed when a tool's numbers are identical to the previous option
(you probably forgot to rerun it).

GH INPUTS:
    Name    : str   option name (default "Option <n>")
    Save    : bool  (Button) snapshot the current sticky metrics as Name
    Metrics : dict / list of dicts  extra or direct metrics {"carbon": 480, ...}
              (for loops: Save with Metrics only, no tools needed)
    Remove  : str   option name to delete ;  Clear : bool (Button) delete all
    Weights : str   "carbon:2, sun:1"  (keys below)      Targets : str "fsi:4, gsi:0.5"
    Origin  : Point3d  chart corner (default 0,0,0) ;  Size : float chart size m (30)
    Units   : float model units per metre (1) ;  File : str JSON path override
GH OUTPUTS:
    names, scores, ranks, pareto : per option, sorted best first
    best    : name of the top option ;  table : text table ;  options : plain data
    chart, chart_col : radar polylines + axes + score bars (Curves, Colours)
    text, text_pl, text_size : labels (-> Text Tag 3D) ;  info : summary

RHINO COMMAND / ALIAS:
    Alias  Scoreboard  ->  ! _-RunPythonScript "C:\\Scripts\\GH-Library\\E001_option_scoreboard.py"
    Choose: Save / Compare / Remove / Clear / Weights / Targets / Export.
    Compare asks for a point and bakes the radar + ranking on E001::Chart, grouped;
    Export writes <name>_E001_options.csv next to the .3dm.

METRIC KEYS: gfa fsi gsi form carbon ratio saved sun sunmean solar wind danger brief carve
"""
from __future__ import division, print_function
import json, math, os, time

DEFAULTS = dict(Weights="", Targets="", Size=30.0, Units=1.0)

# key, label, unit, sticky source, field, better (max/min), default weight, scale
METRICS = [
    ("gfa",     "GFA",              "m2",     "M003_metrics", "gfa",          "max", 1.0, 1.0),
    ("fsi",     "FSI",              "",       "M003_metrics", "fsi",          "max", 0.0, 1.0),
    ("gsi",     "GSI",              "",       "M003_metrics", "gsi",          "min", 0.0, 1.0),
    ("form",    "Form factor",      "",       "M003_metrics", "form_factor",  "min", 0.5, 1.0),
    ("carbon",  "Embodied carbon",  "kg/m2",  "M006_carbon",  "intensity",    "min", 1.0, 1.0),
    ("ratio",   "Carbon / budget",  "x",      "M006_carbon",  "ratio",        "min", 0.0, 1.0),
    ("saved",   "Reuse saving",     "t",      "M006_carbon",  "saved",        "max", 0.0, 0.001),
    ("sun",     "Facade >= 2 h sun", "%",     "A001_metrics", "share_2h",     "max", 1.0, 100.0),
    ("sunmean", "Mean sun hours",   "h",      "A001_metrics", "mean_hours",   "max", 0.0, 1.0),
    ("solar",   "Solar radiation",  "kWh/m2", "A002_metrics", "mean_kwh_m2",  "max", 0.5, 1.0),
    ("wind",    "Wind class D/E",   "%",      "W002_metrics", "share_poor",   "min", 1.0, 100.0),
    ("danger",  "Wind danger",      "m2",     "W002_metrics", "danger_area",  "min", 0.0, 1.0),
    ("brief",   "Brief compliance", "%",      "G005_result",  "compliance",   "max", 1.0, 100.0),
    ("carve",   "Sun carve gain",   "%",      "M005_carve",   "gain",         "max", 0.0, 1.0),
]
KEYS = [m[0] for m in METRICS]
META = dict((m[0], m) for m in METRICS)
SOURCES = sorted(set(m[3] for m in METRICS))
# MVRDV palette pops, one per option (cycled)
OPTION_RGB = [(255, 120, 0), (0, 133, 255), (0, 170, 110), (230, 0, 126), (255, 210, 0),
              (120, 220, 90), (255, 150, 200), (150, 120, 255)]
INK = (40, 40, 40)
GRID_RGB = (190, 190, 190)

# ---------------------------------------------------------------- pure maths
def parse_pairs(s):
    """'carbon:2, sun:1' -> {'carbon': 2.0, 'sun': 1.0}; also accepts a dict. Unknown keys ignored."""
    if not s:
        return {}
    if isinstance(s, dict):
        items = list(s.items())
    else:
        items = []
        for part in str(s).replace(";", ",").split(","):
            if ":" in part or "=" in part:
                k, v = part.replace("=", ":").split(":", 1)
                items.append((k, v))
    out = {}
    for k, v in items:
        k = str(k).strip().lower()
        if k in META:
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                pass
    return out

def _num(v):
    if isinstance(v, (list, tuple)):          # e.g. W002 danger_area [P15 0.05 %, 0.3 %]
        try:
            return float(sum(v))
        except TypeError:
            return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if (f != f) else f            # NaN -> None

def extract(sticky):
    """Plain sticky-like mapping -> ({metric key: value in display units}, {source: raw subset})."""
    vals, raw = {}, {}
    for key, label, unit, src, field, better, w, scale in METRICS:
        d = sticky.get(src) if hasattr(sticky, "get") else None
        if not isinstance(d, dict):
            continue
        if src == "G005_result" and field not in d and isinstance(d.get("metrics"), dict):
            d = d["metrics"]
        v = _num(d.get(field))
        if v is None:
            continue
        vals[key] = v * scale
        raw.setdefault(src, {})[field] = v
    return vals, raw

def make_option(name, vals, raw=None, note=""):
    return dict(name=str(name), metrics=dict(vals), raw=raw or {}, note=note,
                saved=time.strftime("%Y-%m-%d %H:%M"))

def stale_sources(opt, options):
    """Sources whose raw numbers equal the previous saved option's (tool not rerun?)."""
    if not options:
        return []
    prev = options[-1].get("raw", {})
    return [s for s, d in opt.get("raw", {}).items() if s in prev and prev[s] == d]

def upsert(options, opt):
    """Replace an option with the same name, else append. Returns the new list."""
    out = [o for o in options if o["name"] != opt["name"]]
    if len(out) == len(options):
        return out + [opt]
    return [opt if o["name"] == opt["name"] else o for o in options]

def score(options, weights=None, targets=None):
    """-> dict(rows=[...sorted best first], active=[keys], norm={name: {key: 0..1}})"""
    W = dict((m[0], m[6]) for m in METRICS)
    W.update(weights or {})
    T = targets or {}
    active = [k for k in KEYS if W.get(k, 0) > 0
              and sum(1 for o in options if k in o["metrics"]) >= 2]
    norm = dict((o["name"], {}) for o in options)
    for k in active:
        vs = [(o["name"], o["metrics"][k]) for o in options if k in o["metrics"]]
        if k in T:
            miss = [(n, abs(v - T[k])) for n, v in vs]
            worst = max(m for _, m in miss)
            for n, m in miss:
                norm[n][k] = 1.0 if worst <= 1e-12 else 1.0 - m / worst
        else:
            lo, hi = min(v for _, v in vs), max(v for _, v in vs)
            for n, v in vs:
                if hi - lo <= 1e-12 * max(1.0, abs(hi)):
                    norm[n][k] = 1.0
                else:
                    x = (v - lo) / (hi - lo)
                    norm[n][k] = x if META[k][5] == "max" else 1.0 - x
    sw = sum(W[k] for k in active) or 1.0
    rows = []
    for o in options:
        nk = norm[o["name"]]
        s = 100.0 * sum(W[k] * nk.get(k, 0.0) for k in active) / sw
        rows.append(dict(name=o["name"], score=s, missing=[k for k in active if k not in nk],
                         metrics=o["metrics"], norm=nk))
    for r in rows:
        a = [r["norm"].get(k, 0.0) for k in active]
        r["pareto"] = bool(active) and not any(
            all(x >= y - 1e-12 for x, y in zip([q["norm"].get(k, 0.0) for k in active], a)) and
            any(x > y + 1e-12 for x, y in zip([q["norm"].get(k, 0.0) for k in active], a))
            for q in rows if q is not r)
    rows.sort(key=lambda r: -r["score"])
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    best = {}
    for k in active:
        cand = [r for r in rows if k in r["norm"]]
        if cand:
            best[k] = max(cand, key=lambda r: r["norm"][k])["name"]
    return dict(rows=rows, active=active, weights=W, targets=T, best=best)

def fmt(k, v):
    if v is None:
        return "-"
    if abs(v) >= 1000:
        return "{0:,.0f}".format(v)
    if abs(v) >= 100:
        return "{0:.0f}".format(v)
    if abs(v) >= 10:
        return "{0:.1f}".format(v)
    return "{0:.2f}".format(v)

def table_text(res, options):
    """Plain text table: one row per option (best first), shown metrics as columns."""
    shown = [k for k in KEYS if any(k in o["metrics"] for o in options)]
    head = ["#", "Option", "Score", "Front"] + [META[k][1] + (" " + META[k][2] if META[k][2] else "") for k in shown]
    lines = [" | ".join(head)]
    for r in res["rows"]:
        cells = [str(r["rank"]), r["name"], "{0:.0f}".format(r["score"]), "yes" if r["pareto"] else ""]
        cells += [fmt(k, r["metrics"].get(k)) + ("*" if k in res["active"] and res["best"].get(k) == r["name"] else "")
                  for k in shown]
        lines.append(" | ".join(cells))
    lines.append("* best on that metric | scored: " + (", ".join(
        "{0} x{1:g}{2}".format(META[k][1], res["weights"][k],
                               " (target {0:g})".format(res["targets"][k]) if k in res["targets"] else "")
        for k in res["active"]) or "nothing yet (need 2 options with the same metric)"))
    return "\n".join(lines)

def summary(res):
    if not res["rows"]:
        return "E001 | no options saved yet: run your tools, then Save"
    r = res["rows"][0]
    front = [x["name"] for x in res["rows"] if x["pareto"]]
    s = "E001 | {0} options | best {1} ({2:.0f}/100)".format(len(res["rows"]), r["name"], r["score"])
    if len(res["rows"]) > 1:
        s += " | runner-up {0} ({1:.0f})".format(res["rows"][1]["name"], res["rows"][1]["score"])
    s += " | Pareto front: " + (", ".join(front) or "-")
    miss = [x["name"] + " lacks " + "/".join(x["missing"]) for x in res["rows"] if x["missing"]]
    if miss:
        s += " | " + "; ".join(miss)
    return s + " | scores are relative to this set"

def chart_layout(res, origin=(0.0, 0.0, 0.0), size=30.0):
    """Radar (>= 3 scored metrics) + score bars, pure maths in model units.
    -> polylines [(pts, rgb)], texts [(str, (x,y,z), height)]"""
    ox, oy, oz = origin
    R = 0.5 * size
    cx, cy = ox + R, oy + R + 0.45 * size
    th = size / 30.0
    lines, texts = [], []
    act = res["active"]
    rows = res["rows"]
    texts.append(("Option scoreboard", (ox, oy + 1.95 * size - 0.2 * size, oz), 1.2 * th))
    if len(act) >= 3:
        n = len(act)
        ang = [math.pi / 2 - 2 * math.pi * i / n for i in range(n)]
        for f in (0.25, 0.5, 0.75, 1.0):
            pts = [(cx + f * R * math.cos(a), cy + f * R * math.sin(a), oz) for a in ang]
            lines.append((pts + [pts[0]], GRID_RGB))
        for k, a in zip(act, ang):
            lines.append(([(cx, cy, oz), (cx + R * math.cos(a), cy + R * math.sin(a), oz)], GRID_RGB))
            lx, ly = cx + 1.12 * R * math.cos(a), cy + 1.12 * R * math.sin(a)
            texts.append((META[k][1], (lx - (0.0 if math.cos(a) > 0.2 else (0.5 if abs(math.cos(a)) <= 0.2 else 1.0)) * len(META[k][1]) * 0.55 * th,
                                       ly - 0.5 * th, oz), 0.8 * th))
        for i, r in enumerate(sorted(rows, key=lambda r: r["name"])):
            rgb = OPTION_RGB[i % len(OPTION_RGB)]
            pts = [(cx + max(0.04, r["norm"].get(k, 0.0)) * R * math.cos(a),
                    cy + max(0.04, r["norm"].get(k, 0.0)) * R * math.sin(a), oz + 0.001 * (i + 1)) for k, a in zip(act, ang)]
            lines.append((pts + [pts[0]], rgb))
    # score bars, best first
    y = oy + 0.25 * size
    bw = 0.06 * size
    for r in rows:
        i = sorted(x["name"] for x in rows).index(r["name"])
        rgb = OPTION_RGB[i % len(OPTION_RGB)]
        L = max(0.01, r["score"] / 100.0) * 0.62 * size
        x0 = ox + 0.30 * size
        for k in range(4):                     # filled-look bar: a few stacked lines
            yy = y + bw * k / 3.0
            lines.append(([(x0, yy, oz), (x0 + L, yy, oz)], rgb))
        texts.append(("{0}. {1}".format(r["rank"], r["name"][:16]), (ox, y, oz), 0.8 * th))
        texts.append(("{0:.0f}{1}".format(r["score"], "  front" if r["pareto"] else ""), (x0 + L + 0.5 * th, y, oz), 0.8 * th))
        y -= 1.9 * bw
    return lines, texts

# ---------------------------------------------------------------- storage
def default_file():
    try:
        import scriptcontext as sc
        p = sc.doc.Path
        if p:
            return os.path.splitext(p)[0] + "_E001_options.json"
    except Exception:
        pass
    return None

def load(path):
    try:
        import scriptcontext as sc
        mem = sc.sticky.get("E001_options")
    except Exception:
        sc, mem = None, None
    if path and os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f).get("options", [])
        except Exception:
            pass
    return list(mem or [])

def store(options, path):
    try:
        import scriptcontext as sc
        sc.sticky["E001_options"] = options
    except Exception:
        pass
    if path:
        try:
            with open(path, "w") as f:
                json.dump(dict(tool="E001", options=options), f, indent=1)
        except Exception as e:
            print("E001: could not write {0}: {1}".format(path, e))

def export_csv(res, options, path):
    shown = [k for k in KEYS if any(k in o["metrics"] for o in options)]
    with open(path, "w") as f:
        f.write(",".join(["rank", "option", "score", "pareto"] + shown) + "\n")
        for r in res["rows"]:
            f.write(",".join([str(r["rank"]), '"' + r["name"] + '"', "{0:.1f}".format(r["score"]),
                              "1" if r["pareto"] else "0"] +
                             ["" if r["metrics"].get(k) is None else "{0:.4g}".format(r["metrics"][k]) for k in shown]) + "\n")

def snapshot(name, extra=None):
    """Current sc.sticky metrics (+ extra dict) as an option."""
    try:
        import scriptcontext as sc
        st = sc.sticky
    except Exception:
        st = {}
    vals, raw = extract(st)
    for d in (extra if isinstance(extra, (list, tuple)) else [extra]):
        if isinstance(d, dict):
            vals.update(dict((k, float(v)) for k, v in d.items() if str(k).lower() in META and _num(v) is not None))
        elif d is not None and hasattr(d, "Keys"):           # .NET dictionary from GH
            for k in d.Keys:
                if str(k).lower() in META and _num(d[k]) is not None:
                    vals[str(k).lower()] = float(d[k])
    return make_option(name, vals, raw)

# ---------------------------------------------------------------- Rhino
def _text_plane(p):
    import Rhino.Geometry as rg
    return rg.Plane(rg.Point3d(*p), rg.Vector3d.ZAxis)

def build_chart(res, origin, size):
    import Rhino.Geometry as rg
    lines, texts = chart_layout(res, origin, size)
    crvs = [(rg.PolylineCurve([rg.Point3d(*p) for p in pts]), rgb) for pts, rgb in lines]
    return crvs, texts

def _layer(doc, name, rgb, parent=None):
    import Rhino, System
    full = name if parent is None else parent + "::" + name
    i = doc.Layers.FindByFullPath(full, -1)
    if i >= 0:
        return i
    L = Rhino.DocObjects.Layer(); L.Name = name; L.Color = System.Drawing.Color.FromArgb(*rgb)
    if parent is not None:
        L.ParentLayerId = doc.Layers.FindIndex(doc.Layers.FindByFullPath(parent, -1)).Id
    return doc.Layers.Add(L)

def run_command():
    import Rhino, System
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    st = sc.sticky.get("E001_opts", dict(DEFAULTS))
    path = default_file()
    options = load(path)
    if not path:
        print("Scoreboard: save the .3dm first to keep options between sessions (kept in memory for now)")
    print("Scoreboard: {0} option(s) saved: {1}".format(len(options), ", ".join(o["name"] for o in options) or "-"))
    found, _ = extract(sc.sticky)
    print("  metrics available now: " + (", ".join("{0} {1}".format(META[k][1], fmt(k, v)) for k, v in found.items()) or "none (run Density / EmbodiedCarbon / SunHours ...)"))
    go = Rhino.Input.Custom.GetOption()
    go.SetCommandPrompt("Scoreboard")
    for o in ("Save", "Compare", "Remove", "Clear", "Weights", "Targets", "Export"):
        go.AddOption(o)
    if go.Get() != Rhino.Input.GetResult.Option:
        return
    act = go.Option().EnglishName
    if act == "Save":
        name = rs.GetString("Option name", "Option {0}".format(len(options) + 1))
        if not name:
            return
        opt = snapshot(name)
        if not opt["metrics"]:
            print("Scoreboard: no tool metrics found. Run Density, EmbodiedCarbon, SunHours, SolarRadiation or WindComfort first.")
            return
        for s in stale_sources(opt, [o for o in options if o["name"] != name]):
            print("  warning: {0} numbers are the same as the previous option. Rerun that tool?".format(s))
        options = upsert(options, opt)
        store(options, path)
        print("Saved '{0}': {1}".format(name, ", ".join("{0} {1}".format(META[k][1], fmt(k, v)) for k, v in opt["metrics"].items())))
        return
    if act == "Remove":
        n = rs.ListBox([o["name"] for o in options], "Remove which option?", "Scoreboard") if options else None
        if n:
            options = [o for o in options if o["name"] != n]; store(options, path); print("Removed " + n)
        return
    if act == "Clear":
        if options and rs.MessageBox("Delete all {0} saved options?".format(len(options)), 4 | 32, "Scoreboard") == 6:
            store([], path); print("Scoreboard cleared")
        return
    if act in ("Weights", "Targets"):
        cur = st.get(act, "")
        hint = "keys: " + " ".join(KEYS)
        s = rs.StringBox("{0}, e.g. {1}   ({2})".format(act, "carbon:2, sun:1" if act == "Weights" else "fsi:4", hint), cur, "Scoreboard")
        if s is not None:
            st[act] = s; sc.sticky["E001_opts"] = st
            print("{0} = {1}".format(act, s or "(defaults)"))
        return
    res = score(options, parse_pairs(st.get("Weights")), parse_pairs(st.get("Targets")))
    print(table_text(res, options)); print(summary(res))
    if act == "Export":
        if not path:
            print("Save the .3dm first"); return
        p = os.path.splitext(path)[0] + ".csv"
        export_csv(res, options, p); print("Wrote " + p)
        return
    if len(options) < 2:
        print("Scoreboard: save at least 2 options to compare"); return
    pt = rs.GetPoint("Chart corner")
    if pt is None:
        return
    f = Rhino.RhinoMath.UnitScale(Rhino.UnitSystem.Meters, sc.doc.ModelUnitSystem)
    crvs, texts = build_chart(res, (pt.X, pt.Y, pt.Z), float(st.get("Size", 30.0)) * f)
    _layer(sc.doc, "E001", INK)
    li = _layer(sc.doc, "Chart", INK, "E001")
    ids = []
    for c, rgb in crvs:
        a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = li
        a.ColorSource = Rhino.DocObjects.ObjectColorSource.ColorFromObject
        a.ObjectColor = System.Drawing.Color.FromArgb(*rgb)
        ids.append(sc.doc.Objects.AddCurve(c, a))
    a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = li
    for s, p, h in texts:
        ids.append(sc.doc.Objects.AddText(s, _text_plane(p), h, "Arial", False, False, a))
    g = rs.AddGroup(); rs.AddObjectsToGroup([i for i in ids if i], g)
    sc.doc.Views.Redraw()

# ---------------------------------------------------------------- entry points
try:
    ghenv  # noqa: F821
    _IN_GH = True
except NameError:
    _IN_GH = False

if _IN_GH:
    import System
    import Rhino.Geometry as _rg
    _g = globals().get
    _path = _g("File") or default_file()
    _opts = load(_path)
    if _g("Clear"):
        _opts = []; store(_opts, _path)
    if _g("Remove"):
        _opts = [o for o in _opts if o["name"] != str(_g("Remove"))]; store(_opts, _path)
    if _g("Save"):
        _o = snapshot(_g("Name") or "Option {0}".format(len(_opts) + 1), _g("Metrics"))
        for _s in stale_sources(_o, [o for o in _opts if o["name"] != _o["name"]]):
            print("warning: {0} unchanged since the previous option (rerun it?)".format(_s))
        if _o["metrics"]:
            _opts = upsert(_opts, _o); store(_opts, _path)
    _res = score(_opts, parse_pairs(_g("Weights")), parse_pairs(_g("Targets")))
    names = [r["name"] for r in _res["rows"]]
    scores = [r["score"] for r in _res["rows"]]
    ranks = [r["rank"] for r in _res["rows"]]
    pareto = [r["pareto"] for r in _res["rows"]]
    best = names[0] if names else None
    table = table_text(_res, _opts)
    options = _opts
    _u = float(_g("Units") or 1.0)
    _org = _g("Origin")
    _org = (_org.X, _org.Y, _org.Z) if _org is not None else (0.0, 0.0, 0.0)
    _crv, _txt = build_chart(_res, _org, float(_g("Size") or 30.0) * _u) if len(_opts) >= 1 else ([], [])
    chart = [c for c, _ in _crv]
    chart_col = [System.Drawing.Color.FromArgb(*c) for _, c in _crv]
    text = [s for s, _, _ in _txt]
    text_pl = [_text_plane(p) for _, p, _ in _txt]
    text_size = [h for _, _, h in _txt]
    info = summary(_res)
elif __name__ == "__main__":
    try:
        import Rhino  # noqa: F401
        run_command()
    except ImportError:
        a = make_option("A", dict(gfa=12000, carbon=600, sun=40, wind=8))
        b = make_option("B", dict(gfa=11000, carbon=450, sun=55, wind=12))
        c = make_option("C", dict(gfa=10000, carbon=470, sun=50, wind=15))
        r = score([a, b, c])
        print(table_text(r, [a, b, c])); print(summary(r))
