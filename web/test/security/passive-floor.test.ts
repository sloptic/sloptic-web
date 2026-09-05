/** Passive by default, for everyone who has proved nothing.
 *
 *  CLAUDE.md: "An unverified target gets only observational probes. Active/injection probes NEVER
 *  run on an unverified target. This is legal safety, not a feature flag." The single-URL form is
 *  the anonymous tier, so the battery it enqueues must not be a function of anything the caller
 *  sends. These tests are about the submit path only, as the gate; where the URL may point is the
 *  egress sandbox's question, not this one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, read } from "../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});
// The queue's own gates are not what this file is about: let them pass and watch what gets written.
vi.mock("@/lib/ratelimit", () => ({
  allow: async () => true,
  clientIp: () => "203.0.113.9",
  hashIp: () => "hash-of-203.0.113.9",
}));
vi.mock("@/lib/egress", () => ({ egressPrecheck: async () => null }));

import { POST as submitGrade } from "@/app/api/grade/route";

const ALICE = { id: "u-alice", email: "alice@example.com" };
const YEAR_AWAY = "2099-01-01T00:00:00.000Z";

function store(): FakeSupabase {
  return fakeDb({
    store: {
      grades: [],
      // Alice has proved she controls this origin. That authorizes HER, and it is still not a
      // property of the origin: nothing about this row may change what a submission enqueues.
      grants: [
        {
          id: "gr1",
          account_id: ALICE.id,
          kind: "app_origin",
          scope: "https://alices-app.com",
          expires_at: YEAR_AWAY,
          revoked_at: null,
        },
      ],
    },
  });
}

beforeEach(() => {
  resetRouteMocks();
  setUser(null);
  setDb(store());
  process.env.GRADING_OPEN = "1";
});

afterEach(() => {
  delete process.env.GRADING_OPEN;
});

describe("POST /api/grade always enqueues the passive floor", () => {
  it("ignores a mode the caller asked for", async () => {
    const db = store();
    setDb(db);
    const res = await read(
      await submitGrade(
        jsonRequest("http://x/api/grade", { url: "https://someone-elses-app.com", mode: "active" })
      )
    );
    expect(res.status).toBe(202);
    expect(db.rows("grades")[0].mode).toBe("passive");
  });

  it("ignores any other field a body could carry", async () => {
    const db = store();
    setDb(db);
    await submitGrade(
      jsonRequest("http://x/api/grade", {
        url: "https://someone-elses-app.com",
        mode: "active",
        account_id: "u-victim",
        event_run_id: "run-1",
        status: "done",
      })
    );
    const row = db.rows("grades")[0];
    expect(row.mode).toBe("passive");
    expect(row.account_id).toBeNull();
    expect(row.event_run_id).toBeUndefined();
    expect(row.status).toBe("queued");
  });

  it("does not read a grant for the submitted origin at all", async () => {
    const db = store();
    setDb(db);
    await submitGrade(jsonRequest("http://x/api/grade", { url: "https://alices-app.com/dashboard" }));
    // "This origin is active-gradable" is not a question the system may ask, so the submit path has
    // no reason to look at the grants table.
    expect(db.calls.some((c) => c.table === "grants")).toBe(false);
    expect(db.rows("grades")[0].mode).toBe("passive");
  });

  it("stays passive for Mallory pointing at the origin Alice verified", async () => {
    const db = store();
    setDb(db);
    setUser({ id: "u-mallory", email: "mallory@example.com" });
    await submitGrade(jsonRequest("http://x/api/grade", { url: "https://alices-app.com", mode: "active" }));
    expect(db.rows("grades")[0].mode).toBe("passive");
  });

  it("stays passive for Alice herself: this route is the anonymous tier, not the owner tier", async () => {
    const db = store();
    setDb(db);
    setUser(ALICE);
    await submitGrade(jsonRequest("http://x/api/grade", { url: "https://alices-app.com", mode: "active" }));
    const row = db.rows("grades")[0];
    expect(row.mode).toBe("passive");
    // Attached to her account so it does not expire out from under her, which is a different thing
    // from authorizing anything.
    expect(row.account_id).toBe(ALICE.id);
  });

  it("normalizes the target to an origin and refuses what will not parse", async () => {
    const db = store();
    setDb(db);
    await submitGrade(jsonRequest("http://x/api/grade", { url: "https://Alices-App.com:8443/a/b?c=d#e" }));
    expect(db.rows("grades")[0].origin).toBe("https://alices-app.com:8443");

    for (const url of ["", "not a url", "javascript:alert(1)", "file:///etc/passwd", "http://localhost:3000", "https://app.internal"]) {
      const res = await read(await submitGrade(jsonRequest("http://x/api/grade", { url })));
      expect(res.status, `accepted ${JSON.stringify(url)}`).toBe(400);
    }
    expect(db.rows("grades")).toHaveLength(1);
  });
});
