/** The policy is strictly tighter in production than in development, and that difference is the
 *  whole point of the test.
 *
 *  Development needs 'unsafe-eval' because Next's dev bundler evaluates modules as strings; without
 *  it React never hydrates and every control on the site is dead on localhost. Production needs it
 *  gone, because 'unsafe-eval' is most of what a CSP is for. The two requirements pull opposite
 *  ways, which is exactly the shape of thing a later refactor collapses into one branch, and the
 *  failure is silent: the site keeps working, it is just no longer defended. Sloptic prices a
 *  toothless CSP itself, so shipping one here would be self-parody.
 */
import { describe, it, expect } from "vitest";
import { policy } from "@/lib/csp";

const NONCE = "dGVzdC1ub25jZQ==";

describe("content security policy", () => {
  it("never allows eval in production", () => {
    expect(policy(NONCE, false)).not.toContain("unsafe-eval");
  });

  it("allows eval in development, or nothing on localhost hydrates", () => {
    expect(policy(NONCE, true)).toContain("'unsafe-eval'");
  });

  it("differs from the development policy in that one respect only", () => {
    expect(policy(NONCE, true).replace(" 'unsafe-eval'", "")).toBe(policy(NONCE, false));
  });

  it("carries the nonce it was given, in script-src", () => {
    const scriptSrc = policy(NONCE, false).split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
  });

  it("keeps strict-dynamic, which is what makes the host allowlist irrelevant", () => {
    expect(policy(NONCE, false)).toContain("'strict-dynamic'");
  });

  it("holds the directives that do not depend on the environment", () => {
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ]) {
      expect(policy(NONCE, false)).toContain(directive);
      expect(policy(NONCE, true)).toContain(directive);
    }
  });
});
