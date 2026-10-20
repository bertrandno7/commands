# Commands

Commands is a free, open community platform for discovering, sharing, installing, versioning and remixing small design commands.

Rhino/Python is the first target: vibe coding is making useful one-off tools abundant, while distribution is still folders, chat attachments and aliases.

## Product thesis

- The unit is a command, not a giant plugin.
- Public commands should be readable, forkable and versioned.
- Commands may be geometric, analytical, or both.
- The same command interface should eventually be callable by humans and AI agents.

## Filesystem-driven catalogue

The marketplace is no longer hand-maintained in `app.js`.

`commands/` is the source of truth:

```text
commands/
  a001-sunhours/
    command.json
    main.py
  m004-pixelate/
    command.json
    main.py
  ...
```

`npm run registry` scans the filesystem and writes `generated/commands.json`. The browser loads that generated registry directly.

A loose Python file below `commands/` is also auto-discovered if its directory has no `command.json`. COMMANDS infers its ID, name, category and summary from the filename/docstring so a new script cannot silently disappear from the catalogue. Add a manifest when you want curated metadata.

The migrated Hark seed library currently contains **16 packages**: 15 listed commands plus one internal module (`G006 VoxelFacade`).

## Live preview contract

A script appearing in the registry and a script being runnable in a browser are different things.

Every Python script under `commands/` can be discovered automatically. A **true live preview** is created automatically only when the command also declares a browser-compatible preview.

Manifest example:

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

For the standard convention, placing `preview/index.html` beside an inferred Python command is enough for the registry builder to discover it automatically. The preview should:

- expose the visible capture region with `data-command-preview`;
- set `body[data-preview-ready="true"]` only after real computation is complete;
- expose a numeric result using `data-preview-metric`.

Existing previews can use custom selectors in `command.json`.

At each GitHub Pages deployment, the build:

1. scans `commands/`;
2. generates the marketplace registry;
3. finds every command whose `preview.type` is `web`;
4. opens each preview in headless Chrome;
5. waits for its declared completion condition;
6. captures a consistent 16:9 screenshot;
7. uses that screenshot as the command card thumbnail;
8. publishes the site.

There is no hard-coded preview list.

### Current browser-runnable commands

- **A001 SunHours**
- **W001 WindScreen**
- **M004 Pixelate**

The other Rhino-native scripts are registered automatically but still need browser adapters before they can honestly be called live previews. RhinoCommon code cannot execute inside GitHub Pages simply because the Python source has been loaded.

## Local development

```bash
npm install
npm run registry
python3 -m http.server 8765
```

Then, in another terminal:

```bash
npm run thumbnails
npm test
```

Chrome/Chromium is required for thumbnail generation.

## Roadmap

1. Filesystem-driven marketplace and real browser previews.
2. Real publishing: accounts, profiles, versions, stars/forks and GitHub-backed releases.
3. Rhino bridge: install/update/uninstall commands and register them in Rhino.
4. Intelligent commands: AI-assisted creation and analysis-aware operations.
5. Only later: private firm libraries and a standalone programmable 3D environment.

Public community access should remain free.
