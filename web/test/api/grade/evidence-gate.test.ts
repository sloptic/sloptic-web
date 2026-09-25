/** GET /api/grade/:id applies the evidence rule, and decides ownership the right way.
 *
 *  lib/evidence.ts decides WHAT a stranger may see. This decides WHO is a stranger, and that is the
 *  half with a trap in it: owning the REPORT is not owning the APP. Anyone can grade an app they do
 *  not own, so the account that submitted or claimed a report may be exactly the person the location
 *  of someone else's leaked key must be kept from. Only a live app_origin grant for the origin, held
 *  by the viewer, makes them an owner.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, getRequest, read } from "../../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

const { GET } = await import("@/app/api/grade/[id]/route");

const ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://victim.example";
const OWNER = { id: "acct-owner", email: "owner@victim.example" };
const STRANGER = { id: "acct-stranger", email: "stranger@example.com" };
const YEAR = "2099-01-01T00:00:00.000Z";

const SECRET = {
  probe_id: "sec-secrets-001",
  bundle: "security",
  category: "secrets-exposure",
  outcome: "slop_detected",
  penalty: 70,
  contribution: 70,
  reason: "a live key in /assets/index-abc123.js",
  target: "/assets/index-abc123.js",
  evidence: { repro: { method: "GET", url: `${ORIGIN}/assets/index-abc123.js` } },
};

let db: FakeSupabase;

function seed({ findings = [SECRET] as Record<string, unknown>[], account_id = null as string | null, grants = [] as Record<string, unknown>[] } = {}) {
  db = fakeDb({
    store: {
      grades: [{
        id: ID, origin: ORIGIN, submitted_url: ORIGIN, mode: "passive", status: "done",
        submitted_at: "2026-09-25T00:00:00.000Z", finished_at: "2026-09-25T00:05:00.000Z",
        error: null, account_id, event_run_id: null,
      }],
      results: [{
        grade_id: ID, mode: "passive", slop_score: 70, axis_slop: { security: 70 }, coverage: {},
        findings, outcomes: findings, card: {}, ranking: null,
        ruler: { full: "2026.4", passive: "passive-2026.2" },
      }],
      grants,
      worker_status: [], event_runs: [], domain_claims: [],
    },
  });
  setDb(db);
}

const grant = (account_id: string, over: Record<string, unknown> = {}) => ({
  account_id, kind: "app_origin", scope: ORIGIN, revoked_at: null, expires_at: YEAR, ...over,
});

async function report() {
  const { body } = await read(await GET(getRequest(`http://localhost/api/grade/${ID}`), { params: { id: ID } }));
  const findings = ((body.result as { findings: Record<string, unknown>[] }).findings) ?? [];
  return { body, secret: findings.find((f) => f.probe_id === "sec-secrets-001")! };
}

beforeEach(() => setUser(null));
afterEach(() => resetRouteMocks());

describe("GET /api/grade/:id, the evidence rule", () => {
  it("withholds the location from an anonymous link holder", async () => {
    seed();
    const { body, secret } = await report();
    expect(body.evidence_withheld).toBe(true);
    expect(secret.target).toBeUndefined();
    expect(secret.evidence).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("index-abc123");
  });

  it("shows everything to a viewer holding a live ownership grant for the origin", async () => {
    seed({ grants: [grant(OWNER.id)] });
    setUser(OWNER);
    const { body, secret } = await report();
    expect(body.evidence_withheld).toBe(false);
    expect(secret.target).toBe("/assets/index-abc123.js");
    expect(secret.evidence).toBeDefined();
  });

  it("withholds it from the account that OWNS THE REPORT but not the app", async () => {
    // The trap. A stranger grades someone else's app and claims the report into their account. The
    // report is theirs; the key's location is not.
    seed({ account_id: STRANGER.id });
    setUser(STRANGER);
    const { body, secret } = await report();
    expect(body.mine).toBe(true);
    expect(body.evidence_withheld).toBe(true);
    expect(secret.target).toBeUndefined();
  });

  it("withholds it from a signed in viewer whose grant is for another account", async () => {
    seed({ grants: [grant(OWNER.id)] });
    setUser(STRANGER);
    expect((await report()).body.evidence_withheld).toBe(true);
  });

  it("does not accept an expired or revoked grant", async () => {
    for (const g of [grant(OWNER.id, { expires_at: "2020-01-01T00:00:00.000Z" }),
                     grant(OWNER.id, { revoked_at: "2026-09-01T00:00:00.000Z" })]) {
      seed({ grants: [g] });
      setUser(OWNER);
      expect((await report()).body.evidence_withheld).toBe(true);
    }
  });

  it("does not accept a grant for a different origin, however close", async () => {
    seed({ grants: [grant(OWNER.id, { scope: "https://victim.example.evil.com" })] });
    setUser(OWNER);
    expect((await report()).body.evidence_withheld).toBe(true);
  });

  it("fails CLOSED when the grant cannot be read", async () => {
    // An owner who hits a blip reloads. The alternative is a stranger who reloads until one happens.
    seed({ grants: [grant(OWNER.id)] });
    setUser(OWNER);
    db.failures.push({ table: "grants", error: { code: "57014", message: "statement timeout" } });
    expect((await report()).body.evidence_withheld).toBe(true);
  });

  it("asks nothing when there is nothing to withhold", async () => {
    // An ordinary report costs no extra lookup.
    seed({ findings: [{ ...SECRET, probe_id: "sec-headers-002", category: "security-headers" }] });
    const { body } = await report();
    expect(body.evidence_withheld).toBe(false);
    expect(db.calls.filter((c) => c.table === "grants")).toEqual([]);
  });
});
