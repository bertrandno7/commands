# COMMANDS package format — draft 0.2

The smallest shareable unit is a single command, not an entire plugin.

```text
commands/
  a001-sunhours/
    command.json
    main.py
    README.md
    preview/
      index.html        # optional browser-compatible live preview
```

## command.json

```json
{
  "schemaVersion": "0.2",
  "id": "A001",
  "slug": "sunhours",
  "name": "SunHours",
  "version": "0.1.0",
  "summary": "Shading-aware sun-hours analysis",
  "kind": "command",
  "listed": true,
  "author": {
    "name": "Bertrand Tan"
  },
  "runtime": {
    "host": "rhino",
    "rhino": "7 + 8",
    "language": "python",
    "entry": "main.py"
  },
  "category": "Analysis",
  "tags": ["Solar", "Environmental"],
  "network": "none",
  "preview": {
    "type": "web",
    "entry": "demo/sunhours.html",
    "capture": ".visual-panel",
    "ready": {
      "selector": "#progressLabel",
      "includes": "complete",
      "metric": "#mean"
    }
  }
}
```

## Required package behaviour

- `id` must be unique.
- `runtime.entry` must exist.
- `kind: "command"` is listed by default; helper code may use `kind: "module"` and `listed: false`.
- `network` is `none`, `optional`, or `required`.
- Browser previews are never implied from Python source alone.

## Automatic discovery

`scripts/build-registry.mjs` scans `commands/`.

A package with `command.json` uses the declared metadata.

A loose `.py` file whose directory has no manifest is still auto-discovered. COMMANDS infers:

- ID from an `A001_` / `M004_` style prefix when present;
- name from the filename;
- category from the ID prefix;
- summary from the leading Python docstring;
- runtime as Rhino/Python;
- preview from a sibling `preview/index.html` if present.

Inferred metadata is a convenience, not a replacement for a proper manifest.

## Browser preview contract

A browser preview is an implementation of the command suitable for the web. It may share algorithms with the Rhino source, but it must not pretend RhinoCommon is executing in GitHub Pages when it is not.

### Explicit preview

```json
{
  "preview": {
    "type": "web",
    "entry": "commands/a003-shadow-study/preview/index.html",
    "capture": "[data-command-preview]",
    "ready": {
      "selector": "body",
      "attribute": "data-preview-ready",
      "equals": "true",
      "metric": "[data-preview-metric]"
    }
  }
}
```

`ready` supports either text matching with `includes` or an attribute/equality check with `attribute` + `equals`.

Optional `prepare` actions can make deterministic thumbnails:

```json
{
  "prepare": {
    "select": {"#quality": "preview"},
    "uncheck": ["#animatedParticles"]
  }
}
```

### Standard preview

For any command package, `preview/index.html` is detected automatically unless `preview.disabled` is explicitly true. This works for both manifested and inferred commands. The page should:

- mark the capture surface with `data-command-preview`;
- set `body[data-preview-ready="true"]` after real computation finishes;
- expose a numeric `data-preview-metric`.

GitHub Actions then captures `assets/thumbnails/<ID>.png` automatically.

### No browser preview

```json
{"preview": {"type": "none"}}
```

The command still appears in the marketplace but is not given a fake live-preview link.

## Philosophy

- Inspectable source and clear declared dependencies.
- Versioned, forkable and remixable.
- Compatible with manually installed Rhino aliases first.
- Future Rhino bridge verifies packages and installs them.
- Optional structured inputs, outputs, analyses, objectives and constraints enable agent use.
- Deterministic analysis results come from analysis code, not an LLM.

A manifest's permissions are declarations, not a security sandbox. Untrusted Python scripts must not be executed without review.

## Manual installation

Copy the script locally, then create a Rhino alias using `_-RunPythonScript` pointing at `main.py`.

## Future installation

The COMMANDS bridge should verify hashes and provenance, show permissions, install a versioned release, register an alias, and support updates and uninstall.
