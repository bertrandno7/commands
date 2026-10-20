# VoxelGrowth

Grow voxel massing through sun, density, support, and cantilever criteria.

This is an imported draft reconciled with the executable source in COMMANDS commit `044050f`. The source license still requires an explicit author declaration before production reuse.

## Runtime

- Rhino 8 CPython
- Python dependency: `numpy`
- Entrypoint: `src/main.py` → `run_command`

## Capabilities

- Analysis-driven voxel growth
- Hard density and height limits
- Deterministic seeded options

## Permissions

- `document.read`
- `document.write`
