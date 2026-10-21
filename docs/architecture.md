# COMMANDS MVP architecture

## Runtime

COMMANDS is one Vinext application deployed as a Cloudflare Worker through Sites. Public pages and read APIs are anonymous. Site-managed ChatGPT identity is required for publishing, starring, and forking; the stable Site-scoped user ID is the database key, never email.

- D1 + Drizzle store creator profiles, catalog records, immutable versions, dependency edges, stars, fork lineage, and aggregate download counters.
- R2 stores immutable package ZIPs and future screenshots/icons. R2 objects are private and downloads pass through the API for checksum headers and anonymous aggregate counting.
- The Worker never imports or executes uploaded Python. Multipart uploads are bounded and ZIP central directories are inspected before storage.

The database and object store cannot commit atomically. Object keys are content-addressed, publication is idempotent, database uniqueness guards immutable versions, and failed fresh object writes are cleaned up. Periodic orphan cleanup can be added when upload volume warrants it.

## Public API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/commands` | Search/filter/sort cursor-paginated catalog |
| `GET` | `/api/v1/commands/:slug` | Command detail |
| `GET` | `/api/v1/commands/:slug/versions` | Version history |
| `GET` | `/api/v1/commands/:slug/manifest` | Latest manifest |
| `GET` | `/api/v1/commands/:slug/versions/:version/manifest` | Immutable manifest |
| `GET` | `/api/v1/commands/:slug/download` | Latest package |
| `GET` | `/api/v1/commands/:slug/versions/:version/download` | Immutable package |
| `POST` | `/api/publish` | Authenticated multipart publish |
| `POST` | `/api/v1/commands/:slug/star` | Authenticated star toggle |
| `POST` | `/api/v1/commands/:slug/fork` | Authenticated draft fork |
| `POST` | `/mcp` | Stateless read-only MCP server |

`POST /api/publish` accepts `package` (ZIP `File`), `manifest` (JSON string), and optional `readme` and `changelog` strings. A successful response includes `{ ok, slug, version, url }` plus checksum and warning metadata.

The MCP server exposes only `search_commands` and `get_command_manifest`. It does not execute Rhino commands. Actual execution belongs in a future local Rhino bridge where document context and permission prompts exist.

## Local Project Geometry

The registry/runtime and the browser analysis substrate are separate concerns.

\`/project\` provides one **local-only active geometry project** stored in IndexedDB (\`commands-project-v1\`). The record keeps source files, source units, and per-file roles (\`analysis\` / \`context\`). A BroadcastChannel notifies open command previews when the project changes.

The shared browser importer normalizes OBJ, STL, and uncompressed GLB into metre-based triangle buffers plus bounds. Command adapters then request only the representation they need:

- **SunHours** → triangle samples + BVH ray intersections.
- **WindScreen** → horizontal section at 1.5 m above project base → obstacle raster → existing D2Q9 LBM solver.

This is intentionally not a browser CAD document model. The project layer owns import, persistence, units, analysis/context roles, and mesh normalization; individual commands own the transformation from shared geometry into their analytical input. That keeps one upload reusable without pretending every Rhino-specific algorithm can run unchanged in the browser.

## Seed content

The initial fifteen listed commands came from `Hark / Projects / Python Codes - GH Library / 00_Rhino_Commands`, snapshot 2026-10-15, and were reconciled with the owner's COMMANDS repository at `044050f`. They retain `imported-draft` status, zero synthetic engagement, verified creator attribution, and unresolved licenses. That provenance is intentionally visible rather than rewritten as a public release claim.

## Product boundaries

V1 is a registry and community product, not a CAD engine. Sponsorship can attach to a creator profile without restricting community features. Private enterprise libraries can later add organization scopes and membership checks around the same command/version model; no billing behavior is embedded in the public registry.
