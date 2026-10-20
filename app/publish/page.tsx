import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LockKeyhole, PackagePlus, ShieldCheck } from "lucide-react";
import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";
import { PublishWizard } from "@/components/publish-wizard";

export const metadata: Metadata = { title: "Publish", description: "Package and publish an open Rhino command." };
export const dynamic = "force-dynamic";

export default async function PublishPage() {
  const user = await getChatGPTUser();
  return (
    <main className="shell page-shell publish-page">
      <header className="page-intro page-intro-split publish-intro">
        <div><span className="eyebrow"><i /> CONTRIBUTE</span><h1>Publish one useful<br />thing at a time.</h1><p>Turn a focused Rhino script into a versioned, inspectable command package.</p></div>
        <div className="publish-principles"><span><PackagePlus /><strong>Immutable releases</strong><small>Every version gets its own checksum.</small></span><span><ShieldCheck /><strong>Explicit permissions</strong><small>No hidden network or file access.</small></span><span><LockKeyhole /><strong>You own the source</strong><small>Choose an open license you understand.</small></span></div>
      </header>

      {user ? <PublishWizard userName={user.displayName} /> : (
        <section className="auth-gate">
          <span><LockKeyhole /></span>
          <div><small>SIGN IN REQUIRED TO PUBLISH</small><h2>Your drafts and releases need a stable creator identity.</h2><p>Browsing and downloading stay public. Sign in only when you want to publish, star, or fork a command.</p><div><a className="button button-dark" href={chatGPTSignInPath("/publish")} target="_top">Sign in with ChatGPT <ArrowRight size={16} /></a><Link className="button button-light" href="/docs/package-format">Read the package docs</Link></div></div>
        </section>
      )}
    </main>
  );
}
