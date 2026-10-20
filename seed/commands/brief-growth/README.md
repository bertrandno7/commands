# Brief-driven Voxel Growth

Grow whole programme units into an analysis field from a structured design brief.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 8
- Python: Python 3
- Command: `BriefGrowth`
- Entrypoint: `src/main.py`

## Inputs

- Plot — closed plot curve
- Brief — CSV text or CSV file
- Lat and Lon — site coordinates
- MaxHeight and Cell — voxel field dimensions
- Floor — storey height
- MaxGSI and Cantilever — form constraints
- WindDir and Update — analysis controls
- Seed — deterministic seed
- Context — site context
- LibPath — helper-module directory override
- Run — execute
- Facade, Fins, and Balconies — facade skin controls

## Outputs

- `boxes`
- `item`
- `colours`
- `labels`
- `report`
- `compliance`
- `metrics`
- `info`
- `facade`
- `facade_layer`

## Dependencies

- Bundled runtime API: RhinoCommon
- Bundled runtime API: rhinoscriptsyntax
- Bundled runtime API: scriptcontext
- Python package: numpy (Rhino 8 # r package directive)
- Bundled helper: `src/G001_voxel_growth.py`
- Bundled helper: `src/G006_voxel_facade.py`

## Permissions

- Required: `rhino.geometry.read`
- Required: `rhino.geometry.write`
- Required: `rhino.document.layers.write`
- Required: `rhino.document.groups.write`
- Required: `rhino.ui.object-selection`
- Required: `rhino.ui.file-picker`
- Required: `rhino.ui.command-options`
- Required: `rhino.session-state.read`
- Required: `rhino.session-state.write`
- Required: `filesystem.read`
- Filesystem scope: User-selected brief CSV file.

## Provenance

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / G005_brief_growth.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Requires Rhino 8 and numpy.
- Greedy growth can leave units unfitted and reports them rather than exceeding area caps.
- This is algorithmic generative design, not an AI model or agent.
- Imported as draft; no upstream release version or code license was declared.
