"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Play, Radio } from "lucide-react";
import type { LiveCommandDemo } from "@/lib/live-demos";

export function LiveCommandDemo({ demo }: { demo: LiveCommandDemo }) {
  const [height, setHeight] = useState(760);

  function resizeToContent(frame: HTMLIFrameElement) {
    try {
      const documentInside = frame.contentDocument;
      const content = documentInside?.querySelector<HTMLElement>(".page, .command-app, [data-command-preview]");
      const naturalHeight = Math.max(
        content?.getBoundingClientRect().height ?? 0,
        documentInside?.body.scrollHeight ?? 0,
      );
      if (naturalHeight > 100) {
        setHeight(Math.max(560, Math.min(2400, Math.ceil(naturalHeight) + 8)));
      }
    } catch {
      // The published previews are same-origin; retain the safe default if that changes.
    }
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; height?: number; path?: string };
      if (data?.type !== "commands:embed-height" || data.path !== demo.path) return;
      if (!Number.isFinite(data.height)) return;
      setHeight(Math.max(560, Math.min(2400, Math.ceil(data.height ?? 760) + 8)));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [demo.path]);

  return (
    <section className="live-demo-section" id="live-demo">
      <div className="live-demo-heading">
        <div>
          <span className="section-kicker"><Radio size={13} /> Working preview · {demo.id}</span>
          <h2>Try {demo.name} in the browser</h2>
          <p>{demo.summary}</p>
        </div>
        <a href={demo.path} target="_blank" rel="noreferrer">
          Open full screen <ExternalLink size={14} />
        </a>
      </div>
      <div className="live-demo-frame-shell">
        <div className="live-demo-bar">
          <span><Play size={12} fill="currentColor" /> Live calculation</span>
          <small>Rhino-free preview · source logic ported for the web</small>
        </div>
        <iframe
          id="live-command-frame"
          title={`${demo.name} interactive command preview`}
          src={`${demo.path}?embed=1`}
          style={{ height }}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-downloads"
          onLoad={(event) => resizeToContent(event.currentTarget)}
        />
      </div>
      <p className="live-demo-caveat">
        This preview runs a tested browser adaptation. The downloadable command remains the Rhino/Python source of record.
      </p>
    </section>
  );
}
