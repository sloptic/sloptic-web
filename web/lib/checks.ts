// The check catalog, as the site presents it. One source of truth for both the landing section
// (which names the areas and a few checks, without counts) and /checks (the reference page, where
// the counts belong).
//
// Counts mirror the grader's catalog exactly: 91 checks in 91 files, 37 of them passive.
// `open` runs on any URL; `gated` needs domain verification because those checks send test traffic.
// A check links to the authority that defines it where there is a canonical one. Items with no
// single canonical source stay unlinked on purpose: a weak citation is worse than none.

export type Check = { name: string; href?: string };
export type Channel = {
  id: string;
  label: string;
  passive: number;
  total: number;
  blurb: string;
  open: Check[];
  gated: Check[];
};

export const CATALOG_URL = "https://github.com/sloptic/sloptic-main/tree/main/catalog";

export const CHANNELS: Channel[] = [
  {
    id: "security",
    label: "security",
    passive: 14,
    total: 57,
    blurb:
      "Getting this wrong costs the people who trusted your app, not you. Sloptic looks for missing defenses and secrets left in the code you ship, following OWASP.",
    open: [
      { name: "security headers", href: "https://owasp.org/www-project-secure-headers/" },
      {
        name: "secrets in the shipped code",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
      },
      { name: "exposed data", href: "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/" },
      {
        name: "sharing rules (CORS)",
        href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS",
      },
      {
        name: "mixed content",
        href: "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content",
      },
      {
        name: "known-vulnerable dependencies",
        href: "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/",
      },
    ],
    gated: [
      {
        name: "sql injection",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
      },
      { name: "cross-site scripting", href: "https://owasp.org/www-community/attacks/xss/" },
      {
        name: "login rate limiting",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html",
      },
      { name: "access control", href: "https://owasp.org/Top10/A01_2021-Broken_Access_Control/" },
      {
        name: "session handling",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html",
      },
      {
        name: "file uploads",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html",
      },
      { name: "path traversal", href: "https://owasp.org/www-community/attacks/Path_Traversal" },
      {
        name: "open redirects",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html",
      },
    ],
  },
  {
    id: "qa",
    label: "accessibility & quality",
    passive: 12,
    total: 22,
    blurb:
      "An app a screen reader cannot operate is closed to the people who rely on one. Sloptic checks whether controls work and whether pages fail honestly, using axe-core against WCAG.",
    open: [
      { name: "accessibility", href: "https://www.w3.org/WAI/standards-guidelines/wcag/" },
      { name: "broken links" },
      {
        name: "pages that fail quietly",
        href: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors",
      },
      { name: "console errors" },
      {
        name: "content types",
        href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types",
      },
      { name: "development build left online" },
      { name: "honest navigation" },
    ],
    gated: [
      { name: "crash resistance" },
      {
        name: "bad input handling",
        href: "https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html",
      },
      { name: "data integrity" },
      { name: "dead controls" },
    ],
  },
  {
    id: "performance",
    label: "performance",
    passive: 11,
    total: 12,
    blurb:
      "Most people will not wait for a slow app, so Sloptic measures real load speed and page weight as Google's Core Web Vitals.",
    open: [
      { name: "core web vitals", href: "https://web.dev/articles/vitals" },
      { name: "load time", href: "https://web.dev/articles/optimize-lcp" },
      { name: "time to first byte", href: "https://web.dev/articles/ttfb" },
      {
        name: "page weight",
        href: "https://developer.chrome.com/docs/lighthouse/performance/total-byte-weight",
      },
      { name: "request count" },
      {
        name: "compression",
        href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression",
      },
      { name: "caching", href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching" },
    ],
    gated: [{ name: "behavior under load" }],
  },
];

export const TOTALS = {
  total: CHANNELS.reduce((n, c) => n + c.total, 0),
  passive: CHANNELS.reduce((n, c) => n + c.passive, 0),
  get active() {
    return this.total - this.passive;
  },
};
