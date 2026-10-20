import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Boxes, Cable, Check, Compass, Sparkles } from "lucide-react";

export const metadata: Metadata = { title: "Roadmap", description: "COMMANDS product roadmap from registry to a future 3D environment." };

const phases = [
  { number: "01", state: "Shipping in V1", icon: Compass, title: "Open command registry", description: "Discover, search, download, publish, version, star, fork, and remix focused Rhino/Python commands.", points: ["Public catalog and rich detail pages", "Open package spec and validation", "Creator identity, immutable versions, provenance"] },
  { number: "02", state: "Next", icon: Cable, title: "Lightweight Rhino companion", description: "Turn registry packages into native Rhino commands without hiding the source or installation state.", points: ["Verified download and permission prompts", "Per-user install, update, and rollback", "Native command aliases and local lockfile"] },
  { number: "03", state: "Explore", icon: Sparkles, title: "AI command creation", description: "Describe intent, generate a package, test its manifest contract, and publish it with a human review loop.", points: ["Prompt-to-package scaffolding", "Static checks and Rhino sandbox testing", "Human-owned release and provenance"] },
  { number: "04", state: "Explore", icon: Bot, title: "Analysis-aware commands", description: "Compose geometry, analysis, and objectives—like TwistForSun—through typed local calls.", points: ["Command dependency graphs", "Objective and metric interfaces", "Agent tool discovery through the local bridge"] },
  { number: "05", state: "Later", icon: Boxes, title: "Standalone 3D environment", description: "Only after the command ecosystem and interoperability model are proven: a purpose-built browser-native design canvas.", points: ["Portable scene model", "Command graph and live previews", "Open interchange with Rhino and other tools"] },
];

export default function RoadmapPage() {
  return <main className="shell page-shell roadmap-page"><header className="roadmap-hero"><span className="eyebrow"><i /> PRODUCT DIRECTION</span><h1>Earn the right<br />to build the canvas.</h1><p>COMMANDS begins with a narrow promise: make small design tools easier to find, trust, and improve. Each phase compounds the same open package format.</p></header><div className="roadmap-phases">{phases.map((phase, index) => { const Icon = phase.icon; return <article key={phase.number} className={index === 0 ? "current" : ""}><div className="phase-number">{phase.number}</div><div className="phase-icon"><Icon /></div><div className="phase-body"><span>{phase.state}</span><h2>{phase.title}</h2><p>{phase.description}</p><ul>{phase.points.map((point) => <li key={point}><Check /> {point}</li>)}</ul></div></article>; })}</div><section className="roadmap-boundary"><div><span>V1 PRODUCT BOUNDARY</span><h2>No browser CAD. No simulated one-click install. No paywall around the commons.</h2></div><div><p>V1 proves discovery, packaging, provenance, and community workflows. Sponsorships can support creators; future private enterprise libraries can fund the platform. Public commands remain public.</p><Link className="button button-dark" href="/discover">Explore the V1 catalog <ArrowRight size={15} /></Link></div></section></main>;
}
