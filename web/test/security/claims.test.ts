/** The organizer claim: issuing a token, and asking for it to be checked again.
 *
 *  A claim is the START of a proof, never the proof, so the properties that matter here are that it
 *  confers nothing on its own, that it is bound to the account that made it, and that one account's
 *  claim is invisible and untouchable from another's session. The verification itself belongs to the
 *  worker (it is the only side inside the egress sandbox and on the residential connection Devpost
 *  answers), so nothing in this repo may ever write `verified`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../helpers/supabase";
import {
  setDb,
  setUser,
  resetRouteMocks,
  jsonRequest,
  malformedRequest,
  read,
} from "../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser } = await import("../helpers/route");
  const { getDb } = await import("../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

import { POST as claim, GET as listClaims } from "@/app/api/events/claim/route";
import { POST as recheck } from "@/app/api/events/recheck/route";

const ALICE = { id: "u-alice", email: "alice@example.com" };
const MALLORY = { id: "u-mallory", email: "mallory@example.com" };

const CLAIM_DEFAULTS = {
  event_claims: { status: "pending", check_status: null, checked_at: null, verified_at: null },
};

/** Alice already holds a pending claim on her event, token published or not. */
function seeded(): FakeSupabase {
  return fakeDb({
    store: {
      event_claims: [
        {
          id: "claim-alice",
          account_id: ALICE.id,
          slug: "alices-hack",
          token: "alice-token",
          status: "pending",
          check_status: "blocked",
          check_detail: "403 from the WAF",
          check_due_at: "2026-01-01T00:00:00.000Z",
          checked_at: "2026-01-01T00:00:00.000Z",
          issued_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    defaults: CLAIM_DEFAULTS,
  });
}

describe("POST /api/events/claim", () => {
  beforeEach(() => {
    resetRouteMocks();
    setDb(seeded());
    setUser(ALICE);
  });

  it("refuses a signed-out caller, and issues nothing", async () => {
    const db = seeded();
    setDb(db);
    setUser(null);
    const res = await read(await claim(jsonRequest("http://x/api/events/claim", { event: "some-hack" })));
    expect(res.status).toBe(401);
    expect(db.rows("event_claims")).toHaveLength(1);
  });

  it("rejects a malformed body", async () => {
    const res = await read(await claim(malformedRequest("http://x/api/events/claim")));
    expect(res.status).toBe(400);
  });

  it("binds the claim to the session account, not to anything in the body", async () => {
    const db = seeded();
    setDb(db);
    const res = await read(
      await claim(
        jsonRequest("http://x/api/events/claim", {
          event: "other-hack",
          account_id: MALLORY.id,
          status: "verified",
          verified_at: "2026-01-01T00:00:00.000Z",
          token: "attacker-chosen",
        })
      )
    );
    expect(res.status).toBe(201);
    const row = db.rows("event_claims").find((r) => r.slug === "other-hack")!;
    expect(row.account_id).toBe(ALICE.id);
    expect(row.status).toBe("pending");
    expect(row.verified_at).toBeNull();
    expect(row.token).not.toBe("attacker-chosen");
  });

  it("never writes a verified claim: only the worker settles one", async () => {
    const db = seeded();
    setDb(db);
    await claim(jsonRequest("http://x/api/events/claim", { event: "other-hack" }));
    expect(db.rows("event_claims").every((r) => r.status !== "verified")).toBe(true);
  });

  it("issues an unguessable token, different on every claim", async () => {
    const db = seeded();
    setDb(db);
    const first = await read(await claim(jsonRequest("http://x/api/events/claim", { event: "one-hack" })));
    const second = await read(await claim(jsonRequest("http://x/api/events/claim", { event: "two-hack" })));
    const a = (first.body.claim as Record<string, string>).token;
    const b = (second.body.claim as Record<string, string>).token;
    expect(a).not.toBe(b);
    // 18 bytes of base64url. Long enough that the space cannot be walked looking for a token some
    // event has already published.
    for (const token of [a, b]) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    }
  });

  it("returns the existing claim rather than re-issuing, so a published link keeps working", async () => {
    const db = seeded();
    setDb(db);
    const res = await read(await claim(jsonRequest("http://x/api/events/claim", { event: "alices-hack" })));
    expect(res.body.existing).toBe(true);
    expect((res.body.claim as Record<string, string>).token).toBe("alice-token");
    expect(db.rows("event_claims")).toHaveLength(1);
  });

  it("gives Mallory her own token for Alice's event, and leaves Alice's claim alone", async () => {
    const db = seeded();
    setDb(db);
    setUser(MALLORY);
    const res = await read(await claim(jsonRequest("http://x/api/events/claim", { event: "alices-hack" })));
    expect(res.status).toBe(201);
    expect(res.body.existing).toBe(false);
    const issued = (res.body.claim as Record<string, string>).token;
    expect(issued).not.toBe("alice-token");
    const alices = db.rows("event_claims").find((r) => r.id === "claim-alice")!;
    expect(alices.token).toBe("alice-token");
    expect(alices.status).toBe("pending");
    // Two pending claims on one slug is the scheme working: only whoever can edit that event's own
    // Devpost pages will ever verify.
    expect(db.rows("event_claims").filter((r) => r.slug === "alices-hack")).toHaveLength(2);
  });

  it("refuses anything that is not a Devpost event address", async () => {
    for (const event of [
      "",
      "evil-devpost.com",
      "alices-hack.devpost.com.attacker.net",
      "https://devpost.com",
      "https://www.devpost.com",
      "https://evil.com/alices-hack",
      "../alices-hack",
      "alices hack",
      "alices-hack.devpost.com.",
      "sub.alices-hack.devpost.com",
    ]) {
      const res = await read(await claim(jsonRequest("http://x/api/events/claim", { event })));
      expect(res.status, `accepted ${JSON.stringify(event)}`).toBe(400);
    }
  });

  it("accepts the event's own address in the forms an organizer would paste", async () => {
    const db = seeded();
    setDb(db);
    for (const [event, slug] of [
      ["https://my-hack.devpost.com/", "my-hack"],
      ["my-hack2.devpost.com", "my-hack2"],
      ["MY-HACK3", "my-hack3"],
      ["https://my-hack4.devpost.com/rules?x=1#y", "my-hack4"],
    ] as const) {
      const res = await read(await claim(jsonRequest("http://x/api/events/claim", { event })));
      expect((res.body.claim as Record<string, string>).slug).toBe(slug);
    }
  });
});

describe("GET /api/events/claim", () => {
  beforeEach(() => {
    resetRouteMocks();
    setDb(seeded());
  });

  it("shows a signed-out caller nothing at all", async () => {
    setUser(null);
    const res = await read(await listClaims());
    expect(res.body.claims).toEqual([]);
  });

  it("shows only the caller's own claims, never another account's token", async () => {
    setUser(MALLORY);
    const res = await read(await listClaims());
    expect(res.body.claims).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain("alice-token");
  });

  it("hands back the last check's tri-state as it stands, blocked included", async () => {
    setUser(ALICE);
    const res = await read(await listClaims());
    const rows = res.body.claims as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    // Blocked means COULD NOT CHECK. Reporting it as a failed or absent claim is the one thing the
    // tri-state exists to prevent, so the claim must still be pending and still say blocked.
    expect(rows[0].check_status).toBe("blocked");
    expect(rows[0].status).toBe("pending");
  });
});

describe("POST /api/events/recheck", () => {
  beforeEach(() => {
    resetRouteMocks();
    setDb(seeded());
    setUser(ALICE);
  });

  it("refuses a signed-out caller", async () => {
    setUser(null);
    const res = await read(await recheck(jsonRequest("http://x/api/events/recheck", { id: "claim-alice" })));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const res = await read(await recheck(malformedRequest("http://x/api/events/recheck")));
    expect(res.status).toBe(400);
  });

  it("moves the caller's own pending claim forward", async () => {
    const db = seeded();
    setDb(db);
    const res = await read(await recheck(jsonRequest("http://x/api/events/recheck", { id: "claim-alice" })));
    expect(res.status).toBe(200);
    const row = db.rows("event_claims")[0];
    expect(String(row.check_due_at) > "2026-01-01T00:00:00.000Z").toBe(true);
    // A recheck asks the worker to look. It must not settle anything by itself.
    expect(row.status).toBe("pending");
    expect(row.check_status).toBe("blocked");
  });

  it("answers Mallory the way it answers a nonexistent id, and touches nothing", async () => {
    const db = seeded();
    setDb(db);
    setUser(MALLORY);
    const mine = await read(await recheck(jsonRequest("http://x/api/events/recheck", { id: "claim-alice" })));
    const absent = await read(
      await recheck(jsonRequest("http://x/api/events/recheck", { id: "00000000-0000-0000-0000-000000000000" }))
    );
    expect(mine.status).toBe(404);
    expect(mine.body).toEqual(absent.body);
    expect(db.rows("event_claims")[0].check_due_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("will not queue a check with a missing or empty id", async () => {
    for (const body of [{}, { id: "" }, { id: null }]) {
      const res = await read(await recheck(jsonRequest("http://x/api/events/recheck", body)));
      expect(res.status).toBe(404);
    }
  });

  it("will not re-open a settled claim", async () => {
    const db = fakeDb({
      store: {
        event_claims: [
          { id: "c1", account_id: ALICE.id, slug: "done-hack", token: "t", status: "verified", check_due_at: "2026-01-01T00:00:00.000Z" },
          { id: "c2", account_id: ALICE.id, slug: "gone-hack", token: "u", status: "revoked", check_due_at: "2026-01-01T00:00:00.000Z" },
        ],
      },
      defaults: CLAIM_DEFAULTS,
    });
    setDb(db);
    for (const id of ["c1", "c2"]) {
      const res = await read(await recheck(jsonRequest("http://x/api/events/recheck", { id })));
      expect(res.status).toBe(404);
    }
    expect(db.rows("event_claims").every((r) => r.check_due_at === "2026-01-01T00:00:00.000Z")).toBe(true);
  });
});
