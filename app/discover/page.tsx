import type { Metadata } from "next";
import { Compass, PackageOpen, UsersRound } from "lucide-react";
import { Marketplace } from "@/components/marketplace";
import { commandCategories, type CommandCategory } from "@/lib/commands";
import { getCatalogCommands } from "@/lib/catalog-server";

export const metadata: Metadata = {
  title: "Discover",
  description: "Browse open Rhino and Python design commands.",
};

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const commands = await getCatalogCommands();
  const category = commandCategories.includes(params.category as CommandCategory)
    ? (params.category as CommandCategory)
    : "All";

  return (
    <main className="shell page-shell discover-page">
      <header className="page-intro page-intro-split">
        <div>
          <span className="eyebrow"><i /> COMMUNITY CATALOG</span>
          <h1>Discover small tools<br />with outsized impact.</h1>
          <p>Audited Rhino/Python seeds today; an open community registry tomorrow.</p>
        </div>
        <div className="catalog-facts">
          <span><PackageOpen /><strong>{commands.length}</strong><small>public commands</small></span>
          <span><Compass /><strong>{commandCategories.length}</strong><small>focused categories</small></span>
          <span><UsersRound /><strong>Open</strong><small>free public catalog</small></span>
        </div>
      </header>
      <Marketplace
        commands={commands}
        initialQuery={params.q ?? ""}
        initialCategory={category}
      />
    </main>
  );
}
