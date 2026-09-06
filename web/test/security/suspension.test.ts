/** Suspending one account, which is the response that did not exist.
 *
 *  The controls before this were GRADING_OPEN=0, which stops everybody in order to stop one, and a
 *  per-IP rate limit, which a signed-in abuser changes for free. So these pin the two properties
 *  that make suspension useful: it reaches every route that spends our outbound traffic, and it
 *  reaches only the suspended account.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeDb } from "../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, read, getDb } from "../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser } = await import("../helpers/route");
  const { getDb } = await import("../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});
vi.mock("@/lib/egress", () => ({ egressPrecheck: async () => null }));
vi.mock("@/lib/flags", async (orig) => ({
  ...(await orig<typeof import("@/lib/flags")>()),
  gradingOpen: () => true,
}));

import { POST as submit } from "@/app/api/grade/route";
import { POST as claimDomain } from "@/app/api/verify/claim/route";
import { POST as recheck } from "@/app/api/verify/recheck/route";
import { SUSPENDED_FALLBACK } from "@/lib/suspension";

const ALICE = { id: "u-alice", email: "alice@example.com" };
const MALLORY = { id: "u-mallory", email: "mallory@example.com" };

function db(suspended: Record<string, unknown> = {}) {
  return fakeDb({
    store: {
      profiles: [
        { id: ALICE.id, email: ALICE.email, suspended_at: null, suspended_reason: null },
        { id: MALLORY.id, email: MALLORY.email, suspended_at: null, suspended_reason: null,
          ...suspended },
      ],
      grades: [],
      domain_claims: [],
      grants: [],
      rate_limits: [],
    },
  });
}

const SUSPENDED = { suspended_at: "2026-09-06T00:00:00.000Z" };

beforeEach(() => {
  resetRouteMocks();
  setUser(ALICE);
  setDb(db());
});

const gradeReq = () => jsonRequest("http://localhost/api/grade", { url: "https://example.com" });
const claimReq = () =>
  jsonRequest("http://localhost/api/verify/claim", { url: "https://example.com", attest: true });

describe("a suspended account cannot spend our outbound traffic", () => {
  beforeEach(() => {
    setUser(MALLORY);
    setDb(db(SUSPENDED));
  });

  it("cannot start a grade", async () => {
    const res = await submit(gradeReq());
    expect(res.status).toBe(403);
    expect(getDb().store.grades).toHaveLength(0);
  });

  it("cannot claim a domain, which is what makes the worker fetch a host it chose", async () => {
    const res = await claimDomain(claimReq());
    expect(res.status).toBe(403);
    expect(getDb().store.domain_claims).toHaveLength(0);
  });

  it("cannot force a re-check", async () => {
    expect((await recheck(jsonRequest("http://localhost/api/verify/recheck", { id: "x" }))).status)
      .toBe(403);
  });

  it("is told why, in a sentence addressed to a person", async () => {
    const body = (await read(await submit(gradeReq()))).body;
    expect(body.error).toBe(SUSPENDED_FALLBACK);
  });

  it("is given the reason we recorded when there is one", async () => {
    setDb(db({ ...SUSPENDED, suspended_reason: "Repeatedly grading sites you do not own." }));
    const body = (await read(await submit(gradeReq()))).body;
    expect(body.error).toBe("Repeatedly grading sites you do not own.");
  });
});

describe("it reaches only the suspended account", () => {
  it("leaves everyone else grading", async () => {
    setUser(ALICE);
    setDb(db(SUSPENDED));

    expect((await submit(gradeReq())).status).not.toBe(403);
  });

  it("does not touch anonymous submitters, who have no account to suspend", async () => {
    setUser(null);
    setDb(db(SUSPENDED));

    expect((await submit(gradeReq())).status).not.toBe(403);
  });
});

describe("it fails open", () => {
  it("lets an account through when the lookup itself fails", async () => {
    // Deliberately the opposite of the rate limit, which refuses when it cannot decide. That limit
    // is the only thing between an anonymous caller and the worker. This sits behind it and behind
    // every other gate, so a database blip here must not lock out every honest account at once.
    const broken = db();
    broken.failures.push({
      table: "profiles",
      error: { code: "08006", message: "connection reset" } as never,
    });
    setDb(broken);

    expect((await submit(gradeReq())).status).not.toBe(403);
  });
});
