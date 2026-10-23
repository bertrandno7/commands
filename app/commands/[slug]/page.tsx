import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Box,
  Braces,
  CheckCircle2,
  Clock3,
  Code2,
  ExternalLink,
  FileArchive,
  GitFork,
  Globe2,
  Layers3,
  LockKeyhole,
  Network,
  PackageOpen,
  ShieldCheck,
  Star,
  TerminalSquare,
} from "lucide-react";
import { CommandActions } from "@/components/command-actions";
import { CommandArtwork } from "@/components/command-artwork";
import { CategoryIcon } from "@/components/category-icon";
import { CommandCard } from "@/components/command-card";
import { LiveCommandDemo } from "@/components/live-command-demo";
import { seedCommands } from "@/lib/commands";
import { getLiveDemo } from "@/lib/live-demos";
import { getCatalogCommand, getCatalogCommands } from "@/lib/catalog-server";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const command = await getCatalogCommand(slug);
  return command
    ? { title: command.name, description: command.summary }
    : { title: "Command not found" };
}

export function generateStaticParams() {
  return seedCommands.map(({ slug }) => ({ slug }));
}

function PermissionIcon({ permission }: { permission: string }) {
  if (permission.includes("network")) return <Network size={15} />;
  if (permission.includes("filesystem")) return <FileArchive size={15} />;
  if (permission.includes("layer")) return <Layers3 size={15} />;
  return <Box size={15} />;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function CommandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const command = await getCatalogCommand(slug);
  if (!command) notFound();

  const catalog = await getCatalogCommands();
  const related = catalog.filter((item) => item.slug !== command.slug && item.category === command.category).slice(0, 3);
  const liveDemo = getLiveDemo(command.slug);

  return (
    <main className="shell page-shell command-page">
      <Link href="/discover" className="back-link"><ArrowLeft size={15} /> Back to discover</Link>

      <header className="command-header">
        <div className={`detail-icon category-${command.category.toLowerCase()}`}><CategoryIcon category={command.category} size={28} /></div>
        <div className="command-title-block">
          <div className="title-with-version"><h1>{command.name}</h1><span>v{command.version}</span></div>
          <p>{command.summary}</p>
          <div className="command-byline">
            <span className="creator-avatar">BT</span>
            <div><small>Created by</small><Link href={`/creators/${command.author.handle}`}>{command.author.name}</Link></div>
            <span className="verified-chip"><CheckCircle2 size={13} /> Source audited</span>
          </div>
        </div>
        <div className="command-header-actions">
          {command.downloadAvailable === false ? (
            <span className="button button-disabled download-button"><Clock3 size={17} /> Package migration pending</span>
          ) : (
            <a className="button button-dark download-button" href={`/api/v1/commands/${command.slug}/download`}>
              <ArrowDownToLine size={17} /> Download provisional package
            </a>
          )}
          <CommandActions slug={command.slug} />
        </div>
      </header>

      <nav className="detail-tabs" aria-label="Command page sections">
        {liveDemo && <a href="#live-demo" className="active">Playground</a>}
        <a href="#overview">Overview</a>
        <a href="#inputs">Inputs &amp; outputs</a>
        <a href="#dependencies">Dependencies</a>
        <a href="#versions">Versions</a>
        <a href="#provenance">Provenance</a>
      </nav>

      <div className="command-detail-grid">
        <div className="detail-main">
          {liveDemo && <LiveCommandDemo demo={liveDemo} />}

          <section className="detail-gallery" id="overview">
            <CommandArtwork slug={command.slug} name={command.name} category={command.category} priority />
            <div className="gallery-thumbs" aria-hidden="true">
              <span className="active"><CommandArtwork slug={command.slug} name={command.name} category={command.category} /></span>
              <span className="diagram-thumb"><Braces /></span>
              <span className="diagram-thumb"><TerminalSquare /></span>
            </div>
          </section>

          {command.status === "imported-draft" && (
            <aside className="import-notice">
              <AlertTriangle size={18} />
              <div><strong>Imported draft from a working library</strong><p>{command.downloadAvailable === false ? "This catalog record and preview are real, but its Rhino package is still being migrated." : "This seed is packaged as a provisional 0.1.0 snapshot."} Its license still needs an explicit author declaration before production reuse.</p></div>
            </aside>
          )}

          <article className="readme-section">
            <div className="readme-heading"><span>README.md</span><a href={`/api/v1/commands/${command.slug}/manifest`}>View manifest <ExternalLink size={13} /></a></div>
            <h2>{command.name}</h2>
            <p className="readme-lead">{command.description}</p>
            <h3>What it does</h3>
            <ul>
              {command.keyFeatures.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <h3>Designed for focused workflows</h3>
            <p>{command.readme}</p>
          </article>

          <section className="io-section" id="inputs">
            <div className="section-title-line"><div><span className="section-kicker"><Braces size={13} /> Callable interface</span><h2>Inputs &amp; outputs</h2></div><span className="agent-ready">Agent-readable</span></div>
            <div className="io-grid">
              <div className="io-card"><h3>Inputs</h3>{command.inputs.map((item, index) => <div className="io-row" key={`${item.name}-${index}`}><code>{item.name}</code><span>{item.type}</span><p>{item.description}</p></div>)}</div>
              <div className="io-card"><h3>Outputs</h3>{command.outputs.map((item, index) => <div className="io-row" key={`${item.name}-${index}`}><code>{item.name}</code><span>{item.type}</span><p>{item.description}</p></div>)}</div>
            </div>
          </section>

          <section className="versions-section" id="versions">
            <div className="section-title-line"><div><span className="section-kicker"><Clock3 size={13} /> Immutable releases</span><h2>Version history</h2></div></div>
            <div className="version-timeline">
              <article className="current"><i /><div><strong>v{command.version}</strong><span>Current · Imported snapshot</span><p>Initial package conversion from the audited GH Library command source.</p></div><code>SHA-256 published via API</code></article>
              <article><i /><div><strong>Source snapshot</strong><span>15 Oct 2026</span><p>Original Drive library state preserved as provenance.</p></div><code>draft</code></article>
            </div>
          </section>
        </div>

        <aside className="detail-sidebar">
          <section className="download-panel">
            <div className="download-panel-title"><PackageOpen size={18} /><div><strong>Package v{command.version}</strong><span>.command.zip · provisional</span></div></div>
            {command.downloadAvailable === false ? <span className="button button-disabled"><Clock3 size={16} /> Migration pending</span> : <a className="button button-dark" href={`/api/v1/commands/${command.slug}/download`}><ArrowDownToLine size={16} /> Download provisional</a>}
            <Link href="/docs/package-format">Installation guide <ArrowRight size={14} /></Link>
            <dl><div><dt>Rhino</dt><dd>{command.rhinoVersions.join(" / ")}</dd></div><div><dt>Python</dt><dd>{command.pythonEngine}</dd></div><div><dt>Status</dt><dd>Imported draft</dd></div><div><dt>License</dt><dd>{command.license}</dd></div></dl>
          </section>

          <section className="metric-panel">
            <span><Star /><strong>{command.stats.stars}</strong><small>Stars</small></span>
            <span><GitFork /><strong>{command.stats.forks}</strong><small>Forks</small></span>
            <span><ArrowDownToLine /><strong>{command.stats.downloads}</strong><small>Downloads</small></span>
          </section>

          <section className="sidebar-section" id="dependencies">
            <h3><Code2 size={16} /> Dependencies</h3>
            {command.dependencies.length ? <ul>{command.dependencies.map((dependency) => <li key={dependency}><code>{dependency}</code><CheckCircle2 size={14} /></li>)}</ul> : <p className="quiet-state"><CheckCircle2 size={15} /> Bundled Rhino APIs only</p>}
          </section>

          <section className="sidebar-section permissions-panel">
            <h3><ShieldCheck size={16} /> Permissions</h3>
            <ul>{command.permissions.map((permission) => <li key={permission}><PermissionIcon permission={permission} /><span>{humanize(permission)}</span></li>)}</ul>
            <p><LockKeyhole size={13} /> Review source before running downloaded Python.</p>
          </section>

          <section className="sidebar-section" id="provenance">
            <h3><Globe2 size={16} /> Provenance</h3>
            <p>{command.provenance}</p>
            <Link href={`/creators/${command.author.handle}`}>View source collection <ArrowRight size={13} /></Link>
          </section>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="related-section">
          <div className="section-heading-row"><div><span className="section-kicker">Keep exploring</span><h2>More in {command.category}</h2></div><Link className="text-link" href={`/discover?category=${command.category}`}>View category <ArrowRight size={14} /></Link></div>
          <div className="command-grid">{related.map((item) => <CommandCard key={item.slug} command={item} />)}</div>
        </section>
      )}
    </main>
  );
}
