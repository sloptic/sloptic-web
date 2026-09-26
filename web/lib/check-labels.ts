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

  "supply-chain": {
    name: "subresource integrity",
    href: `${MDN}/Web/Security/Subresource_Integrity`,
  },
  "transport-security": {
    name: "transport security",
    href: `${MDN}/Web/HTTP/Reference/Headers/Strict-Transport-Security`,
  },

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
  // 3.0 moved qa-seo-001 out of quality into accessibility and renamed its category, so the old
  // `seo` label had nothing left to label. The probe asks for a viewport meta tag, without which a
  // phone renders the desktop page shrunk to unreadable, and a description. The viewport half is
  // why it now sits with accessibility.
  "mobile-visibility": {
    name: "mobile viewport and description",
    href: `${MDN}/Web/HTML/Guides/Viewport_meta_element`,
  },
  // New in 3.0: a page the app links to still showing generator filler (lorem ipsum, an LLM's own
  // meta text, two or more distinct [Placeholder] brackets). A string match, never a judgment of
  // whether the page looks finished.
  "scaffold-content": {
    name: "leftover template text",
    href: "https://iso25000.com/index.php/en/iso-25000-standards/iso-25010",
  },

  availability: { name: "availability", href: `${MDN}/Web/HTTP/Reference/Status/503` },
  "email-verification": {
    name: "email verification",
    href: `${OWASP}/Authentication_Cheat_Sheet.html`,
  },
  "password-reset": {
    name: "password reset",
    href: `${OWASP}/Forgot_Password_Cheat_Sheet.html`,
  },

  // performance
  speed: { name: "server response speed", href: "https://web.dev/articles/ttfb" },
  "web-vitals": { name: "core web vitals", href: "https://web.dev/articles/vitals" },
  "page-weight": {
    name: "page weight",
    href: "https://developer.chrome.com/docs/lighthouse/performance/total-byte-weight",
  },
  caching: { name: "caching", href: `${MDN}/Web/HTTP/Guides/Caching` },
  "load-resilience": { name: "behavior under load", href: `${CWE}/400.html` },
  "load-time": { name: "load time", href: "https://web.dev/articles/optimize-lcp" },
  "request-count": {
    name: "request count",
    href: "https://developer.chrome.com/docs/lighthouse/performance/resource-summary",
  },
  "dom-size": {
    name: "DOM size",
    href: "https://developer.chrome.com/docs/lighthouse/performance/dom-size",
  },
  "font-loading": { name: "font loading", href: "https://web.dev/articles/font-best-practices" },
  "lcp-strategy": { name: "largest contentful paint", href: "https://web.dev/articles/lcp" },
  minification: { name: "minification", href: `${MDN}/Glossary/Minification` },
  overall: {
    name: "overall Lighthouse score",
    href: "https://developer.chrome.com/docs/lighthouse/performance/performance-scoring",
  },
};

export const AREA_LABELS: Record<string, string> = {
  security: "security",
  qa: "quality",
  accessibility: "accessibility",
  performance: "performance",
};

/** A short name for every check, as a noun phrase naming the slop it finds. Written here rather than
 *  taken from the grader's report-card copy, which describes the passing state in a full sentence
 *  and has no line for four of the Lighthouse audits. A check with no name here fails the checks
 *  test. Backticks mark code. */
export const PROBE_NAMES: Record<string, string> = {
  // accessibility
  "qa-a11y-001": "Accessibility barriers on the rendered page",
  "qa-a11y-002": "Accessibility basics missing from the markup",
  "qa-seo-001": "No `viewport` or `description` meta tag",
  // performance
  "perf-lighthouse-001": "Lighthouse score below 90",
  "perf-load-001": "Server errors under a burst of traffic",
  "perf-cache-001": "Static files not cacheable",
  "perf-cwv-001": "Slow first contentful paint",
  "perf-cwv-002": "Failing Core Web Vitals",
  "perf-dom-001": "Oversized DOM",
  "perf-font-001": "Invisible text during font load",
  "perf-lcp-001": "Largest image found late",
  "perf-loadtime-001": "Slow Speed Index",
  "perf-minify-001": "Unminified JavaScript or CSS",
  "perf-requests-001": "Too many requests",
  "perf-ttfb-001": "Slow server response",
  "perf-weight-001": "Heavy page",
  // quality
  "qa-backnav-001": "Broken back button",
  "qa-chunk-001": "Missing script bundle",
  "qa-console-001": "Errors thrown on load",
  "qa-crash-010": "Crash on malformed input",
  "qa-ctype-001": "Wrong `Content-Type`",
  "qa-deadctrl-001": "Buttons that do nothing",
  "qa-deeplink-001": "Broken deep links",
  "qa-deploy-001": "Backend address set to localhost",
  "qa-deploy-002": "Endless redirect loop",
  "qa-deploy-003": "Sign-in redirect to localhost",
  "qa-devbuild-001": "Development build in production",
  "qa-email-001": "Late or missing signup email",
  "qa-email-002": "Dead confirmation link",
  "qa-errhyg-001": "Leaked stack traces or database errors",
  "qa-http-001": "Soft 404s",
  "qa-http-002": "Missing charset",
  "qa-input-001": "Browser-only validation",
  "qa-input-002": "Broken international text",
  "qa-integrity-001": "Saved values changed on the way back",
  "qa-integrity-002": "Created items never saved",
  "qa-links-001": "Dead internal links",
  "qa-noerror-001": "Silent failed saves",
  "qa-race-001": "Duplicate IDs from simultaneous creates",
  "qa-race-002": "Duplicate IDs from simultaneous API creates",
  "qa-reset-001": "Broken password reset",
  "qa-scaffold-001": "Placeholder text on linked pages",
  "qa-staleui-001": "Stale view after a create",
  // security
  "sec-authbypass-001": "Protected route open without login",
  "sec-backend-001": "Database open to anonymous visitors",
  "sec-backend-002": "Rows readable by other signed-in users",
  "sec-backend-003": "Database schema exposed",
  "sec-backend-004": "Storage bucket listable by anyone",
  "sec-cmdi-001": "Command injection",
  "sec-cors-001": "Credentialed CORS for any origin",
  "sec-csp-001": "Toothless CSP",
  "sec-csrf-001": "No CSRF protection",
  "sec-debug-001": "Debug mode in production",
  "sec-deps-001": "Libraries with known vulnerabilities",
  "sec-domxss-001": "DOM-based cross-site scripting",
  "sec-dos-001": "Unbounded decompression (zip bomb)",
  "sec-exposure-001": "`.env` file served",
  "sec-exposure-002": "`.git/config` served",
  "sec-exposure-003": "`.git/HEAD` served",
  "sec-exposure-004": "Deploy files served (state files, dumps, keys)",
  "sec-exposure-005": "Credentials in responses",
  "sec-exposure-006": "Source maps served",
  "sec-exposure-007": "Credential files served",
  "sec-exposure-008": "Bulk records without login",
  "sec-exposure-009": "Internal addresses in the bundle",
  "sec-filterinj-001": "Filter injection",
  "sec-headers-001": "No `nosniff` header",
  "sec-headers-002": "No CSP",
  "sec-headers-003": "No HSTS",
  "sec-headers-004": "No clickjacking protection",
  "sec-headers-005": "No referrer policy",
  "sec-headers-006": "Server version advertised",
  "sec-hosthdr-001": "Host header injection",
  "sec-idor-001": "Other users' records readable by ID",
  "sec-idor-002": "Other accounts' objects readable through the API",
  "sec-idor-003": "Other users' profiles readable",
  "sec-idor-004": "Other users' backend rows readable",
  "sec-idor-005": "Other users' objects in private lists",
  "sec-lfi-001": "Path traversal",
  "sec-mixed-001": "Mixed content",
  "sec-ratelimit-001": "No login rate limit",
  "sec-redirect-001": "Open redirect",
  "sec-secrets-001": "Keys or tokens in shipped code",
  "sec-secrets-002": "Server secrets in the bundle",
  "sec-secrets-003": "Live Gemini key in the bundle",
  "sec-session-001": "Session cookie without `HttpOnly`",
  "sec-session-002": "Session cookie without `SameSite`",
  "sec-session-003": "Session cookie without `Secure`",
  "sec-session-004": "Guessable session IDs",
  "sec-session-005": "Session token in `localStorage`",
  "sec-session-006": "Session token in the URL",
  "sec-split-001": "Response splitting",
  "sec-sqli-001": "Login bypass with `' OR '1'='1' --`",
  "sec-sqli-002": "Login bypass with `' OR 1=1 --`",
  "sec-sqli-003": "Login bypass with `' OR 'a'='a' --`",
  "sec-sqli-004": "SQL injection in an API parameter",
  "sec-sqli-005": "Login bypass with `' OR '1'='1`",
  "sec-sri-001": "CDN files without integrity hashes",
  "sec-ssrf-001": "Server-side request forgery",
  "sec-ssti-001": "Template injection",
  "sec-tls-001": "No HTTPS",
  "sec-upload-001": "Uploads that run on the server",
  "sec-upload-002": "Uploads served as live pages",
  "sec-xss-001": "Reflected cross-site scripting",
  "sec-xss-002": "Stored cross-site scripting",
  "sec-xxe-001": "XML external entities",
};

/** What each price rung proves, keyed `category:evidence`, as a short fragment beside its points. The
 *  grader names a rung by an evidence flag, and the same flag means different things in different
 *  classes (`sensitive_fields` is a system file for path traversal and cloud metadata for SSRF), so
 *  the key carries the category. A rung with no entry here fails the checks test. */
export const RUNG_TEXT: Record<string, string> = {
  "access-control:cross_user_read": "reads another user's record",
  "access-control:sensitive_fields": "record holds personal or secret data",
  "access-control:bulk_read": "reaches many users' records",
  "access-control:cross_user_write": "changes another user's record",
  "availability:observed": "visitors' browsers call it",
  "availability:root_loop": "the homepage itself loops",
  "backend-exposure:sensitive_fields": "personal, financial or credential data",
  "backend-exposure:bulk_read": "records readable in bulk",
  "backend-exposure:write_confirmed": "anyone can write to it",
  "command-injection:execution_confirmed": "the command runs",
  "console-errors:error_overlay": "an error screen shows",
  "data-exposure:sensitive_fields": "personal, financial or credential data",
  "data-exposure:bulk_read": "records readable in bulk",
  "data-exposure:validated_live": "the credential works",
  "data-exposure:high_privilege": "server key, database login or private key",
  "data-exposure:write_confirmed": "anyone can write data",
  "dead-controls:primary_cta": "the page's main action",
  "debug-mode:execution_confirmed": "the debugger runs code",
  "dom-xss:execution_confirmed": "the script runs",
  "dom-xss:stored": "stored for every visitor",
  "email-verification:email_late_30s": "over 30 seconds late",
  "email-verification:verification_dead_nonblocking": "user let in, email never arrives",
  "email-verification:no_email_60s": "no email within a minute",
  "error-hygiene:db_error": "database details leaked",
  "exposure:validated_live": "the credential works",
  "exposure:high_privilege": "server key, database login or private key",
  "file-upload:execution_confirmed": "the upload runs",
  "file-upload:stored": "stored for every visitor",
  "input-validation:server_error": "the server crashes",
  "load-resilience:observed_5xx": "server errors under load",
  "open-redirect:external_host": "to an outside site",
  "open-redirect:auth_flow": "inside the login flow",
  "password-reset:no_reset_email_60s": "no reset email within a minute",
  "path-traversal:sensitive_fields": "a system file read",
  "path-traversal:high_privilege": "source or secrets read",
  "secrets-exposure:validated_live": "the key works",
  "secrets-exposure:high_privilege": "server key, database login or private key",
  "sql-injection:data_extracted": "real rows pulled out",
  "sql-injection:write_confirmed": "data changed",
  "ssrf:internal_reached": "the server makes the request",
  "ssrf:sensitive_fields": "cloud metadata or secrets reached",
  "template-injection:execution_confirmed": "the payload runs",
  "xss:execution_confirmed": "the script runs",
  "xss:stored": "stored for every visitor",
  "xxe:internal_reached": "the server makes an outside request",
  "xxe:sensitive_fields": "a system file read",
};
