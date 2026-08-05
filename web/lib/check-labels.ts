// Human labels for the generated category facts. This is the only hand-written half: the counts and
// the passive/active status come from the grader (checks.generated.ts), and these turn slugs into
// something a reader can use.
//
// `href` points at the authority that defines the thing. Every category carries one, because the
// failure this page exists to prevent is a reader looking at a row and wondering what the check even
// is. Every URL here was checked.
//
// A category with no entry here still renders, falling back to its slug, so a new one arriving from
// the grader shows up as something to name rather than disappearing.

export type Label = { name: string; href?: string };

const OWASP = "https://cheatsheetseries.owasp.org/cheatsheets";
const MDN = "https://developer.mozilla.org/en-US/docs";
const CWE = "https://cwe.mitre.org/data/definitions";

export const LABELS: Record<string, Label> = {
  // security
  "security-headers": { name: "security headers", href: "https://owasp.org/www-project-secure-headers/" },
  "access-control": { name: "access control", href: "https://owasp.org/Top10/A01_2021-Broken_Access_Control/" },
  exposure: { name: "exposed files", href: "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/" },
  "sql-injection": { name: "sql injection", href: `${OWASP}/SQL_Injection_Prevention_Cheat_Sheet.html` },
  session: { name: "session handling", href: `${OWASP}/Session_Management_Cheat_Sheet.html` },
  "session-management": {
    name: "session lifetime",
    href: `${OWASP}/Session_Management_Cheat_Sheet.html`,
  },
  xss: { name: "cross-site scripting", href: "https://owasp.org/www-community/attacks/xss/" },
  "dom-xss": { name: "scripting in the browser", href: `${OWASP}/DOM_based_XSS_Prevention_Cheat_Sheet.html` },
  "backend-exposure": {
    name: "managed backend rules",
    href: "https://owasp.org/Top10/A01_2021-Broken_Access_Control/",
  },
  "data-exposure": { name: "exposed data", href: "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/" },
  "secrets-exposure": {
    name: "secrets in the shipped code",
    href: `${OWASP}/Secrets_Management_Cheat_Sheet.html`,
  },
  "file-upload": { name: "file uploads", href: `${OWASP}/File_Upload_Cheat_Sheet.html` },
  cors: { name: "cross-origin sharing rules", href: `${MDN}/Web/HTTP/Guides/CORS` },
  csrf: {
    name: "cross-site request forgery",
    href: `${OWASP}/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html`,
  },
  "command-injection": {
    name: "command injection",
    href: "https://owasp.org/www-community/attacks/Command_Injection",
  },
  "debug-mode": { name: "debug mode left on", href: "https://owasp.org/Top10/A05_2021-Security_Misconfiguration/" },
  dependency: {
    name: "known-vulnerable dependencies",
    href: "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/",
  },
  "dos-resistance": {
    name: "oversized request handling",
    href: `${CWE}/409.html`,
  },
  "filter-injection": { name: "filter injection", href: `${CWE}/943.html` },
  "host-header": { name: "host header handling", href: `${MDN}/Web/HTTP/Reference/Headers/Host` },
  "mixed-content": { name: "mixed content", href: `${MDN}/Web/Security/Mixed_content` },
  "open-redirect": {
    name: "open redirects",
    href: `${OWASP}/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html`,
  },
  "path-traversal": { name: "path traversal", href: "https://owasp.org/www-community/attacks/Path_Traversal" },
  "rate-limiting": { name: "login rate limiting", href: `${OWASP}/Authentication_Cheat_Sheet.html` },
  "response-splitting": {
    name: "response splitting",
    href: "https://owasp.org/www-community/attacks/HTTP_Response_Splitting",
  },
  ssrf: {
    name: "server-side request forgery",
    href: `${OWASP}/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`,
  },
  "template-injection": {
    name: "template injection",
    href: "https://portswigger.net/web-security/server-side-template-injection",
  },
  xxe: { name: "xml external entities", href: `${OWASP}/XML_External_Entity_Prevention_Cheat_Sheet.html` },

  // quality
  "ui-honesty": { name: "honest navigation", href: `${MDN}/Web/API/History_API` },
  accessibility: { name: "accessibility", href: "https://www.w3.org/WAI/standards-guidelines/wcag/" },
  "data-integrity": {
    name: "data integrity",
    href: "https://en.wikipedia.org/wiki/Durability_(database_systems)",
  },
  "race-condition": { name: "race conditions", href: `${CWE}/362.html` },
  "broken-links": { name: "broken links", href: `${MDN}/Web/HTTP/Reference/Status/404` },
  "console-errors": { name: "console errors", href: `${MDN}/Web/API/console/error_static` },
  "content-type": { name: "content types", href: `${MDN}/Web/HTTP/Guides/MIME_types` },
  "crash-resistance": { name: "crash resistance", href: `${MDN}/Web/HTTP/Reference/Status/500` },
  "dead-controls": {
    name: "dead controls",
    href: "https://www.w3.org/WAI/ARIA/apg/patterns/button/",
  },
  "deployment-hygiene": {
    name: "development build left online",
    href: "https://react.dev/learn/react-developer-tools",
  },
  "error-hygiene": { name: "error handling", href: `${OWASP}/Error_Handling_Cheat_Sheet.html` },
  "http-conformance": { name: "http conformance", href: `${MDN}/Web/HTTP/Reference/Status` },
  "http-correctness": {
    name: "pages that fail quietly",
    href: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors",
  },
  "input-validation": { name: "input validation", href: `${OWASP}/Input_Validation_Cheat_Sheet.html` },
  seo: {
    name: "crawlability",
    href: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
  },

  // performance
  speed: { name: "server response speed", href: "https://web.dev/articles/ttfb" },
  "web-vitals": { name: "core web vitals", href: "https://web.dev/articles/vitals" },
  "page-weight": {
    name: "page weight",
    href: "https://developer.chrome.com/docs/lighthouse/performance/total-byte-weight",
  },
  caching: { name: "caching", href: `${MDN}/Web/HTTP/Guides/Caching` },
  compression: { name: "compression", href: `${MDN}/Web/HTTP/Guides/Compression` },
  "load-resilience": { name: "behavior under load", href: `${CWE}/400.html` },
  "load-time": { name: "load time", href: "https://web.dev/articles/optimize-lcp" },
  "request-count": {
    name: "request count",
    href: "https://developer.chrome.com/docs/lighthouse/performance/resource-summary",
  },
};

export const AREA_LABELS: Record<string, string> = {
  security: "security",
  qa: "accessibility & quality",
  performance: "performance",
};
