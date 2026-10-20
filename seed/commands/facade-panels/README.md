# Facade Panelizer

Panelize a facade and classify panels as flat or warped.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `FacadePanels`
- Entrypoint: `src/main.py`

## Inputs

- S — surface or single-face Brep
- W — target panel width
- Hp — target panel height
- J — joint width
- Tol — maximum warp counted as flat
- Flip — swap U and V

## Outputs

- `panels`
- `flat`
- `warped`
- `warp`
- `info`

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

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / F001_facade_panelizer.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Warp is a geometric screening metric, not a fabrication guarantee.
- Imported as draft; no upstream release version or code license was declared.
