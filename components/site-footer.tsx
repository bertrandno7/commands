import Link from "next/link";
import { ArrowUpRight, Code2 } from "lucide-react";
import { BrandMark } from "./brand-mark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand-block">
          <BrandMark />
          <p>Small, open design commands. Built by designers, for designers.</p>
          <span>Community features stay free.</span>
        </div>
        <div className="footer-column">
          <strong>Explore</strong>
          <Link href="/discover">All commands</Link>
          <Link href="/discover?sort=updated">Recently updated</Link>
          <Link href="/creators/bertrandno7">Creators</Link>
        </div>
        <div className="footer-column">
          <strong>Build</strong>
          <Link href="/publish">Publish a command</Link>
          <Link href="/docs/package-format">Package format</Link>
          <Link href="/roadmap">Rhino integration</Link>
        </div>
        <div className="footer-column">
          <strong>Open by default</strong>
          <p>Public discovery, downloads, forks and version history—with future private libraries kept separate.</p>
          <a href="https://github.com/bertrandno7/commands" target="_blank" rel="noreferrer">
            <Code2 size={15} /> View the source <ArrowUpRight size={13} />
          </a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} COMMANDS</span>
        <span>Rhino is a trademark of Robert McNeel &amp; Associates.</span>
      </div>
    </footer>
  );
}
