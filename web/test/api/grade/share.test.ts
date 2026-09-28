/** POST /api/grade/:id/share and the share lookup behind /s/<token>.
 *
 *  The report URL is a capability: read access to every finding and, while no account has claimed
 *  the grade, the right to delete it. So a share must be a DIFFERENT capability that grants only the
 *  summary. These pin that: the token is random and unrelated to the report id, looking it up returns
 *  the summary and never a finding, a report has one share link however often it is asked for, and
 *  the verified-owner mark belongs to the REPORT's account, not to whoever happens to be viewing.
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

const { POST } = await import("@/app/api/grade/[id]/share/route");
const { loadShare, SHARE_TOKEN } = await import("@/lib/share-server");

const ID = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://myapp.dev";
const OWNER = "acct-owner";
const YEAR = "2099-01-01T00:00:00.000Z";

const SECRET = {
  probe_id: "sec-secrets-001", bundle: "security", category: "secrets-exposure", penalty: 70,
  reason: "a live key in /assets/index-abc123.js", target: "/assets/index-abc123.js",
};

let db: FakeSupabase;

function seed({
  grade = {} as Record<string, unknown>,
  result = {} as Record<string, unknown> | null,
  grants = [] as Record<string, unknown>[],
} = {}) {
  db = fakeDb({
    store: {
      grades: [{
        id: ID, origin: ORIGIN, submitted_url: ORIGIN, status: "done", retry_due_at: null,
        account_id: null, share_token: null, ...grade,
      }],
      results: result === null ? [] : [{
        grade_id: ID, mode: "passive", slop_score: 12.4, axis_slop: { security: 8, accessibility: 4.4 },
        ruler: { full: "2026.4", passive: "passive-2026.2" }, ranking: { cleaner_than_pct: 91 },
        coverage: { probes_total: 45 }, blocked_probes: [], bot_challenge: false, challenge_stage: null,
        findings: [SECRET], outcomes: [SECRET], card: { entries: [SECRET] },
        ...result,
      }],
      grants,
    },
    uniques: [{ table: "grades", columns: ["share_token"], where: (r) => r.share_token !== null }],
  });
  setDb(db);
}

async function share(id = ID) {
  return read(await POST(getRequest(`http://localhost/api/grade/${id}/share`), { params: { id } }));
}

beforeEach(() => setUser(null));
afterEach(() => resetRouteMocks());

describe("POST /api/grade/:id/share", () => {
  it("mints a random share token, unrelated to the report id", async () => {
    seed();
    const { status, body } = await share();
    expect(status).toBe(200);
    const token = body.token as string;
    expect(token).toMatch(SHARE_TOKEN);
    expect(body.url).toBe(`http://localhost/s/${token}`);
    expect(JSON.stringify(body)).not.toContain(ID);
    expect(db.store.grades[0].share_token).toBe(token);
  });

  it("hands back the same link every time, so a posted link keeps working", async () => {
    seed();
    const first = (await share()).body.token;
    const second = (await share()).body.token;
    expect(second).toBe(first);
  });

  it("refuses a report with no honest score to share", async () => {
    // withheld by a bot challenge: nothing ran
    seed({ result: { slop_score: 0, coverage: {}, blocked_probes: ["sec-headers-001"] } });
    expect((await share()).status).toBe(409);
    // from before 3.0
    seed({ result: { ruler: null } });
    expect((await share()).status).toBe(409);
    // expired: the anonymous report's result is gone
    seed({ result: null });
    expect((await share()).status).toBe(409);
    // not finished
    seed({ grade: { status: "running" } });
    expect((await share()).status).toBe(409);
    expect(db.store.grades[0].share_token).toBeNull();
  });

  it("answers a malformed or unknown id with the same 404", async () => {
    seed();
    expect((await share("not-a-uuid")).status).toBe(404);
    expect((await share("33333333-3333-4333-8333-333333333333")).status).toBe(404);
  });
});

describe("the share lookup behind /s/<token>", () => {
  it("returns the summary and never a finding", async () => {
    seed();
    const token = (await share()).body.token as string;
    const found = await loadShare({ token });
    expect(found.ok).toBe(true);
    const text = JSON.stringify(found.ok ? found.share?.card : null);
    expect(text).toContain("myapp.dev");
    expect(text).not.toContain("index-abc123");
    expect(text).not.toContain("sec-secrets-001");
  });

  it("finds nothing for a token no grade carries", async () => {
    seed();
    const found = await loadShare({ token: "A".repeat(22) });
    expect(found).toEqual({ ok: true, share: null });
  });

  it("marks the verified owner only when the REPORT's account holds a live grant", async () => {
    const grant = { account_id: OWNER, kind: "app_origin", scope: ORIGIN, revoked_at: null, expires_at: YEAR };
    seed({ grade: { account_id: OWNER }, grants: [grant] });
    const owned = await loadShare({ id: ID });
    expect(owned.ok && owned.share?.card?.verifiedOwner).toBe(true);

    // an anonymous report, even with the owner viewing it
    seed({ grants: [grant] });
    setUser({ id: OWNER, email: "owner@myapp.dev" });
    const anon = await loadShare({ id: ID });
    expect(anon.ok && anon.share?.card?.verifiedOwner).toBe(false);

    // a revoked or expired grant is no mark
    seed({ grade: { account_id: OWNER }, grants: [{ ...grant, revoked_at: "2026-09-01T00:00:00Z" }] });
    const revoked = await loadShare({ id: ID });
    expect(revoked.ok && revoked.share?.card?.verifiedOwner).toBe(false);
    seed({ grade: { account_id: OWNER }, grants: [{ ...grant, expires_at: "2020-01-01T00:00:00Z" }] });
    const expired = await loadShare({ id: ID });
    expect(expired.ok && expired.share?.card?.verifiedOwner).toBe(false);
  });

  it("goes with the grade: a deleted report's link finds nothing", async () => {
    seed();
    const token = (await share()).body.token as string;
    db.store.grades = [];
    db.store.results = [];
    expect(await loadShare({ token })).toEqual({ ok: true, share: null });
  });
});
