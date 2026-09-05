"use client";

import { useEffect } from "react";

/** The route-level fallback. Without one, a render fault anywhere under the layout shows the
 *  framework's own "Application error" screen, which tells a visitor nothing and offers them
 *  nothing. The digest is the only thing that ties this screen to a server log, so it is shown. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("route error:", error);
  }, [error]);

  return (
    <>
      <div className="page-head">
        <h1>Something went wrong</h1>
        <p className="page-lead">This page did not load. Nothing you submitted was lost.</p>
      </div>

      <section className="section">
        <p className="section-intro">
          A grade already running keeps running on the worker, and its report stays at its own link.
        </p>
        <div className="run-controls">
          <button className="button" type="button" onClick={reset}>
            Try again
          </button>
          <a className="button secondary" href="/">
            Start over
          </a>
        </div>
        {error.digest && <p className="fineprint">Reference: {error.digest}</p>}
      </section>
    </>
  );
}
