import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  Code2,
  Download,
  GitFork,
  PackageCheck,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  Star,
  UploadCloud,
} from "lucide-react";
import { CommandArtwork } from "@/components/command-artwork";
import { Marketplace } from "@/components/marketplace";
import { getCatalogCommands } from "@/lib/catalog-server";
import { liveDemos } from "@/lib/live-demos";

export const dynamic = "force-dynamic";

export default async function Home() {
  const commands = await getCatalogCommands();
  const featured = commands.find((command) => command.slug === "sun-hours") ?? commands[0];

  return (
    <main>
      <section className="hero shell">
        <div className="hero-copy">
          <span className="eyebrow"><i /> OPEN COMMAND REGISTRY · RHINO / PYTHON FIRST</span>
          <h1>Small commands.<br /><em>Bigger workflows.</em></h1>
          <p>
            Discover, publish, version, fork, and remix focused design tools—
            without waiting for the next monolithic plugin.
          </p>
          <div className="hero-actions">
            <Link className="button button-dark" href="/discover">Explore commands <ArrowRight size={16} /></Link>
            <Link className="button button-light" href="/publish"><UploadCloud size={16} /> Publish yours</Link>
          </div>
          <div className="hero-proof">
            <div className="proof-avatars" aria-hidden="true">
              <span>RH</span><span>PY</span><span>GH</span><span>+</span>
            </div>
            <p><strong>Open from day one</strong><br />Free community publishing and downloads.</p>
          </div>
        </div>

        <div className="hero-stage" aria-label="Featured command preview">
          <div className="hero-grid-lines" />
          <span className="stage-note stage-note-a">01 / focused</span>
          <span className="stage-note stage-note-b">02 / inspectable</span>
          <div className="featured-command-card">
            <div className="featured-card-topline">
              <span>Featured from the Hark library</span>
              <span className="live-dot">Audited seed</span>
            </div>
            <CommandArtwork slug={featured.slug} name={featured.name} category={featured.category} priority />
            <div className="featured-card-body">
              <div>
                <span className="version-pill">v{featured.version}</span>
                <h2>{featured.name}</h2>
                <p>{featured.summary}</p>
              </div>
              <Link className="round-arrow" href={`/commands/${featured.slug}`} aria-label={`View ${featured.name}`}><ArrowDownRight /></Link>
            </div>
            <div className="featured-card-meta">
              <span><Star size={14} /> {featured.stats.stars}</span>
              <span><GitFork size={14} /> {featured.stats.forks}</span>
              <span><Download size={14} /> {featured.stats.downloads}</span>
              <span className="featured-open">View command <ChevronRight size={14} /></span>
            </div>
          </div>
        </div>
      </section>

      <section className="manifesto-strip">
        <div className="shell manifesto-grid">
          <span className="manifesto-index">COMMANDS / 001</span>
          <h2>One useful action.<br />One understandable package.</h2>
          <p>
            GitHub is built around repositories. Traditional CAD libraries are built around plugins.
            COMMANDS is built around the smallest thing designers actually want to share: a command.
          </p>
        </div>
      </section>

      <div className="shell">
        <Marketplace commands={commands} compact />
      </div>

      <section className="live-labs-section shell">
        <div className="section-heading-row">
          <div>
            <span className="section-kicker"><Radio size={14} /> Tested command labs</span>
            <h2>Not mockups. Working previews.</h2>
          </div>
          <p>Real geometry and analysis kernels from the latest repository, running locally in your browser.</p>
        </div>
        <div className="live-lab-grid">
          {liveDemos.map((demo) => {
            const href = demo.slug ? `/commands/${demo.slug}#live-demo` : demo.path;
            return (
              <article key={demo.id}>
                {/* Automated screenshots are captured from these exact simulations. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/assets/thumbnails/${demo.id}.png`} alt={`${demo.name} working preview`} loading="lazy" />
                <div>
                  <span>{demo.id} · Live</span>
                  <h3>{demo.name}</h3>
                  <p>{demo.summary}</p>
                  <Link href={href}>Run preview <Play size={12} fill="currentColor" /></Link>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="package-section shell">
        <div className="package-copy">
          <span className="section-kicker"><PackageCheck size={14} /> Package format v1</span>
          <h2>Simple enough to read.<br />Structured enough to grow.</h2>
          <p>
            Every command is a portable archive with a manifest, executable code, documentation,
            visuals, dependencies, permissions, and an immutable version.
          </p>
          <ul className="check-list">
            <li><Check size={15} /> Explicit Rhino and Python compatibility</li>
            <li><Check size={15} /> Human-readable permissions before download</li>
            <li><Check size={15} /> Typed inputs and outputs for future agents</li>
            <li><Check size={15} /> Checksummed releases and fork provenance</li>
          </ul>
          <Link className="text-link" href="/docs/package-format">Read the package specification <ArrowRight size={15} /></Link>
        </div>

        <div className="package-window">
          <div className="code-window-bar"><i /><i /><i /><span>command.json</span><em>COMMANDS v1</em></div>
          <pre><code>{`{
  "schemaVersion": "1.0",
  "slug": "twist-for-sun",
  "name": "TwistForSun",
  "commandName": "TwistForSun",
  "version": "0.1.0",
  "summary": "Twist geometry against solar objectives.",
  "description": "Generate and compare solar-aware twists.",
  "category": "Massing",
  "tags": ["solar", "optimization"],
  "license": "MIT",
  "entrypoint": {
    "file": "src/main.py",
    "callable": "run_command"
  },
  "icon": "icon.svg",
  "runtime": {
    "host": "rhino",
    "rhinoVersions": ["8"],
    "pythonEngine": "Rhino 8 CPython"
  },
  "dependencies": {
    "python": [], "commands": [],
    "rhinoPlugins": [], "files": []
  },
  "permissions": ["document.read", "document.write"],
  "interface": {
    "inputs": [{ "name": "geometry", "type": "Brep" }],
    "outputs": [{ "name": "result", "type": "Brep" }]
  }
}`}</code></pre>
          <div className="package-tree">
            <span><Braces size={14} /> command.json</span>
            <span><Code2 size={14} /> src/main.py</span>
            <span>↳ README.md</span>
            <span>↳ icon.svg</span>
          </div>
        </div>
      </section>

      <section className="principles-section">
        <div className="shell">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker"><ShieldCheck size={14} /> Built for trust</span>
              <h2>Open, inspectable, and versioned.</h2>
            </div>
            <p>Community infrastructure without putting the community behind a paywall.</p>
          </div>
          <div className="principle-grid">
            <article><span>01</span><GitFork /><h3>Fork the useful part</h3><p>Start from a real command, preserve its provenance, and publish your remix as a new line of work.</p></article>
            <article><span>02</span><ShieldCheck /><h3>Know what it can touch</h3><p>Network, files, document layers, and geometry writes are declared before a package is downloaded.</p></article>
            <article><span>03</span><Sparkles /><h3>Ready for agent workflows</h3><p>Typed inputs, outputs, objectives, and side effects let future Rhino bridges call commands safely.</p></article>
          </div>
        </div>
      </section>

      <section className="roadmap-teaser shell">
        <div className="roadmap-intro">
          <span className="eyebrow"><i /> BUILT IN SMALL, USEFUL STEPS</span>
          <h2>From registry<br />to design operating system.</h2>
          <p>V1 stays focused: no browser CAD, no pretend installer. Each next layer builds on the same open package.</p>
          <Link className="button button-light" href="/roadmap">See the roadmap <ArrowRight size={16} /></Link>
        </div>
        <ol className="roadmap-list">
          <li className="active"><span>01</span><div><em>Now</em><strong>Open command registry</strong><p>Discover, publish, download, version, and fork.</p></div></li>
          <li><span>02</span><div><em>Next</em><strong>Rhino companion</strong><p>Install, update, and expose packages as native commands.</p></div></li>
          <li><span>03</span><div><strong>AI command creation</strong><p>Generate and validate commands from intent and examples.</p></div></li>
          <li><span>04</span><div><strong>Analysis-aware commands</strong><p>Combine geometry, metrics, and objectives in one call.</p></div></li>
          <li><span>05</span><div><strong>Standalone 3D environment</strong><p>A future canvas, only after the command ecosystem works.</p></div></li>
        </ol>
      </section>

      <section className="closing-cta">
        <div className="shell closing-cta-inner">
          <div><span>THE NEXT USEFUL COMMAND</span><h2>might already be sitting<br />in your scripts folder.</h2></div>
          <div><p>Package it once. Let the community improve it.</p><Link className="button button-white" href="/publish">Publish a command <ArrowRight size={16} /></Link></div>
        </div>
      </section>
    </main>
  );
}
