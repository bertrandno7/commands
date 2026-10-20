import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Box,
  Braces,
  CheckCircle2,
  Download,
  FileCode2,
  Folder,
  Network,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = { title: "Package format", description: "The open COMMANDS v1 package specification." };

export default function PackageFormatPage() {
  return (
    <main className="shell page-shell docs-page">
      <header className="docs-hero">
        <span className="eyebrow"><i /> OPEN SPECIFICATION · V1.0</span>
        <h1>A command is a folder<br />with a clear contract.</h1>
        <p>The package format keeps source inspectable today and gives a future Rhino companion—and future agents—enough structure to install and call it safely.</p>
        <div><a className="button button-dark" href="/schema/command-package-v1.schema.json"><Download size={16} /> Download JSON Schema</a><Link className="button button-light" href="/publish">Publish a package <ArrowRight size={15} /></Link></div>
      </header>

      <div className="docs-layout">
        <aside className="docs-nav"><strong>On this page</strong><a href="#structure">Archive structure</a><a href="#manifest">Manifest</a><a href="#interface">Typed interface</a><a href="#permissions">Permissions</a><a href="#versioning">Versioning</a><a href="#rhino">Rhino integration</a></aside>
        <article className="docs-content">
          <section id="structure"><span className="docs-index">01</span><h2>Archive structure</h2><p>A `.command.zip` has no build step and no opaque bundle. The manifest and entrypoint live at predictable paths.</p><div className="file-tree"><span><Folder /> twist-for-sun-0.1.0.command/</span><span className="indent"><Braces /> command.json <em>required</em></span><span className="indent"><FileCode2 /> src/main.py <em>required</em></span><span className="indent"><FileCode2 /> README.md <em>required</em></span><span className="indent"><FileCode2 /> LICENSE <em>required for public packages</em></span><span className="indent"><Box /> icon.svg</span><span className="indent"><Folder /> screenshots/</span><span className="indent"><FileCode2 /> requirements.txt</span></div><aside className="docs-note"><PackageCheck /><p><strong>V1 limits</strong> 10 MB compressed, 50 MB expanded, and 100 files. Paths must be relative; symlinks and executable extras are rejected.</p></aside></section>

          <section id="manifest"><span className="docs-index">02</span><h2>The manifest</h2><p>`command.json` is the canonical record. It names the entrypoint, compatibility, dependencies, permission surface, and agent-readable interface.</p><pre className="docs-code"><code>{`{
  "schemaVersion": "1.0",
  "name": "TwistForSun",
  "slug": "twist-for-sun",
  "version": "0.1.0",
  "summary": "Twist geometry toward better solar access.",
  "description": "Generate and compare solar-aware twists.",
  "license": "MIT",
  "category": "Analysis",
  "tags": ["solar", "optimization"],
  "commandName": "TwistForSun",
  "entrypoint": { "file": "src/main.py", "callable": "run_command" },
  "icon": "icon.svg",
  "runtime": {
    "host": "rhino",
    "rhinoVersions": ["8"],
    "pythonEngine": "CPython 3"
  },
  "dependencies": {
    "python": ["numpy>=1.26"],
    "commands": [{ "id": "sun-hours", "version": "^1.0.0" }],
    "rhinoPlugins": [],
    "files": []
  },
  "permissions": ["document.read", "document.write"],
  "interface": { "inputs": [], "outputs": [], "objectives": [] }
}`}</code></pre></section>

          <section id="interface"><span className="docs-index">03</span><h2>Geometry + analysis + objectives</h2><p>Inputs and outputs follow a small JSON-Schema-compatible vocabulary. V1 displays this contract; the Rhino bridge will later translate document objects into local command calls.</p><div className="interface-diagram"><div><Box /><strong>Inputs</strong><code>geometry: Brep</code><code>location: GeoPoint</code><code>rotation_range: NumberRange</code></div><ArrowRight /><div><Bot /><strong>Objective</strong><code>maximize: sun_hours</code><code>preserve: floor_area</code></div><ArrowRight /><div><Braces /><strong>Outputs</strong><code>geometry: Brep</code><code>sun_hours: Number</code><code>report: DataTree</code></div></div><aside className="docs-note"><Bot /><p><strong>Agent-ready does not mean cloud execution.</strong> Hosted COMMANDS never runs uploaded Python. A future local Rhino bridge performs authorized calls inside the user’s session.</p></aside></section>

          <section id="permissions"><span className="docs-index">04</span><h2>Permissions are part of the package</h2><p>Permissions describe side effects in human language before download and machine language before local execution.</p><div className="permission-doc-grid"><span><Box /><strong>geometry_read</strong><small>Read selected document geometry</small></span><span><Box /><strong>geometry_write</strong><small>Add or modify document geometry</small></span><span><Network /><strong>network</strong><small>Call declared hostnames only</small></span><span><FileCode2 /><strong>filesystem_read_user_file</strong><small>Read a file the user explicitly selects</small></span><span><FileCode2 /><strong>filesystem_write_project_sidecar</strong><small>Write declared files beside the model</small></span><span><ShieldCheck /><strong>document_layers_write</strong><small>Create and reorganize Rhino layers</small></span></div></section>

          <section id="versioning"><span className="docs-index">05</span><h2>Immutable versions, understandable updates</h2><p>Versions use Semantic Versioning. The registry stores the exact manifest, README, checksum, package size, and changelog for every release. A fork points to its source command and version without sharing mutable state.</p><ul className="docs-check-list"><li><CheckCircle2 /> Patch: compatible fixes</li><li><CheckCircle2 /> Minor: backwards-compatible capability</li><li><CheckCircle2 /> Major: breaking input, output, permission, or runtime change</li></ul></section>

          <section id="rhino"><span className="docs-index">06</span><h2>Future Rhino companion contract</h2><p>The lightweight companion will query the public API, download an immutable ZIP, verify SHA-256, prompt for permissions, install per user, register `commandName` as a native Rhino command, and maintain a lockfile for updates. The package format does not depend on that plugin to remain useful.</p><div className="endpoint-list"><code>GET /api/v1/commands</code><code>GET /api/v1/commands/:slug/manifest</code><code>GET /api/v1/commands/:slug/download</code><code>GET /api/v1/commands/:slug/versions</code></div></section>
        </article>
      </div>
    </main>
  );
}
