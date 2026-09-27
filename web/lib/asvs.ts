// Why each security check exists, cited against OWASP ASVS 5.0.0.
//
// The mapping came from the grader team (sloptic-main, 2026-09-27) and every requirement below was
// checked against the release's own CSV (github.com/OWASP/ASVS, tag v5.0.0,
// 5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv): the number exists, the
// level matches, and the text is about what the check tests.
//
// How it may be said, and how it may not. A check "maps to" a requirement: it tests the part of it a
// visitor can see. Sloptic is never "ASVS compliant", "certified" or "verified". ASVS assumes a
// verifier with the app's documentation and source, and several requirements ask for more than the
// outside shows (HSTS wants a year's max-age, the Secure-cookie requirement wants a name prefix, CSP
// wants specific directives). Numbers and levels are cited; requirement text is not quoted.

import { PROBE_FACTS } from "./checks";

export const ASVS_VERSION = "5.0.0";
export const ASVS_HOME = "https://owasp.org/www-project-application-security-verification-standard/";

type Level = 1 | 2 | 3;

/** maps: the check tests the visible part of this requirement.
 *  closest: no requirement fits exactly; this is the nearest.
 *  related: the requirement asks for something narrower than the check accepts.
 *  stricter: ASVS allows what the check flags; another OWASP source is cited instead.
 *  none: no ASVS requirement covers it; the finding stands on its own. */
export type AsvsRef =
  | { kind: "maps"; req: string; level: Level; note?: string }
  | { kind: "closest"; req: string; level: Level }
  | { kind: "related"; req: string; level: Level; note: string }
  | { kind: "stricter"; note: string; source: { name: string; href: string } }
  | { kind: "none" };

const maps = (req: string, level: Level, note?: string): AsvsRef => ({ kind: "maps", req, level, note });
const closest = (req: string, level: Level): AsvsRef => ({ kind: "closest", req, level });
const NONE: AsvsRef = { kind: "none" };

// 6.3.1 and 15.2.1 are written against the app's own documentation, which Sloptic cannot read, so the
// note says which part it tests.
export const ASVS: Record<string, AsvsRef> = {
  // V1 Encoding and Sanitization
  "sec-sqli-001": maps("1.2.4", 1),
  "sec-sqli-002": maps("1.2.4", 1),
  "sec-sqli-003": maps("1.2.4", 1),
  "sec-sqli-004": maps("1.2.4", 1),
  "sec-sqli-005": maps("1.2.4", 1),
  "sec-filterinj-001": maps("1.2.4", 1),
  "sec-cmdi-001": maps("1.2.5", 1),
  "sec-xss-001": maps("1.2.1", 1),
  "sec-xss-002": maps("1.2.1", 1),
  "sec-xxe-001": maps("1.5.1", 1),
  "sec-ssrf-001": maps("1.3.6", 2),
  "sec-ssti-001": maps("1.3.7", 2),
  // V3 Web Frontend Security
  "sec-headers-003": maps("3.4.1", 1),
  "sec-cors-001": maps("3.4.2", 1),
  "sec-csrf-001": maps("3.5.1", 1),
  "sec-domxss-001": maps("3.2.2", 1),
  "sec-session-003": maps("3.3.1", 1),
  "sec-headers-002": maps("3.4.3", 2),
  "sec-csp-001": maps("3.4.3", 2),
  "sec-headers-001": maps("3.4.4", 2),
  "sec-headers-005": maps("3.4.5", 2),
  "sec-headers-004": {
    kind: "related",
    req: "3.4.6",
    level: 2,
    note: "ASVS asks for CSP frame-ancestors. This check also accepts X-Frame-Options.",
  },
  "sec-session-002": maps("3.3.2", 2),
  "sec-session-001": maps("3.3.4", 2),
  "sec-redirect-001": maps("3.7.2", 2),
  "sec-sri-001": maps("3.6.1", 3),
  // V5 File Handling
  "sec-upload-001": maps("5.3.1", 1),
  "sec-upload-002": maps("5.3.1", 1),
  "sec-lfi-001": maps("5.3.2", 1),
  "sec-dos-001": maps("5.2.3", 2),
  // V6 Authentication
  "sec-ratelimit-001": maps("6.3.1", 1, "ASVS leaves the limit to the app's own docs. Sloptic checks for any throttling."),
  // V7 Session Management
  "sec-session-004": maps("7.2.3", 1),
  // V8 Authorization
  "sec-authbypass-001": maps("8.2.1", 1),
  "sec-idor-001": maps("8.2.2", 1),
  "sec-idor-002": maps("8.2.2", 1),
  "sec-idor-003": maps("8.2.2", 1),
  "sec-idor-004": maps("8.2.2", 1),
  "sec-idor-005": maps("8.2.2", 1),
  "sec-backend-001": maps("8.2.2", 1),
  "sec-backend-002": maps("8.2.2", 1),
  "sec-backend-004": maps("8.2.2", 1),
  "sec-exposure-008": maps("8.2.2", 1),
  // V12 Secure Communication
  "sec-tls-001": maps("12.2.1", 1),
  "sec-mixed-001": closest("12.2.1", 1),
  // V13 Configuration
  "sec-exposure-002": maps("13.4.1", 1),
  "sec-exposure-003": maps("13.4.1", 1),
  "sec-debug-001": maps("13.4.2", 2),
  "sec-secrets-001": closest("13.3.1", 2),
  "sec-secrets-002": closest("13.3.1", 2),
  "sec-secrets-003": closest("13.3.1", 2),
  "sec-headers-006": maps("13.4.6", 3),
  "sec-exposure-001": closest("13.4.7", 3),
  "sec-exposure-004": closest("13.4.7", 3),
  "sec-exposure-006": closest("13.4.7", 3),
  "sec-exposure-007": closest("13.4.7", 3),
  // V14 Data Protection. 14.3.3 exempts session tokens from its browser-storage rule, so the
  // localStorage check cites the cheat sheet that does not.
  "sec-session-006": maps("14.2.1", 1),
  "sec-session-005": {
    kind: "stricter",
    note: "ASVS allows session tokens in browser storage. OWASP's HTML5 cheat sheet does not.",
    source: {
      name: "OWASP HTML5 Security Cheat Sheet",
      href: "https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage",
    },
  },
  "sec-exposure-005": NONE,
  // V15 Secure Coding and Architecture
  "sec-deps-001": maps("15.2.1", 1, "ASVS sets the update deadline in the app's own docs. Sloptic checks for a known CVE."),
  // V16 Security Logging and Error Handling
  "sec-backend-003": maps("16.5.1", 2),
  // No requirement. 4.2.3 is the nearest for response splitting, but it is specific to HTTP/2 and 3.
  "sec-hosthdr-001": NONE,
  "sec-exposure-009": NONE,
  "sec-split-001": NONE,
};

// Chapter files and section names at the v5.0.0 tag, for linking a requirement to its section.
const CHAPTER_FILE: Record<string, string> = {
  V1: "0x10-V1-Encoding-and-Sanitization",
  V3: "0x12-V3-Web-Frontend-Security",
  V5: "0x14-V5-File-Handling",
  V6: "0x15-V6-Authentication",
  V7: "0x16-V7-Session-Management",
  V8: "0x17-V8-Authorization",
  V12: "0x21-V12-Secure-Communication",
  V13: "0x22-V13-Configuration",
  V14: "0x23-V14-Data-Protection",
  V15: "0x24-V15-Secure-Coding-and-Architecture",
  V16: "0x25-V16-Security-Logging-and-Error-Handling",
};

export const SECTION_NAME: Record<string, string> = {
  "1.2": "Injection Prevention",
  "1.3": "Sanitization",
  "1.5": "Safe Deserialization",
  "3.2": "Unintended Content Interpretation",
  "3.3": "Cookie Setup",
  "3.4": "Browser Security Mechanism Headers",
  "3.5": "Browser Origin Separation",
  "3.6": "External Resource Integrity",
  "3.7": "Other Browser Security Considerations",
  "5.2": "File Upload and Content",
  "5.3": "File Storage",
  "6.3": "General Authentication Security",
  "7.2": "Fundamental Session Management Security",
  "8.2": "General Authorization Design",
  "12.2": "HTTPS Communication with External Facing Services",
  "13.3": "Secret Management",
  "13.4": "Unintended Information Leakage",
  "14.2": "General Data Protection",
  "15.2": "Security Architecture and Dependencies",
  "16.5": "Error Handling",
};

/** The requirement's section in the ASVS repo at the release tag, which is as close as GitHub
 *  anchors reach: rows in a requirement table carry no anchor of their own. */
export function asvsHref(req: string): string {
  const section = req.split(".").slice(0, 2).join(".");
  const chapter = `V${req.split(".")[0]}`;
  const anchor = `v${section.replace(".", "")}-${SECTION_NAME[section].toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/ /g, "-")}`;
  return `https://github.com/OWASP/ASVS/blob/v${ASVS_VERSION}/5.0/en/${CHAPTER_FILE[chapter]}.md#${anchor}`;
}

/** How many security checks cite ASVS, and how. */
export function asvsCounts() {
  const security = PROBE_FACTS.filter((f) => f.area === "security");
  const kinds = security.map((f) => ASVS[f.id]?.kind ?? "none");
  return {
    security: security.length,
    maps: kinds.filter((k) => k === "maps").length,
    near: kinds.filter((k) => k === "closest" || k === "related").length,
    stricter: kinds.filter((k) => k === "stricter").length,
    none: kinds.filter((k) => k === "none").length,
  };
}
