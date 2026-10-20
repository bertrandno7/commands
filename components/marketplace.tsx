"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  Grid2X2,
  List,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { CommandCategory, CommandRecord } from "@/lib/commands";
import { CommandCard } from "./command-card";
import { CategoryIcon } from "./category-icon";

const categories: Array<{ name: CommandCategory; blurb: string }> = [
  { name: "Geometry", blurb: "Modeling tools and utilities" },
  { name: "Analysis", blurb: "Environmental and spatial" },
  { name: "AI", blurb: "Generative and goal-driven" },
  { name: "Facade", blurb: "Panels, systems, envelopes" },
  { name: "Massing", blurb: "Urban form and volumes" },
  { name: "Utilities", blurb: "Workflow and productivity" },
];

type WebMcpRegistry = {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema: object;
    execute(input: unknown): unknown | Promise<unknown>;
  }, options?: { signal?: AbortSignal }): void | Promise<void>;
};

export function Marketplace({
  commands,
  compact = false,
  initialQuery = "",
  initialCategory = "All",
}: {
  commands: CommandRecord[];
  compact?: boolean;
  initialQuery?: string;
  initialCategory?: CommandCategory | "All";
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<CommandCategory | "All">(initialCategory);
  const [sort, setSort] = useState("trending");
  const [view, setView] = useState<"grid" | "list">("grid");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const subset = commands.filter((command) => {
      const matchesCategory = category === "All" || command.category === category;
      const haystack = [command.name, command.summary, command.category, ...command.tags].join(" ").toLowerCase();
      return matchesCategory && (!needle || haystack.includes(needle));
    });
    return [...subset].sort((a, b) => {
      if (sort === "stars") return b.stats.stars - a.stats.stars;
      if (sort === "downloads") return b.stats.downloads - a.stats.downloads;
      if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      return (b.stats.downloads + b.stats.stars * 8) - (a.stats.downloads + a.stats.stars * 8);
    });
  }, [category, commands, query, sort]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const writing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((!writing && event.key === "/") || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const registry = (document as Document & { readonly modelContext?: WebMcpRegistry }).modelContext;
    if (typeof registry?.registerTool !== "function") return;
    const lifecycle = new AbortController();
    const register = async () => {
      await registry.registerTool({
        name: "search_commands",
        description: "Search the currently visible COMMANDS catalog by name, category, or tag.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" }, category: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        execute(input: unknown) {
          const value = input as { query?: unknown; category?: unknown };
          if (typeof value?.query !== "string") throw new Error("query must be a string");
          const requestedCategory = categories.find((item) => item.name === value.category)?.name;
          setQuery(value.query);
          if (requestedCategory) setCategory(requestedCategory);
          const needle = value.query.toLowerCase();
          return commands
            .filter((command) => [command.name, command.summary, ...command.tags].join(" ").toLowerCase().includes(needle))
            .slice(0, 8)
            .map(({ name, slug, summary, version }) => ({ name, slug, summary, version }));
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [commands]);

  const clear = () => {
    setQuery("");
    setCategory("All");
  };

  return (
    <section className={compact ? "marketplace marketplace-compact" : "marketplace"}>
      <div className="marketplace-heading">
        <div>
          <span className="section-kicker"><Sparkles size={13} /> Open registry</span>
          <h2>{compact ? "Commands worth keeping close" : "Discover commands"}</h2>
          <p>Small, inspectable tools for a faster and more thoughtful design process.</p>
        </div>
        {compact && <Link className="text-link" href="/discover">Explore the full library <ArrowRight size={15} /></Link>}
      </div>

      <div className="category-strip" aria-label="Command categories">
        {categories.map((item) => {
          const count = commands.filter((command) => command.category === item.name).length;
          return (
            <button
              key={item.name}
              className={`category-tile category-${item.name.toLowerCase()} ${category === item.name ? "active" : ""}`}
              onClick={() => setCategory(category === item.name ? "All" : item.name)}
              type="button"
            >
              <span className="category-tile-icon"><CategoryIcon category={item.name} /></span>
              <span><strong>{item.name}</strong><small>{item.blurb}</small></span>
              <em>{count.toString().padStart(2, "0")}</em>
            </button>
          );
        })}
      </div>

      <div className="marketplace-toolbar">
        <label className="catalog-search">
          <Search size={17} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by command, creator, or tag"
            aria-label="Search command catalog"
          />
          {query ? <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button> : <kbd>/</kbd>}
        </label>
        <button className="filter-button" type="button"><SlidersHorizontal size={15} /> Filters <span>3</span></button>
        <label className="sort-select">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort commands">
            <option value="trending">Trending</option>
            <option value="updated">Recently updated</option>
            <option value="stars">Most starred</option>
            <option value="downloads">Most downloaded</option>
          </select>
          <ChevronDown size={14} />
        </label>
        <div className="view-toggle" aria-label="View mode">
          <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Grid2X2 size={16} /></button>
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><List size={17} /></button>
        </div>
      </div>

      {(query || category !== "All") && (
        <div className="active-filter-row">
          <span>{filtered.length} result{filtered.length === 1 ? "" : "s"}</span>
          {category !== "All" && <button onClick={() => setCategory("All")}>{category} <X size={13} /></button>}
          {query && <button onClick={() => setQuery("")}>“{query}” <X size={13} /></button>}
          <button className="clear-all" onClick={clear}>Clear all</button>
        </div>
      )}

      {filtered.length ? (
        <div className={`command-grid ${view === "list" ? "list-view" : ""}`}>
          {(compact ? filtered.slice(0, 6) : filtered).map((command, index) => (
            <CommandCard key={command.slug} command={command} priority={index < 3} />
          ))}
        </div>
      ) : (
        <div className="empty-results">
          <span><Search size={22} /></span>
          <h3>No commands match yet</h3>
          <p>Try a broader term or clear the active category.</p>
          <button onClick={clear}>Reset search</button>
        </div>
      )}
    </section>
  );
}
