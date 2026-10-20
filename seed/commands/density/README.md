# Density Metrics

Calculate floor plates, GFA, Spacemate density metrics, envelope, and facade orientation areas.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `Density`
- Entrypoint: `src/main.py`

## Inputs

- Mass — proposed massing
- Plot — closed plot curve
- Floor — typical floor height
- First — ground-floor height
- North — north angle
- Units — model-units-per-metre scale

## Outputs

- `plates`
- `levels`
- `floor_gfa`
- `gfa`
- `fsi`
- `gsi`
- `osr`
- `L`
- `footprint`
- `projected`
- `plot_area`
- `volume`
- `envelope`
- `form_factor`
- `facade`
- `roof`
- `metrics`
- `info`

## Dependencies

- Bundled runtime API: RhinoCommon
- Bundled runtime API: rhinoscriptsyntax
- Bundled runtime API: scriptcontext

## Permissions

- Required: `rhino.geometry.read`
- Required: `rhino.geometry.write`
- Required: `rhino.document.layers.write`
- Required: `rhino.ui.object-selection`
- Required: `rhino.ui.command-options`
- Required: `rhino.session-state.read`
- Required: `rhino.session-state.write`

## Provenance

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / M003_density_metrics.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Early-design metrics depend on clean closed massing and the supplied plot.
- Imported as draft; no upstream release version or code license was declared.
