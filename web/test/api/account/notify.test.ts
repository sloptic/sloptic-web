/** The one mail preference, and who may change it.
 *
 *  It writes to `profiles`, which the service role reaches with RLS bypassed, so the only thing
 *  standing between one account and another's row is this route.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeDb } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, read, getDb } from "../../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser } = await import("../../helpers/route");
  const { getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

import { POST as notify } from "@/app/api/account/notify/route";

const ALICE = { id: "u-alice", email: "alice@example.com" };
const MALLORY = { id: "u-mallory", email: "mallory@example.com" };

const req = (body: unknown) => jsonRequest("http://localhost/api/account/notify", body);
const rowFor = (id: string) =>
  getDb().store.profiles.find((p) => p.id === id) as Record<string, unknown>;

beforeEach(() => {
  resetRouteMocks();
  setUser(ALICE);
  setDb(fakeDb({
    store: {
      profiles: [
        { id: ALICE.id, email: ALICE.email, notify_email: true },
        { id: MALLORY.id, email: MALLORY.email, notify_email: true },
      ],
    },
  }));
});

describe("changing the preference", () => {
  it("turns it off", async () => {
    const res = await notify(req({ on: false }));

    expect(res.status).toBe(200);
    expect(rowFor(ALICE.id).notify_email).toBe(false);
  });

  it("turns it back on", async () => {
    await notify(req({ on: false }));
    await notify(req({ on: true }));

    expect(rowFor(ALICE.id).notify_email).toBe(true);
  });

  it("reports the value it stored", async () => {
    expect((await read(await notify(req({ on: false })))).body.notify_email).toBe(false);
  });
});

describe("it changes only the caller's own row", () => {
  it("refuses an anonymous caller", async () => {
    setUser(null);
    expect((await notify(req({ on: false }))).status).toBe(401);
  });

  it("leaves every other account alone", async () => {
    await notify(req({ on: false }));

    expect(rowFor(MALLORY.id).notify_email).toBe(true);
  });

  it("takes no account id from the caller", async () => {
    // The id comes from the verified session and nowhere else, so a body naming someone else is
    // simply ignored rather than obeyed.
    await notify(req({ on: false, id: MALLORY.id, account_id: MALLORY.id }));

    expect(rowFor(MALLORY.id).notify_email).toBe(true);
    expect(rowFor(ALICE.id).notify_email).toBe(false);
  });
});

describe("it refuses anything that is not a yes or a no", () => {
  it("rejects a missing value", async () => {
    expect((await notify(req({}))).status).toBe(400);
  });

  it("rejects a truthy string, which would otherwise store the string", async () => {
    expect((await notify(req({ on: "yes" }))).status).toBe(400);
    expect(rowFor(ALICE.id).notify_email).toBe(true);
  });

  it("rejects a malformed body", async () => {
    const bad = new Request("http://localhost/api/account/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect((await notify(bad as never)).status).toBe(400);
  });
});
