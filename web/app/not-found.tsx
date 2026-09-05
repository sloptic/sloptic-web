import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

// A report link is a capability, so the two ways to land here are a typo and a report that has been
// deleted. Both are said plainly rather than guessed between.
export default function NotFound() {
  return (
    <>
      <div className="page-head">
        <h1>Not found</h1>
        <p className="page-lead">There is nothing at this address.</p>
      </div>

      <section className="section">
        <p className="section-intro">
          If you followed a report link, the report may have been deleted, or its retention window
          may have run out. Anonymous reports are kept for 30 days.
        </p>
        <div className="run-controls">
          <a className="button" href="/">
            Grade an app
          </a>
          <a className="button secondary" href="/grades">
            Your grades
          </a>
        </div>
      </section>
    </>
  );
}
