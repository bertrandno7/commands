# Option Scoreboard

Save, score, rank, and compare design options from metrics produced by other commands.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `Scoreboard`
- Entrypoint: `src/main.py`

## Inputs

- Name — option name
- Save — snapshot current metrics
- Metrics — explicit metrics override
- Remove and Clear — mutate saved options
- Weights — metric weights
- Targets — target values
- Origin and Size — chart placement
- Units — model-units-per-metre scale
- File — JSON path override

## Outputs

- `names`
- `scores`
- `ranks`
- `pareto`
- `best`
- `table`
- `options`
- `chart`
- `chart_col`
- `text`
- `text_pl`
- `text_size`
- `info`

## Dependencies

- Bundled runtime API: RhinoCommon
- Bundled runtime API: rhinoscriptsyntax
- Bundled runtime API: scriptcontext
- Bundled runtime API: Python standard library json

## Permissions

- Required: `rhino.geometry.write`
- Required: `rhino.document.layers.write`
- Required: `rhino.document.groups.write`
- Required: `rhino.session-state.read`
- Required: `rhino.session-state.write`
- Required: `filesystem.read`
- Required: `filesystem.write`
- Filesystem scope: Configured File path or <current-3dm>_E001_options.json; CSV exports beside that path.

## Provenance

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / E001_option_scoreboard.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Scores are relative min-max scores over the currently saved set, not absolute performance ratings.
- Useful results require compatible metrics from other library commands.
- Imported as draft; no upstream release version or code license was declared.
