import Link from "next/link";
import { Bell, Menu, Plus, Search } from "lucide-react";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";
import { BrandMark } from "./brand-mark";

export async function SiteHeader() {
  const user = await getChatGPTUser();
  const initials = (user?.displayName ?? "Guest")
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="header-brand">
          <BrandMark />
        </Link>

        <Link href="/discover" className="header-search" aria-label="Search commands">
          <Search size={16} />
          <span>Search commands, creators, or tags…</span>
          <kbd>⌘ K</kbd>
        </Link>

        <nav className="desktop-nav" aria-label="Primary navigation">
          <Link href="/discover">Discover</Link>
          <Link href="/publish">Publish</Link>
          <Link href="/docs/package-format">Docs</Link>
          <Link href="/roadmap">Roadmap</Link>
        </nav>

        <div className="header-actions">
          <Link className="icon-button desktop-only" href="/library" aria-label="Library updates">
            <Bell size={17} />
          </Link>
          <Link className="publish-compact desktop-only" href="/publish">
            <Plus size={16} /> Publish
          </Link>
          {user ? (
            <details className="profile-menu">
              <summary className="avatar" title={user.displayName}>{initials}</summary>
              <div className="profile-popover">
                <strong>{user.displayName}</strong>
                <span>{user.email}</span>
                <Link href="/library">My library</Link>
                <a href={chatGPTSignOutPath("/")} target="_top">Sign out</a>
              </div>
            </details>
          ) : (
            <a className="sign-in desktop-only" href={chatGPTSignInPath("/")} target="_top">
              Sign in
            </a>
          )}
          <details className="mobile-menu">
            <summary className="icon-button" aria-label="Open navigation"><Menu size={19} /></summary>
            <nav>
              <Link href="/discover">Discover</Link>
              <Link href="/publish">Publish a command</Link>
              <Link href="/docs/package-format">Package docs</Link>
              <Link href="/roadmap">Roadmap</Link>
              <Link href="/library">My library</Link>
              {!user && <a href={chatGPTSignInPath("/")} target="_top">Sign in</a>}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
