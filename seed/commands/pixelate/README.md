# Pixelate Massing

Convert closed massing into cube, tetrahedral, triangular, or staggered pixels.

> Imported draft — version 0.1.0. The upstream library did not declare a semantic version or code license; this package therefore uses `LicenseRef-Pending`.

## Runtime

- Rhino: 7 and 8
- Python: IronPython 2.7 and Python 3
- Command: `Pixelate`
- Entrypoint: `src/main.py`

## Inputs

- Mass — closed Breps, extrusions, or meshes
- Size — plan cell size
- Height — pixel height; zero uses Size
- Mode — Cube, Tetra, Tri, Stagger, or CubeStagger
- Gap — pixel separation or welded skin mode
- Colour — colour by height
- Units — model-units-per-metre scale

## Outputs

- `mesh`
- `centres`
- `cells`
- `count`
- `volume`
- `info`

## Dependencies

- Bundled runtime API: RhinoCommon
- Bundled runtime API: rhinoscriptsyntax
- Bundled runtime API: scriptcontext
- Bundled runtime API: System.Drawing

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
- Optional: `filesystem.write`
- Filesystem scope: Optional PNG capture in <3dm-folder>/captures or the user's desktop capture folder.

## Provenance

Exact executable source imported from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands / M004_pixelate.py`, snapshot dated 2026-10-15. Creator attribution was verified against the owner’s COMMANDS repository at commit `044050f`; the source license remains unresolved.

## Known limitations

- A pixel is retained from centre-in-volume tests; this is an approximation at coarse cell sizes.
- Imported as draft; no upstream release version or code license was declared.
