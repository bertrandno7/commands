import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProjectGeometryManager } from "@/components/project-geometry-manager";

export const metadata: Metadata = {
  title: "Experimental Project Geometry",
  description: "Experimental local geometry import for future browser-capable COMMANDS workflows.",
};

export default function ProjectPage() {
  return (
    <main className="shell page-shell project-page">
      <Link href="/discover" className="back-link"><ArrowLeft size={15} /> Back to discover</Link>
      <header className="page-intro">
        <span className="eyebrow"><i /> EXPERIMENTAL · PARKED FOR LATER</span>
        <h1>Project geometry<br />is not part of V1.</h1>
        <p>
          COMMANDS currently prioritizes fast, reliable browser playgrounds built from simple parametric
          shapes. The local OBJ / STL / GLB importer remains here for development, but command previews
          no longer depend on it or load it automatically.
        </p>
      </header>
      <ProjectGeometryManager />
    </main>
  );
}
