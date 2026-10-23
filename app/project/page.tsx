import type { Metadata } from "next";
import { ProjectGeometryManager } from "@/components/project-geometry-manager";

export const metadata: Metadata = {
  title: "Experimental Project Geometry",
  description: "Experimental local geometry import for selected COMMANDS analyses.",
};

export default function ProjectPage() {
  return (
    <main className="shell page-shell project-page">
      <header className="page-intro">
        <span className="eyebrow"><i /> EXPERIMENTAL · NOT REQUIRED FOR V1</span>
        <h1>Bring your own model.<br />Later.</h1>
        <p>
          COMMANDS V1 is designed around fast basic-shape playgrounds with no upload step.
          This local geometry importer remains available for testing, but it is no longer part of the main product journey.
        </p>
      </header>
      <ProjectGeometryManager />
    </main>
  );
}
