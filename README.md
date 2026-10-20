# Commands

Commands is a free, open community platform for discovering, sharing, installing, versioning and remixing small design commands.

Rhino/Python is the first target: vibe coding is making useful one-off tools abundant, while distribution is still folders, chat attachments and aliases.

## Product thesis

- The unit is a command, not a giant plugin.
- Public commands should be readable, forkable and versioned.
- Commands may be geometric, analytical, or both.
- The same command interface should eventually be callable by humans and AI agents.

## Roadmap

1. V0 marketplace: discover, search, command pages, package spec, Hark seed library.
2. Real publishing: accounts, profiles, versions, stars/forks and GitHub-backed releases.
3. Rhino bridge: install/update/uninstall commands and register them in Rhino.
4. Intelligent commands: AI-assisted creation and analysis-aware operations.
5. Only later: private firm libraries and a standalone programmable 3D environment.

Public community access should remain free.

## Automatic thumbnails from runnable previews

**Thumbnails come from the working demo itself, not separately generated artwork.**

At each GitHub Pages deployment, the workflow runs a local static site, waits for the actual solar/wind calculation to finish in headless Chrome, captures the viewport at a consistent 16:9 ratio, and includes these images in the published site:

| Command | Executable demo | Captured image |
| --- | --- | --- |
| SunHours (A001) | `demo/sunhours.html` | `assets/thumbnails/A001.png` |
| WindScreen (W001) | `demo/wind.html` | `assets/thumbnails/W001.png` |

The workflow also checks that the marketplace renders all commands, references the generated image URLs, and links to the corresponding runnable previews. If a demo breaks, the deployment fails rather than publishing a broken thumbnail.

**Important:** screenshots are **build artifacts**, so they are created by GitHub Actions and served by GitHub Pages; the generated PNGs are not committed to the Git history. This avoids manual assets and repeated binary commits.

To reproduce locally:

```bash
npm install
python3 -m http.server 8765
# In a second terminal:
npm run thumbnails
```

Chrome/Chromium is required. If its executable is not in the default paths, set `CHROME_PATH`. The script lives in `scripts/capture-thumbnails.mjs` and uses no AI image generation service.

**Adding a new runnable demo:** add its ID, URL, ready-state marker, and capture selector to the `DEMOS` array in `scripts/capture-thumbnails.mjs`. Then associate the card's image URL with the generated `assets/thumbnails/<ID>.png`. Future publishes recapture it automatically.
