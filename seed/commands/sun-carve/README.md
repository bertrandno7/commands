# Sun Carve

Carve massing with planar or stepped cuts to improve facade sun while limiting volume loss.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `SunCarve`
- Entrypoint: `src/main.py`

## Inputs

- Mass — massing to carve
- Ctx — optional context
- Lat and Lon — site coordinates
- MaxCuts and MaxLoss — search limits
- Slopes and Depths — candidate families
- Stepped and Floor — terracing controls
- Objective — Sunlit, Total, PerArea, or PerVolume
- MinGain — stopping threshold
- Grid and Step — analysis resolution
- Month, Day, and MinSun — sunlit objective
- Neighbours and Reach — neighbour weighting

## Outputs

- `carved`
- `cutters`
- `sun`
- `before`
- `nsun`
- `gain`
- `ngain`
- `loss`
- `log`
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
- Optional: `rhino.objects.visibility.write`

## Provenance

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / M005_sun_carve.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Greedy search is not a global optimiser.
- Cuts only remove geometry above an upward-tilted plane; overhangs are not generated.
- Imported as draft; no upstream release version or code license was declared.
