# COMMANDS

COMMANDS is an open community registry for discovering, publishing, downloading, versioning, forking, and remixing small design commands. V1 focuses on Rhino/Python and treats one callable command—not a monolithic plugin—as the unit of sharing.

The product combines a responsive marketplace, creator and command pages, fifteen runnable browser previews, canonical `.command.zip` packages, immutable releases, ChatGPT sign-in, a D1 catalog, R2 package storage, and an MCP discovery surface. It deliberately does **not** attempt to recreate CAD in the browser.

## Seed library

The initial catalog was audited from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands` and reconciled with the repository source at commit `044050f`. All fifteen listed commands have:

- the current Rhino/Python source;
- a deterministic browser preview and computed screenshot;
- a validated v1 package and SHA-256 record;
- explicit dependency and permission metadata;
- honest `imported-draft` provenance.

The source snapshot did not include an explicit code license. Seed downloads therefore remain clearly marked provisional and use `LicenseRef-Pending`; community publishing requires a supported open-source SPDX license.

## Stack

- Vinext / React 19 / TypeScript
- Cloudflare Workers runtime
- D1 + Drizzle for catalog, versions, profiles, stars, forks, and download counts
- R2 for immutable community package objects
- ChatGPT sign-in for publishing and personal actions
- Playwright browser verification

## Run locally

Requirements: Node.js `>=22.13.0` and Chrome or Edge for browser tests.

```sh
npm ci
npm run seed:packages
npm test
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_concerned_grim_reaper.sql
npm start
```

Use the URL printed by Wrangler (normally `http://127.0.0.1:8787`). To run the end-to-end browser and publishing checks against it:

```powershell
$env:COMMANDS_PREVIEW_ORIGIN='http://127.0.0.1:8787'
npm run test:browser
```

Useful commands:

- `npm run dev` — development server with hot reload
- `npm run build` — production Worker build
- `npm run seed:packages` — rebuild and validate the fifteen deterministic seed packages
- `npm run thumbnails` — capture all fifteen real browser previews
- `npm test` — numerical, package-integrity, and preview-coverage tests
- `npm run test:browser` — desktop/mobile previews plus an upload → catalog → download → checksum flow

## Repository shape

```text
app/                 pages, API routes, MCP endpoint
components/          marketplace and publishing UI
db/ + drizzle/       schema and initial migration
lib/                 catalog, package, validation, and auth-domain logic
public/demo/         shared browser-preview engines
public/commands/     standard command preview adapters
public/packages/     deterministic seed archives and SHA-256 index
seed/commands/       canonical package source trees
tests/               numerical, integrity, browser, and end-to-end checks
docs/                product and architecture notes
```

## Command package v1

Every archive has `command.json`, `README.md`, the declared icon, and an executable entrypoint. The manifest records:

- identity, SemVer, category, tags, and SPDX license;
- Rhino/Python compatibility;
- Python, Rhino-plugin, command, and bundled-file dependencies;
- declared permissions;
- typed inputs, outputs, objectives, and metrics;
- a future agent-call contract and provenance.

Uploads are bounded and inspected before storage: safe normalized paths, no traversal or symlinks, compressed/expanded/file-count limits, required-file validation, CRC verification, exact embedded-manifest matching, callable verification, open-license enforcement, and immutable content-addressed releases.

See `/docs/package-format` in the running app and [`docs/architecture.md`](docs/architecture.md).

## Roadmap

1. **V1 marketplace:** open public discovery, packages, creators, versions, stars/forks, publishing, API, and MCP discovery.
2. **Rhino companion:** local install/update, checksum verification, permission prompts, native command registration, and a lockfile.
3. **AI command creation:** prompt-to-package scaffolding with static checks, sandboxed validation, and human-owned publication.
4. **Analysis-aware commands:** compose geometry, analysis, constraints, metrics, and objectives such as `TwistForSun`.
5. **Standalone 3D environment:** only after the package and agent ecosystem proves the need.

The public community remains free and open. Sponsorship and future private enterprise libraries are extension points, not paywalls on core community features.
