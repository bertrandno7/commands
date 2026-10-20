# Spiral Staircase

Generate a spiral stair with treads, a central column, handrail, and balusters from a base point.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `SpiralStair`
- Entrypoint: `src/main.py`

## Inputs

- C — base centre point
- Ro — outer radius
- Ri — inner or column radius
- H — floor-to-floor height
- Rmax — maximum riser height
- Rot — total rotation in degrees
- T — tread thickness
- Ov — tread overlap in degrees
- CW — clockwise ascent
- Hr — handrail height
- Pr — handrail pipe radius

## Outputs

- `treads`
- `column`
- `rail`
- `balusters`
- `info`

## Dependencies

- Bundled runtime API: RhinoCommon
- Bundled runtime API: rhinoscriptsyntax
- Bundled runtime API: scriptcontext

## Permissions

- Required: `rhino.geometry.write`
- Required: `rhino.document.groups.write`
- Required: `rhino.ui.point-pick`
- Required: `rhino.ui.command-options`
- Required: `rhino.session-state.read`
- Required: `rhino.session-state.write`

## Provenance

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / S001_spiral_staircase.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Imported as draft; no upstream release version or code license was declared.
