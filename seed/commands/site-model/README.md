# Site Model

Build layered Rhino site context from 3D BAG in the Netherlands or OpenStreetMap elsewhere.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `SiteModel`
- Entrypoint: `src/main.py`

## Inputs

- Lat and Lon — site centre
- Radius — metres around the centre, maximum 1500
- LoD — 3D BAG 2.2 roofs or 1.2 blocks
- Source — auto or OSM
- TransitR — transit search radius
- Refresh — bypass cache
- Labels — key, all, or off
- Run — execute

## Outputs

- `buildings`
- `bld_est`
- `roads`
- `road_crv`
- `paths`
- `bridges`
- `rail`
- `water`
- `green`
- `plazas`
- `parking`
- `trees`
- `tree_pts`
- `stops`
- `stop_names`
- `labels`
- `label_pts`
- `ground`
- `landmarks`
- `landmark_names`
- `boundary`
- `site`
- `info`

## Dependencies

- Bundled runtime API: RhinoCommon
- Bundled runtime API: rhinoscriptsyntax
- Bundled runtime API: scriptcontext
- Bundled runtime API: Python standard library urllib/json

## Permissions

- Required: `rhino.geometry.write`
- Required: `rhino.document.layers.write`
- Required: `rhino.session-state.read`
- Required: `rhino.session-state.write`
- Required: `rhino.ui.command-options`
- Required: `network.access`
- Required: `filesystem.read`
- Required: `filesystem.write`
- Network host: `api.3dbag.nl`
- Network host: `overpass-api.de`
- Network host: `z.overpass-api.de`
- Network host: `lz4.overpass-api.de`
- Network host: `overpass.kumi.systems`
- Network host: `overpass.private.coffee`
- Network host: `maps.mail.ru`
- Filesystem scope: System temporary directory: x000_site_*.json cache files.

## Provenance

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / X000_site_model.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- Terrain is flat.
- Building heights outside the Netherlands may be estimated from OpenStreetMap tags.
- Sea coastline is not drawn.
- Network availability and upstream API limits affect results.
- Imported as draft; no upstream release version or code license was declared.
