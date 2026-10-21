import type { Metadata } from "next";
import { ProjectGeometryManager } from "@/components/project-geometry-manager";

export const metadata: Metadata = {
  title: "Project Geometry",
  description: "Load one local geometry project and reuse it across browser-capable COMMANDS analyses.",
};

export default function ProjectPage() {
  return (
    <main className="shell page-shell project-page">
      <header className="page-intro">
        <span className="eyebrow"><i /> COMMANDS PROJECT</span>
        <h1>One model.<br />Many commands.</h1>
        <p>
          Keep a shared architectural model in your browser, then reuse it across analysis commands
          without uploading the same file again.
        </p>
      </header>
      <ProjectGeometryManager />
    </main>
  );
}
