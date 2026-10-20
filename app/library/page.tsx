import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookMarked, Download, GitFork, LockKeyhole, PackageOpen, Star } from "lucide-react";
import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";

export const metadata: Metadata = { title: "My library" };
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await getChatGPTUser();
  if (!user) return <main className="shell page-shell"><section className="auth-gate"><span><LockKeyhole /></span><div><small>PERSONAL LIBRARY</small><h1>Keep commands close without closing the commons.</h1><p>Sign in to collect stars, published packages, downloads, and fork drafts.</p><a className="button button-dark" href={chatGPTSignInPath("/library")} target="_top">Sign in with ChatGPT <ArrowRight /></a></div></section></main>;
  return <main className="shell page-shell library-page"><header className="page-intro"><span className="eyebrow"><i /> {user.displayName.toUpperCase()}</span><h1>My library</h1><p>Your saved, downloaded, published, and forked commands will live here.</p></header><nav className="library-tabs"><button className="active"><Star /> Starred <span>0</span></button><button><Download /> Downloaded <span>0</span></button><button><PackageOpen /> Published <span>0</span></button><button><GitFork /> Forks <span>0</span></button></nav><section className="library-empty"><span><BookMarked /></span><h2>Your library is ready for its first command.</h2><p>Star a useful package or fork one into a publishable draft.</p><Link className="button button-dark" href="/discover">Discover commands <ArrowRight /></Link></section></main>;
}
