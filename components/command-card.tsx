import Link from "next/link";
import { ArrowDownToLine, GitFork, Star } from "lucide-react";
import type { CommandRecord } from "@/lib/commands";
import { CategoryIcon } from "./category-icon";
import { CommandArtwork } from "./command-artwork";

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function CommandCard({ command, priority = false }: { command: CommandRecord; priority?: boolean }) {
  return (
    <article className="command-card">
      <Link className="card-image-link" href={`/commands/${command.slug}`} tabIndex={-1} aria-hidden="true">
        <CommandArtwork
          slug={command.slug}
          name={command.name}
          category={command.category}
          priority={priority}
        />
      </Link>
      <div className="command-card-body">
        <div className="card-title-row">
          <span className={`category-glyph category-${command.category.toLowerCase()}`}>
            <CategoryIcon category={command.category} />
          </span>
          <div>
            <Link href={`/commands/${command.slug}`}><h3>{command.name}</h3></Link>
            <span className="version-pill">v{command.version}</span>
          </div>
        </div>
        <p>{command.summary}</p>
        <div className="author-row">
          <span className="mini-avatar">BT</span>
          <Link href={`/creators/${command.author.handle}`}>{command.author.name}</Link>
          {command.status === "imported-draft" && <span className="draft-label">Imported draft</span>}
        </div>
        <div className="tag-row">
          <span>{command.category}</span>
          {command.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        <div className="card-meta-row">
          <span title="Downloads"><ArrowDownToLine size={14} /> {compact(command.stats.downloads)}</span>
          <span title="Stars"><Star size={14} /> {compact(command.stats.stars)}</span>
          <span title="Forks"><GitFork size={14} /> {compact(command.stats.forks)}</span>
          <Link className="card-action" href={`/commands/${command.slug}`}>View</Link>
        </div>
      </div>
    </article>
  );
}
