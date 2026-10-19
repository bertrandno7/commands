# COMMANDS package format — draft 0.1

The smallest shareable unit is a single command, not an entire plugin.

```text
sun-hours/
  command.json
  main.py
  README.md
  icon.svg
  examples/
```

Example `command.json`:

```json
{
  "schemaVersion": "0.1",
  "id": "bertrand/sun-hours",
  "name": "SunHours",
  "version": "0.1.0",
  "summary": "Shading-aware sun-hour analysis",
  "runtime": {
    "host": "rhino",
    "rhino": ">=7",
    "language": "python",
    "entry": "main.py"
  },
  "categories": ["analysis", "environmental"],
  "permissions": ["document.read", "document.write"],
  "network": false,
  "dependencies": [],
  "license": "MIT"
}
```

## Philosophy

- Inspectable source and clear declared dependencies.
- Versioned, forkable and remixable.
- Compatible with manually installed Rhino aliases first.
- Future Rhino bridge verifies packages and installs them.
- Optional structured inputs, outputs, analyses, objectives and constraints enable agent use.

A manifest's permissions are declarations, not a security sandbox. Untrusted Python scripts must not be executed without review.

## Manual installation

Copy the script locally, then create a Rhino alias using `_-RunPythonScript` pointing at `main.py`.

## Future installation

The Commands bridge should verify hashes and provenance, show permissions, install a versioned release, register an alias, and support updates and uninstall.