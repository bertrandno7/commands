import Link from "next/link";

export default function CommandNotFound() {
  return <main className="shell page-shell simple-state"><span>404 / COMMAND NOT FOUND</span><h1>This command has moved—or has not been published yet.</h1><p>Search the open catalog for another useful tool.</p><Link className="button button-dark" href="/discover">Browse commands</Link></main>;
}
