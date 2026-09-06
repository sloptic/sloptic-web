/** The owner-verification routes: who may act on a claim, and what a caller can make the worker do.
 *
 *  A domain claim is a standing instruction to the worker to connect to an origin the caller chose,
 *  on any port, from a residential line. So the questions here are the two the routes had no answer
 *  for: whether one account can reach another's claim, and whether one account can point that
 *  traffic wherever it likes as often as it likes. Verification itself belongs to the worker, which
 *  is the side inside the egress sandbox, so nothing here may ever write `verified`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../helpers/supabase";
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

import { POST as claim } from "@/app/api/verify/claim/route";
import { POST as recheck } from "@/app/api/verify/recheck/route";
import { POST as revoke } from "@/app/api/verify/revoke/route";
import { MAX_LIVE_CLAIMS } from "@/lib/ratelimit";

const ALICE = { id: "u-alice", email: "alice@example.com" };
const MALLORY = { id: "u-mallory", email: "mallory@example.com" };

function claimRow(over: Record<string, unknown> = {}) {
  return {
    id: "claim-alice",
    account_id: ALICE.id,
    origin: "https://alice.example",
    host: "alice.example",
    token: "sloptic-alice",
    status: "pending",
    file_status: null,
    dns_status: null,
    detail: null,
    checked_at: null,
    verified_at: null,
    check_due_at: "2026-01-01T00:00:00.000Z",
    issued_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function seeded(extra: Record<string, unknown[]> = {}): FakeSupabase {
  return fakeDb({ store: { domain_claims: [claimRow()], grants: [], grades: [], ...extra } });
}

beforeEach(() => {
  resetRouteMocks();
  setUser(ALICE);
  setDb(seeded());
});

const claimReq = (url = "https://alice.example") =>
  jsonRequest("http://localhost/api/verify/claim", { url, attest: true });

describe("a claim is bound to the account that made it", () => {
  it("refuses an anonymous caller", async () => {
    setUser(null);
    expect((await claim(claimReq())).status).toBe(401);
  });

  it("will not re-check another account's claim, and does not confirm it exists", async () => {
    setUser(MALLORY);
    const res = await recheck(jsonRequest("http://localhost/api/verify/recheck", { id: "claim-alice" }));
    expect(res.status).toBe(404);
    const row = getDbRow();
    expect(row.check_due_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("will not revoke another account's claim", async () => {
    setUser(MALLORY);
    const res = await revoke(jsonRequest("http://localhost/api/verify/revoke", { id: "claim-alice" }));
    expect(res.status).toBe(404);
    expect(getDbRow().status).toBe("pending");
  });
});

describe("a caller cannot aim the worker wherever it likes, as often as it likes", () => {
  it("stops issuing claims once the window quota is spent", async () => {
    setDb(fakeDb({ store: { domain_claims: [], grants: [], grades: [] } }));
    let refusedAt = 0;
    for (let i = 1; i <= 40; i++) {
      const res = await claim(claimReq(`https://host${i}.example`));
      if (res.status === 429) { refusedAt = i; break; }
    }
    expect(refusedAt).toBeGreaterThan(0);
    expect(refusedAt).toBeLessThanOrEqual(21);
  });

  it("stops re-checks once the window quota is spent", async () => {
    let refusedAt = 0;
    for (let i = 1; i <= 40; i++) {
      const res = await recheck(jsonRequest("http://localhost/api/verify/recheck", { id: "claim-alice" }));
      if (res.status === 429) { refusedAt = i; break; }
    }
    expect(refusedAt).toBeGreaterThan(0);
  });

  it("caps how many claims may stand at once, since each one is ongoing traffic", async () => {
    const many = Array.from({ length: MAX_LIVE_CLAIMS }, (_, i) =>
      claimRow({ id: `c-${i}`, origin: `https://held${i}.example`, host: `held${i}.example` }));
    setDb(fakeDb({ store: { domain_claims: many, grants: [], grades: [] } }));

    const res = await claim(claimReq("https://onemore.example"));

    expect(res.status).toBe(429);
    expect((await read(res)).body.error).toContain(String(MAX_LIVE_CLAIMS));
  });

  it("re-claiming an origin already held does not count against the cap", async () => {
    const many = Array.from({ length: MAX_LIVE_CLAIMS }, (_, i) =>
      claimRow({ id: `c-${i}`, origin: `https://held${i}.example`, host: `held${i}.example` }));
    setDb(fakeDb({ store: { domain_claims: many, grants: [], grades: [] } }));

    const res = await claim(claimReq("https://held0.example"));

    expect(res.status).toBe(200);
    expect((await read(res)).body.existing).toBe(true);
  });
});

describe("revoking reaches the traffic that is already booked", () => {
  const withRetry = () =>
    fakeDb({
      store: {
        domain_claims: [claimRow({ status: "verified" })],
        grants: [{ id: "g1", account_id: ALICE.id, kind: "app_origin", scope: "https://alice.example",
                   expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null }],
        grades: [
          { id: "gr-1", account_id: ALICE.id, origin: "https://alice.example",
            retry_due_at: "2026-01-01T00:00:00.000Z", mode: "active", status: "done" },
          { id: "gr-other", account_id: ALICE.id, origin: "https://elsewhere.example",
            retry_due_at: "2026-01-01T00:00:00.000Z", mode: "active", status: "done" },
          { id: "gr-mallory", account_id: MALLORY.id, origin: "https://alice.example",
            retry_due_at: "2026-01-01T00:00:00.000Z", mode: "active", status: "done" },
        ],
      },
    });

  it("cancels a booked retry pass on the revoked origin", async () => {
    const db = withRetry();
    setDb(db);

    await revoke(jsonRequest("http://localhost/api/verify/revoke", { id: "claim-alice" }));

    const grade = db.store.grades.find((g) => g.id === "gr-1");
    expect(grade?.retry_due_at).toBeNull();
  });

  it("leaves this account's other origins and other accounts alone", async () => {
    const db = withRetry();
    setDb(db);

    await revoke(jsonRequest("http://localhost/api/verify/revoke", { id: "claim-alice" }));

    expect(db.store.grades.find((g) => g.id === "gr-other")?.retry_due_at).not.toBeNull();
    expect(db.store.grades.find((g) => g.id === "gr-mallory")?.retry_due_at).not.toBeNull();
  });
});

function getDbRow(): Record<string, unknown> {
  return getDb().store.domain_claims[0] as Record<string, unknown>;
}
