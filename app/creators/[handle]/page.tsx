import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  FolderGit2,
  Globe2,
  PackageOpen,
  Sparkles,
  Star,
} from "lucide-react";
import { CommandCard } from "@/components/command-card";
import { getCatalogCommands } from "@/lib/catalog-server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const command = (await getCatalogCommands()).find((item) => item.author.handle === handle);
  return command
    ? { title: command.author.name, description: `Commands by ${command.author.name}.` }
    : { title: "Creator not found" };
}

export default async function CreatorPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const catalog = await getCatalogCommands();
  const creatorCommands = catalog.filter((command) => command.author.handle === handle);
  if (!creatorCommands.length) notFound();

  const author = creatorCommands[0].author;
  const isSeedCreator = handle === "bertrandno7";
  const stars = creatorCommands.reduce((sum, command) => sum + command.stats.stars, 0);
  const categories = new Set(creatorCommands.map((command) => command.category)).size;
  const initials = author.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <main className="shell page-shell creator-page">
      <header className="creator-hero">
        <div className="creator-monogram">{initials}</div>
        <div className="creator-identity">
          <span>{isSeedCreator ? "CREATOR · CURATED SOURCE COLLECTION" : "COMMUNITY CREATOR"}</span>
          <h1>{author.name}</h1>
          <p>
            {isSeedCreator
              ? "Creator of the Hark Rhino/Python library: geometry, analysis, facade, massing, and workflow commands audited as the first COMMANDS seed collection."
              : "An open COMMANDS contributor publishing focused, inspectable Rhino design tools."}
          </p>
          <div className="creator-links">
            <span><CalendarDays /> {isSeedCreator ? "Drive snapshot 15 Oct 2026" : "Community publisher"}</span>
            <span><Globe2 /> Public command profile</span>
            {isSeedCreator ? (
              <a href="https://github.com/bertrandno7/commands" target="_blank" rel="noreferrer">
                <FolderGit2 /> GitHub source <ArrowRight />
              </a>
            ) : (
              <Link href="/docs/package-format"><FolderGit2 /> Package format <ArrowRight /></Link>
            )}
          </div>
        </div>
        <div className="creator-stats">
          <span><strong>{creatorCommands.length}</strong><small>Commands</small></span>
          <span><strong>{stars}</strong><small>Recorded stars</small></span>
          <span><strong>{categories}</strong><small>Categories</small></span>
        </div>
      </header>

      {isSeedCreator && (
        <aside className="creator-note">
          <Sparkles />
          <p>
            <strong>Seed status:</strong> fifteen audited scripts have provisional downloadable
            packages; five newer catalog entries remain preview-only while migration finishes.
            Creator attribution is corroborated by the latest repository. Public licensing
            remains pending an explicit declaration.
          </p>
        </aside>
      )}

      <section className="creator-catalog">
        <div className="section-heading-row">
          <div>
            <span className="section-kicker"><PackageOpen /> Public collection</span>
            <h2>Commands by {author.name}</h2>
          </div>
          <span className="creator-total"><Star /> {stars} recorded stars</span>
        </div>
        <div className="command-grid">
          {creatorCommands.map((command) => <CommandCard key={command.slug} command={command} />)}
        </div>
      </section>
    </main>
  );
}
