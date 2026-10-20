"use client";

import { useState } from "react";
import { Bookmark, Check, GitFork, LoaderCircle, Star } from "lucide-react";

export function CommandActions({ slug }: { slug: string }) {
  const [pending, setPending] = useState<"star" | "fork" | null>(null);
  const [starred, setStarred] = useState(false);
  const [message, setMessage] = useState("");

  async function act(kind: "star" | "fork") {
    setPending(kind);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/commands/${slug}/${kind}`, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { error?: string; starred?: boolean; draftUrl?: string };
      if (response.status === 401) {
        setMessage(`Sign in to ${kind} this command.`);
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Action failed");
      if (kind === "star") {
        setStarred(payload.starred ?? !starred);
        setMessage(payload.starred === false ? "Removed from your stars." : "Added to your stars.");
      } else {
        setMessage("Fork draft created in your library.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="command-actions-wrap">
      <div className="command-secondary-actions">
        <button onClick={() => act("star")} disabled={pending !== null} className={starred ? "active" : ""}>
          {pending === "star" ? <LoaderCircle className="spin" size={16} /> : starred ? <Check size={16} /> : <Star size={16} />}
          {starred ? "Starred" : "Star"}
        </button>
        <button onClick={() => act("fork")} disabled={pending !== null}>
          {pending === "fork" ? <LoaderCircle className="spin" size={16} /> : <GitFork size={16} />} Fork
        </button>
        <button type="button" onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => setMessage("Link copied."))}>
          <Bookmark size={16} /> Save link
        </button>
      </div>
      <span className="action-message" aria-live="polite">{message}</span>
    </div>
  );
}
