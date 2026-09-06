/** /auth/confirm: redeeming an emailed sign-in link.
 *
 *  This route exists so the link in the mail is on sloptic.org rather than the Supabase API host,
 *  which makes it the front door and worth testing like one. The questions are whether a bad link
 *  can do anything, whether a good one signs you in and stamps the terms, and whether `next` can be
 *  used to bounce someone off the site.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeDb } from "../../helpers/supabase";
import { setDb, resetRouteMocks, getRequest, getDb } from "../../helpers/route";

const verifyOtp = vi.fn();

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", () => ({
  supabaseSession: () => ({ auth: { verifyOtp } }),
}));

import { GET as confirm } from "@/app/auth/confirm/route";

const USER = { id: "u-alice", email: "alice@example.com" };
const LINK = "http://localhost/auth/confirm?token_hash=abc123&type=magiclink";

function location(res: Response): string {
  return res.headers.get("location") ?? "";
}

beforeEach(() => {
  resetRouteMocks();
  verifyOtp.mockReset();
  verifyOtp.mockResolvedValue({ data: { user: USER }, error: null });
  setDb(fakeDb({ store: { profiles: [] } }));
});

describe("a link that cannot be redeemed", () => {
  it("refuses one with no token hash, without calling verifyOtp", async () => {
    const res = await confirm(getRequest("http://localhost/auth/confirm?type=magiclink"));

    expect(location(res)).toContain("/signin?error=missing_code");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("refuses a type we did not put in a link", async () => {
    // The type reaches verifyOtp off the query string, so it is checked against the known set
    // rather than cast through.
    const res = await confirm(getRequest("http://localhost/auth/confirm?token_hash=abc&type=sudo"));

    expect(location(res)).toContain("/signin?error=missing_code");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("sends an expired or spent link back to sign-in rather than to an error page", async () => {
    // The common case, not an attack: the mail says it works once and lasts an hour, and people
    // find both edges. Sign-in is where another link can be asked for.
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });

    expect(location(await confirm(getRequest(LINK)))).toContain("/signin?error=exchange_failed");
  });

  it("writes no profile row for a link that failed", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });

    await confirm(getRequest(LINK));

    expect(getDb().store.profiles).toHaveLength(0);
  });
});

describe("a link that redeems", () => {
  it("verifies the token hash it was given", async () => {
    await confirm(getRequest(LINK));

    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "abc123" });
  });

  it("mirrors the account and stamps the terms on first sign-in", async () => {
    // terms_accepted_at is what verify_domain_claim checks before writing a grant, so a sign-in
    // path that skipped it would leave those accounts unable to verify a domain, and the failure
    // would surface days later in the worker.
    await confirm(getRequest(LINK));

    const row = getDb().store.profiles[0] as Record<string, unknown>;
    expect(row.id).toBe(USER.id);
    expect(row.terms_accepted_at).toBeTruthy();
  });

  it("does not re-date an account that accepted earlier", async () => {
    const first = "2026-01-01T00:00:00.000Z";
    setDb(fakeDb({
      store: { profiles: [{ id: USER.id, email: USER.email, terms_accepted_at: first }] },
    }));

    await confirm(getRequest(LINK));

    expect((getDb().store.profiles[0] as Record<string, unknown>).terms_accepted_at).toBe(first);
  });

  it("returns the visitor to where they were signing in from", async () => {
    expect(location(await confirm(getRequest(`${LINK}&next=%2Fverify`)))).toBe("http://localhost/verify");
  });

  it("lands on the home page when no destination was carried", async () => {
    expect(location(await confirm(getRequest(LINK)))).toBe("http://localhost/");
  });
});

describe("next cannot carry anyone off the site", () => {
  // safeNext parses rather than prefix-checks, because a browser deletes tab and CR from a URL
  // before parsing it, so "/<tab>/evil.com" passes "starts with one slash and not two".
  const hostile: ReadonlyArray<readonly [string, string]> = [
    ["an absolute url", "https://evil.example/"],
    ["a protocol-relative url", "//evil.example/"],
    ["a backslash form", "/\\evil.example/"],
    ["a tab inside the path", "/\t/evil.example/"],
  ];

  for (const [name, raw] of hostile) {
    it(`refuses ${name}`, async () => {
      const res = await confirm(getRequest(`${LINK}&next=${encodeURIComponent(raw)}`));

      expect(location(res)).toBe("http://localhost/");
    });
  }
});
