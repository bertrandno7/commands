# WindComfort

Aggregate directional wind screens into an early pedestrian-comfort comparison.

This is an imported draft reconciled with the executable source in COMMANDS commit `044050f`. It supports early design comparison only and is not a certified wind-comfort assessment. The source license remains unresolved.

## Runtime

- Rhino 8 CPython
- Python dependency: `numpy`
- Entrypoint: `src/main.py` → `run_command`

## Capabilities

- Multiple wind sectors
- Climate-frequency weighting
- Early NEN 8100-oriented comfort classes

## Permissions

- `document.read`
- `document.write`
- `network`
