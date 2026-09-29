/** The fix prompt is built from what the report shows, and nothing else. */
import { describe, it, expect } from "vitest";
import { fixPrompt } from "@/lib/fix-prompt";

const base = {
  origin: "https://myapp.dev",
  category: "security headers",
  probeId: "sec-headers-001",
};

describe("fixPrompt", () => {
  it("carries every shown field, labelled", () => {
    const t = fixPrompt({
      ...base,
      reason: "No Content-Security-Policy header.",
      targets: ["/"],
      expected: "A Content-Security-Policy header.",
      actual: "None was sent.",
      remediation: "Set a Content-Security-Policy header.",
    });
    expect(t).toContain("https://myapp.dev");
    expect(t).toContain("Check: security headers (sec-headers-001)");
    expect(t).toContain("Problem: No Content-Security-Policy header.");
    expect(t).toContain("Where: /");
    expect(t).toContain("Expected: A Content-Security-Policy header.");
    expect(t).toContain("Found instead: None was sent.");
    expect(t).toContain("Suggested fix: Set a Content-Security-Policy header.");
  });

  it("leaves out what a withheld finding does not carry", () => {
    // What a non-owner receives for a gated family: no reason, target, evidence or actual.
    const t = fixPrompt({ ...base, probeId: "sec-secrets-001", expected: "No secrets in shipped code.", remediation: "Rotate it." });
    expect(t).not.toMatch(/^(Problem|Where|Found instead):/m);
    expect(t).toContain("Expected: No secrets in shipped code.");
  });

  it("lists a few paths and counts the rest", () => {
    const targets = ["/a", "/b", "/c", "/d", "/e", "/f", "/g"];
    expect(fixPrompt({ ...base, targets })).toContain("Where: /a, /b, /c, /d, /e, and 2 more");
  });
});
