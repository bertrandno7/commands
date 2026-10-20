# Sun Hours Analysis

Map shading-aware direct sun hours for one day using built-in NOAA solar equations.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `SunHours`
- Entrypoint: `src/main.py`

## Inputs

- Geo — geometry to analyse
- Ctx — optional shading context
- Lat and Lon — site coordinates
- Month and Day — analysis date
- H0 and H1 — local-hour range
- Step — sampling interval in minutes
- Grid — analysis mesh size
- North — north angle
- TZ — UTC offset or automatic CET/DST

## Outputs

- `mesh`
- `hours`
- `sun`
- `info`
- `path`
- `text`
- `text_pl`
- `legend`
- `leg_text`
- `leg_pl`
- `leg_size`

## Dependencies

- Bundled runtime API: RhinoCommon
- Bundled runtime API: rhinoscriptsyntax
- Bundled runtime API: scriptcontext

## Permissions

- Required: `rhino.geometry.read`
- Required: `rhino.geometry.write`
- Required: `rhino.document.layers.write`
- Required: `rhino.document.groups.write`
- Required: `rhino.ui.object-selection`
- Required: `rhino.ui.command-options`
- Required: `rhino.session-state.read`
- Required: `rhino.session-state.write`

## Provenance

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / A001_sun_hours.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Direct sun only; results depend on the chosen time step and mesh size.
- Imported as draft; no upstream release version or code license was declared.
