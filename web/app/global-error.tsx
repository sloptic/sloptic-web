"use client";

/** The last resort: a fault in the root layout itself, which replaces the layout rather than
 *  rendering inside it, so this file ships its own html and body and cannot use the site stylesheet
 *  or fonts. Kept to plain text and one link for that reason. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "3rem 1.5rem", lineHeight: 1.5 }}>
        <main style={{ maxWidth: "34rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.75rem" }}>Sloptic is having a problem</h1>
          <p style={{ margin: "0 0 1rem" }}>
            The site failed to load. Try again in a moment.
          </p>
          {error.digest && (
            <p style={{ margin: "0 0 1.5rem", fontSize: "0.85rem", opacity: 0.7 }}>
              Reference: {error.digest}
            </p>
          )}
          <a href="/">Back to the homepage</a>
        </main>
      </body>
    </html>
  );
}
