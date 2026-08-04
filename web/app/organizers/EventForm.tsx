"use client";

import { useState } from "react";

const NOTE =
  "Ranking an event is started by the person running it, so we know the entrants agreed to be judged. Verify you organize this event and Sloptic will grade the web app entries on the same scale.";

// The event input lives here so the page still works for someone arriving from a link rather than
// from the landing. The carried value comes in as a prop rather than from useSearchParams, so the
// form is in the server-rendered HTML instead of appearing only after hydration.
// Nothing is queued yet: this collects the event and routes to verification.
export default function EventForm({ initialEvent = "" }: { initialEvent?: string }) {
  const [eventUrl, setEventUrl] = useState(initialEvent);
  const [note, setNote] = useState<string | null>(initialEvent ? NOTE : null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const host = eventUrl.trim().replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
    if (!host.endsWith(".devpost.com")) {
      setNote("That does not look like a Devpost event. It should look like your-event.devpost.com.");
      return;
    }
    setNote(NOTE);
  }

  return (
    <div className="event-form-wrap">
      <form onSubmit={submit} className="grade-form">
        <input
          type="text"
          inputMode="url"
          placeholder="https://your-event.devpost.com"
          value={eventUrl}
          onChange={(e) => setEventUrl(e.target.value)}
          aria-label="Devpost event URL"
        />
        <button type="submit">rank it</button>
      </form>
      {note && (
        <p className="rank-note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
