# WindScreen

Run a fast, qualitative pedestrian-height wind screen around early massing.

This is an imported draft reconciled with the executable source in COMMANDS commit `044050f`. It is an option-comparison tool, not calibrated CFD or a certified NEN 8100 assessment. The source license remains unresolved.

## Runtime

- Rhino 8 CPython
- Python dependency: `numpy`
- Entrypoint: `src/main.py` → `run_command`

## Capabilities

- D2Q9 lattice-Boltzmann screening
- Relative shelter and acceleration fields
- Deterministic live browser preview

## Permissions

- `document.read`
- `document.write`
