"use client";

import { useState } from "react";

/** Turn "your grade is ready" mail on or off.
 *
 *  Optimistic, and reverts on failure. A preference switch that sits still for a round trip reads as
 *  broken, and the cost of being wrong here is that a checkbox flicks back, which is a cost worth
 *  paying for a control nobody should have to think about.
 */
export default function NotifyToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function set(next: boolean) {
    const before = on;
    setOn(next);
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/account/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setOn(before);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="notify-toggle">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => void set(e.target.checked)}
        />
        <span>Email me when a grade or an event finishes</span>
      </label>
      {failed && (
        <p className="error" role="alert">
          Could not save that. Try again.
        </p>
      )}
    </>
  );
}
