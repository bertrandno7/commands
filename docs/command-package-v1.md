# COMMANDS package format v1

A command package is an immutable ZIP containing one small Rhino command. The registry stores the ZIP exactly as published, records its SHA-256 checksum, and never executes it.

## Required layout

```text
command.json       Manifest conforming to /schema/command-package-v1.schema.json
README.md          Human-readable usage and limitations
icon.svg           Icon path may differ if command.json points to it
src/main.py        Entrypoint path may differ if command.json points to it
```

Optional files include `LICENSE`, `screenshots/`, and bundled source modules declared in `dependencies.files`. Paths are case-sensitive package-relative POSIX paths. Archives containing absolute paths, `..`, backslashes, encrypted entries, symbolic links, ZIP64 metadata, more than 100 entries, over 10 MiB compressed, or over 50 MiB expanded are rejected.

## Manifest

The canonical schema is [`/schema/command-package-v1.schema.json`](/schema/command-package-v1.schema.json). Important fields are:

- `slug`, `commandName`, and semantic `version` establish the registry and Rhino command identity.
- `entrypoint.file` and `entrypoint.callable` identify executable Python code.
- `runtime` declares Rhino and Python compatibility.
- `dependencies` separates Python packages, other COMMANDS packages, Rhino plugins, and bundled files.
- `permissions` makes document, filesystem, network, clipboard, and subprocess effects reviewable before installation.
- `interface.inputs`, `outputs`, optional `objectives`, and `metrics` provide typed composition points. A future Rhino bridge or agent can pass geometry, analysis data, and objective values without the registry becoming a CAD runtime.
- `agent` is optional. `callable: true` means the command is designed for non-interactive invocation; it does not grant permission or cause hosted execution.
- `license` should be an SPDX expression. `LicenseRef-Pending` is reserved for quarantined imports and is not an open-source license.

Example:

```json
{
  "schemaVersion": "1.0",
  "slug": "twist-for-sun",
  "name": "TwistForSun",
  "commandName": "TwistForSun",
  "version": "1.0.0",
  "summary": "Twist a mass toward a solar-exposure objective.",
  "description": "Produces candidate geometry and solar metrics from a base mass and site settings.",
  "category": "Analysis",
  "tags": ["solar", "massing", "optimization"],
  "license": "MIT",
  "entrypoint": { "file": "src/main.py", "callable": "run_command" },
  "icon": "icon.svg",
  "runtime": {
    "host": "rhino",
    "rhinoVersions": ["8"],
    "pythonEngine": "CPython 3"
  },
  "dependencies": {
    "python": [],
    "commands": [],
    "rhinoPlugins": [],
    "files": []
  },
  "permissions": ["document.read", "document.write"],
  "interface": {
    "inputs": [
      { "name": "mass", "type": "rhino.brep", "required": true },
      { "name": "location", "type": "geo.location", "required": true }
    ],
    "outputs": [
      { "name": "geometry", "type": "rhino.brep" },
      { "name": "sunHours", "type": "analysis.scalar-field" }
    ],
    "objectives": [
      { "name": "targetSunHours", "type": "number" }
    ],
    "metrics": [
      { "name": "meanSunHours", "type": "number" }
    ]
  },
  "agent": {
    "callable": true,
    "description": "Generate a solar-aware twisted mass.",
    "sideEffects": ["document.write"]
  }
}
```

## Version and integrity rules

Versions are immutable. A publisher cannot replace bytes at an existing `(command, version)` coordinate. The registry serves a SHA-256 checksum and immutable cache headers for published versions. A future Rhino installer must verify the checksum before extraction, reject unsafe paths again locally, display permissions, and maintain an installation lockfile.

The fifteen audited seeds are deliberately marked `imported-draft`. Creator attribution and executable source were reconciled with the owner's repository at `044050f`, while the source license remains unresolved. Their validated packages are useful for review, but licensing must be explicit before promotion to community-published releases.
