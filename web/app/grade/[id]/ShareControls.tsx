"use client";

import { useEffect, useRef, useState } from "react";
import { shareTargets, shareText, shareTitle, type ShareCard } from "@/lib/share";

/** Sharing a score, on the report.
 *
 *  Two controls, so the report stays about the report: "Copy link", which covers Slack, Discord, email
 *  and anywhere else, and "Share", which opens the phone's own share sheet or, on a desktop, a short
 *  menu of the platforms. Every link it hands out is the SHARE link (/s/<token>), never this page's:
 *  the report URL is read access to every finding and, while unclaimed, the right to delete the report.
 *
 *  The share link is fetched when the controls mount, not on click, so each click stays inside its
 *  own user gesture. Safari refuses navigator.share and clipboard writes that come after an await.
 */
export default function ShareControls({ gradeId, card }: { gradeId: string; card: ShareCard }) {
  const [url, setUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/grade/${gradeId}/share`, { method: "POST" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { url?: string };
        if (!live) return;
        if (res.ok && body.url) setUrl(body.url);
        else setUnavailable(true);
      })
      .catch(() => live && setUnavailable(true));
    return () => {
      live = false;
    };
  }, [gradeId]);

  // Close the menu on Escape or a click anywhere else, the way every menu on the page behaves.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // No share link, no controls. The report reads the same without them.
  if (unavailable) return null;

  async function copy(which: string) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2500);
    } catch {
      // A browser that refuses the clipboard still lets someone select the link by hand.
      setManual(true);
    }
  }

  function share() {
    if (!url) return;
    // The native sheet on a touch device: it lists the apps this person actually has. A desktop gets
    // the menu, since its "share" (where it exists) offers little beyond mail.
    const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (touch && typeof navigator.share === "function") {
      navigator.share({ title: shareTitle(card), text: shareText(card), url }).catch(() => {});
      return;
    }
    setOpen((o) => !o);
  }

  return (
    <div className="share">
      <div className="share-row">
        <button type="button" className="button secondary" onClick={() => void copy("link")} disabled={!url}>
          {copied === "link" ? "Copied" : "Copy link"}
        </button>
        <div className="share-menu-wrap" ref={wrap}>
          <button
            type="button"
            className="button secondary"
            onClick={share}
            disabled={!url}
            aria-expanded={open}
            aria-controls="share-menu"
          >
            Share <span aria-hidden>▾</span>
          </button>
          {open && url && (
            <ul className="share-menu" id="share-menu">
              {shareTargets(url, card).map((t) => (
                <li key={t.id}>
                  {"href" in t ? (
                    <a href={t.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                      {t.label}
                    </a>
                  ) : (
                    <button type="button" onClick={() => void copy(t.id)}>
                      {copied === t.id ? `Copied. Paste it in ${t.label}.` : `Copy link for ${t.label}`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {manual && url && (
        <input className="share-manual" readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
      )}
    </div>
  );
}
