# COMMANDS roadmap

1. **V1 community registry** — responsive discovery, command detail and creator surfaces; authenticated publish/star/fork; immutable versions; explicit dependencies and permissions; Drive seeds with honest provenance; public REST and read-only MCP discovery.
2. **Rhino integration** — a lightweight per-user installer consumes `/api/v1`, verifies SHA-256, prompts for permissions, installs versioned packages, registers native Rhino command names, records a lockfile, and checks compatible updates.
3. **AI command creation** — an assisted authoring flow creates code, tests, README, icon, typed interfaces, and permission declarations. Generated packages remain reviewable artifacts and are never silently executed or published.
4. **Analysis-aware composition** — commands exchange typed geometry and analysis outputs, accept objective values, and report metrics. Local Rhino orchestration can compose commands such as mass generation, `SunHours`, and `SunCarve` while respecting declared side effects.
5. **Standalone 3D environment** — only after the registry, package ecosystem, execution contracts, and analysis model prove useful, build a browser-native geometry environment that consumes the same package metadata rather than replacing it.

The public community catalog, downloads, versions, forks, and package format remain free and open throughout. Sponsorship and future paid private organization libraries are additive surfaces, not gates on public commands.
