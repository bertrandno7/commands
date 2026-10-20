# Sun-responsive Facade

Size facade openings from annual direct-sun exposure.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `SunFacade`
- Entrypoint: `src/main.py`

## Inputs

- S — facade surface
- Ctx — optional shading context
- Lat and Lon — site coordinates
- W and Hp — grid cell dimensions
- Min and Max — opening fractions
- Weight — incidence weighting
- Invert — reverse the exposure mapping
- Flip — reverse facade normal
- Step — sampling interval
- North — north angle

## Outputs

- `frame`
- `openings`
- `glass`
- `sun`
- `ratio`
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

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / F002_sun_openings.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Facade normal orientation matters; use Flip when the surface faces inward.
- Uses sampled direct sun rather than a full thermal or daylight simulation.
- Imported as draft; no upstream release version or code license was declared.
