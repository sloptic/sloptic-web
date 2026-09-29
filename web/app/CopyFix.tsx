"use client";

import { useState } from "react";
import { track } from "@vercel/analytics";

/** Copies one finding as a prompt for an AI coding assistant. The text is built from what this row
 *  already shows (lib/fix-prompt.ts), so it never carries a location the report withheld. A browser
 *  that refuses the clipboard gets the text in a box to copy by hand. */
export default function CopyFix({ probeId, text }: { probeId: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  return (
    <div className="copy-fix">
      <button
        type="button"
        className="button secondary copy-fix-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            track("fix_prompt_copied", { probe: probeId });
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setManual(true);
          }
        }}
      >
        {copied ? "Copied" : "Copy a fix prompt"}
      </button>
      <span className="copy-fix-hint">
        {copied ? "Paste it into your AI assistant." : "For Cursor, Lovable, Bolt, or any AI assistant."}
      </span>
      {manual && (
        <textarea
          className="copy-fix-text"
          readOnly
          value={text}
          rows={8}
          aria-label="Fix prompt"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}
