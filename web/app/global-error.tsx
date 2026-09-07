"use client";

/** The last resort: a fault in the root layout itself, which replaces the layout rather than
 *  rendering inside it, so this file ships its own html and body and cannot use the site stylesheet
 *  or fonts. Kept to plain text and one link for that reason. */
// Dark mode reaches even here. This page replaces the root layout, so it inherits neither the
// stylesheet nor the script that applies the reader's theme, and it used to come up on white paper
// behind a dark site. A <style> block rather than a script: script-src carries a nonce, which turns
// off its 'unsafe-inline' fallback in any browser that understands nonces, and a client error
// boundary cannot read the per-request nonce to get one. style-src has no nonce, so inline style is
// allowed, which also means this follows the system setting only. An explicit toggle lives in
// localStorage and reading it needs the script we cannot have. Being one shade off on the crash
// page is a fair price for not shipping a script the browser refuses to run.
const DARK = `
  @media (prefers-color-scheme: dark) {
    html { background: #0f1210; color: #d9ddce; color-scheme: dark; }
    a { color: #e0902f; }
  }
`;

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: DARK }} />
      </head>
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
