// Where a failed category goes deeper than Sloptic does.
//
// Sloptic is the breadth pass: one score across four areas. Each area has a specialist that tests it
// in far more detail, and a reader who wants that detail belongs there, so a finding points at it
// rather than Sloptic growing into it. A TOOL link opens the specialist already pointed at the graded
// app; everything else falls back to the category's reference page from check-labels.ts.
//
// Only public, passive tools that anyone may point at any site, so a link here never becomes a way
// to test an app its reader does not own. URL formats checked 2026-09-29.

import { LABELS } from "./check-labels";

export type Deeper =
  | { kind: "tool"; name: string; href: string; what: string }
  | { kind: "reference"; name: string; href: string };

// Lighthouse audits every one of these, and PageSpeed Insights runs Lighthouse. Behavior under load
// is not one of them (Lighthouse loads the page once), so it keeps its reference page.
const LIGHTHOUSE = new Set([
  "caching",
  "dom-size",
  "font-loading",
  "lcp-strategy",
  "load-time",
  "minification",
  "overall",
  "page-weight",
  "request-count",
  "speed",
  "web-vitals",
]);

// What the HTTP Observatory tests: response headers, HSTS and subresource integrity.
const OBSERVATORY = new Set(["security-headers", "transport-security", "supply-chain"]);

// A reference page's publisher, by host. An unlisted host shows as itself.
const PUBLISHERS: Record<string, string> = {
  "owasp.org": "OWASP",
  "cheatsheetseries.owasp.org": "OWASP",
  "developer.mozilla.org": "MDN",
  "cwe.mitre.org": "MITRE",
  "w3.org": "W3C",
  "web.dev": "web.dev",
  "developer.chrome.com": "Chrome for Developers",
  "developers.google.com": "Google",
  "portswigger.net": "PortSwigger",
  "react.dev": "React",
  "en.wikipedia.org": "Wikipedia",
  "iso25000.com": "ISO 25000",
};

function publisher(href: string): string {
  const host = new URL(href).hostname.replace(/^www\./, "");
  return Object.hasOwn(PUBLISHERS, host) ? PUBLISHERS[host] : host;
}

/** Where to go deeper on a category, for the app at `origin`, or null when there is nowhere. */
export function deeperFor(slug: string, origin: string): Deeper | null {
  let app: URL | null = null;
  try {
    app = new URL(origin);
  } catch {
    app = null;
  }
  if (app) {
    if (LIGHTHOUSE.has(slug)) {
      return {
        kind: "tool",
        name: "PageSpeed Insights",
        href: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(app.origin)}`,
        what: "runs the full Lighthouse report on this app.",
      };
    }
    if (slug === "accessibility") {
      // WAVE reads the address raw after the hash, unencoded.
      return {
        kind: "tool",
        name: "WAVE",
        href: `https://wave.webaim.org/report#/${app.origin}`,
        what: "marks each accessibility problem on the page.",
      };
    }
    if (OBSERVATORY.has(slug)) {
      return {
        kind: "tool",
        name: "HTTP Observatory",
        href: `https://developer.mozilla.org/en-US/observatory/analyze?host=${encodeURIComponent(app.hostname)}`,
        what: "checks this app's headers in detail.",
      };
    }
  }
  const href = Object.hasOwn(LABELS, slug) ? LABELS[slug].href : undefined;
  return href ? { kind: "reference", name: publisher(href), href } : null;
}
