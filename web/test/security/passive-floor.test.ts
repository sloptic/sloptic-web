/** Passive by default, for everyone who has proved nothing.
 *
 *  CLAUDE.md: "An unverified target gets only observational probes. Active/injection probes NEVER
 *  run on an unverified target. This is legal safety, not a feature flag."
 *
 *  This file used to assert that the route ALWAYS wrote passive, which was true while owner
 *  verification did not exist and the grant it issues could not be spent anywhere. The rule was
 *  never "the caller cannot ask", though: it is "the caller cannot decide". So the battery is now a
 *  function of a grant the SERVER reads, and these tests say that, which is a stronger claim than
 *  the one they replaced. A body is still just a request; what makes it active is the account
 *  having proved it owns the origin.
 *
 *  These are about the submit path as the gate. Where the URL may point is the egress sandbox's
 *  question, and whether the proofs still hold at grade time is the worker's.
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
const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 60 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();
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

describe("POST /api/grade enqueues the passive floor unless the account owns the origin", () => {
  it("refuses an anonymous caller who asks for the full battery", async () => {
    // Refused, not quietly downgraded: someone who asked for the full battery and silently got the
    // passive floor would read the result as the whole story.
    const db = store();
    setDb(db);
    const res = await read(
      await submitGrade(
        jsonRequest("http://x/api/grade", { url: "https://someone-elses-app.com", mode: "active" })
      )
    );
    expect(res.status).toBe(401);
    expect(db.rows("grades")).toHaveLength(0);
  });

  it("enqueues the passive floor when no mode is asked for", async () => {
    const db = store();
    setDb(db);
    const res = await read(
      await submitGrade(jsonRequest("http://x/api/grade", { url: "https://someone-elses-app.com" }))
    );
    expect(res.status).toBe(202);
    expect(db.rows("grades")[0].mode).toBe("passive");
  });

  it("ignores any other field a body could carry", async () => {
    const db = store();
    setDb(db);
    setUser(ALICE);
    await submitGrade(
      jsonRequest("http://x/api/grade", {
        url: "https://someone-elses-app.com",
        account_id: "u-victim",
        event_run_id: "run-1",
        status: "done",
      })
    );
    const row = db.rows("grades")[0];
    expect(row.mode).toBe("passive");
    // Her own account, from the session, never the body's claim about whose it is.
    expect(row.account_id).toBe(ALICE.id);
    expect(row.event_run_id).toBeUndefined();
    expect(row.status).toBe("queued");
  });

  it("does not read a grant when nobody asked for the full battery", async () => {
    const db = store();
    setDb(db);
    setUser(ALICE);
    await submitGrade(jsonRequest("http://x/api/grade", { url: "https://alices-app.com/dashboard" }));
    // An ordinary submission is the anonymous tier whoever sends it, so there is no question to ask
    // of the grants table and no way for the answer to matter.
    expect(db.calls.some((c) => c.table === "grants")).toBe(false);
    expect(db.rows("grades")[0].mode).toBe("passive");
  });

  it("refuses Mallory the full battery on the origin ALICE verified", async () => {
    // The load-bearing rule, and the reason the grant is account-bound rather than origin-bound:
    // "this account may actively grade this origin", never "this origin is active-gradable".
    // store() already seeds Alice's live grant for this origin, which is the whole point here.
    const db = store();
    setDb(db);
    setUser({ id: "u-mallory", email: "mallory@example.com" });
    const res = await read(
      await submitGrade(jsonRequest("http://x/api/grade", { url: "https://alices-app.com", mode: "active" }))
    );
    expect(res.status).toBe(403);
    expect(db.rows("grades")).toHaveLength(0);
  });

  it("gives Alice the full battery on the origin she verified", async () => {
    const db = store();
    setDb(db);
    setUser(ALICE);
    const res = await read(
      await submitGrade(jsonRequest("http://x/api/grade", { url: "https://alices-app.com", mode: "active" }))
    );
    expect(res.status).toBe(202);
    expect(db.rows("grades")[0].mode).toBe("active");
    expect(db.rows("grades")[0].account_id).toBe(ALICE.id);
  });

  it("refuses Alice on a grant that has expired or been revoked", async () => {
    for (const lapsed of [{ expires_at: PAST, revoked_at: null }, { expires_at: FUTURE, revoked_at: NOW }]) {
      const db = store();
      setDb(db);
      // Replace the seeded live grant rather than adding beside it: two live grants for one scope
      // cannot exist (0007's unique index), and the lookup would fail closed on them anyway.
      db.rows("grants").length = 0;
      db.rows("grants").push({
        account_id: ALICE.id, kind: "app_origin", scope: "https://alices-app.com", ...lapsed,
      });
      setUser(ALICE);
      const res = await read(
        await submitGrade(jsonRequest("http://x/api/grade", { url: "https://alices-app.com", mode: "active" }))
      );
      expect(res.status).toBe(403);
      expect(db.rows("grades")).toHaveLength(0);
    }
  });

  it("refuses a grant for a DIFFERENT origin, however close", async () => {
    // The grant authorizes a scheme, host and port, so a sibling host or another port is somebody
    // else's server as far as this is concerned.
    for (const other of ["https://sub.alices-app.com", "https://alices-app.com:8443", "http://alices-app.com"]) {
      const db = store();
      setDb(db);
      setUser(ALICE);
      const res = await read(await submitGrade(jsonRequest("http://x/api/grade", { url: other, mode: "active" })));
      expect(res.status, other).toBe(403);
    }
  });

  it("does not let an ORGANIZER grant stand in for owning the origin", async () => {
    const db = store();
    setDb(db);
    db.rows("grants").length = 0;
    db.rows("grants").push({
      account_id: ALICE.id, kind: "organizer_event", scope: "https://alices-app.com",
      revoked_at: null, expires_at: FUTURE,
    });
    setUser(ALICE);
    const res = await read(
      await submitGrade(jsonRequest("http://x/api/grade", { url: "https://alices-app.com", mode: "active" }))
    );
    expect(res.status).toBe(403);
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
