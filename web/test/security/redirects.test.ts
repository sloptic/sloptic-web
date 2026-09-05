/** The sign-in redirect surface: /signin's `next`, /auth/callback, /auth/signout.
 *
 *  What is being asserted is a browser-level property, not a string shape: whatever we hand a
 *  browser as a destination must resolve back to OUR origin. So every case below is checked through
 *  `browserResolves`, which models what a browser actually does with a Location value (strip tab,
 *  newline and carriage return, then resolve against the current page). A guard written as
 *  "startsWith('/') and not '//'" passes a naive string test and still sends the visitor to
 *  evil.com once the browser has stripped a tab, which is the bug class this file exists for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "../helpers/supabase";
import { setDb, resetRouteMocks, getRequest, read } from "../helpers/route";

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    nav.to.push(url);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  exchange: {
    data: { user: { id: "u-alice", email: "alice@example.com" } as { id: string; email: string } | null },
    error: null as { message: string } | null,
  },
  signOuts: 0,
}));
vi.mock("@/lib/auth", () => ({
  currentUser: async () => session.user,
  publicSupabaseConfig: () => ({ url: "https://db.example.com", key: "anon-key" }),
  supabaseSession: () => ({
    auth: {
      exchangeCodeForSession: async () => session.exchange,
      signOut: async () => {
        session.signOuts += 1;
        return { error: null };
      },
    },
  }),
}));
vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../helpers/route");
  return { supabaseAdmin: () => getDb() };
});

import SignInPage from "@/app/signin/page";
import { GET as callback } from "@/app/auth/callback/route";
import * as signout from "@/app/auth/signout/route";

const SITE = "https://sloptic.org";

/** What a browser makes of a Location value. Tabs, newlines and carriage returns are removed by the
 *  URL parser before anything else, so they cannot be relied on to keep a path a path. */
function browserResolves(location: string): URL {
  return new URL(location.replace(/[\t\n\r]/g, ""), SITE);
}

/** Every off-site destination that has ever been dressed up as a path. */
const HOSTILE = [
  "//evil.com",
  "/\\evil.com",
  "https://evil.com",
  "http://evil.com",
  "/\\/evil.com",
  "//\\evil.com",
  "/%2f%2fevil.com",
  "%2f%2fevil.com",
  "/\t/evil.com",
  "/\n//evil.com",
  "/\r//evil.com",
  "\\\\evil.com",
  "https:/evil.com",
  "/ /evil.com",
];

/** Where the signed-in branch of /signin actually sends the visitor. */
async function signInRedirect(next: string): Promise<string> {
  nav.to.length = 0;
  session.user = { id: "u-alice", email: "alice@example.com" };
  await expect(SignInPage({ searchParams: { next } })).rejects.toThrow("NEXT_REDIRECT");
  return nav.to[0];
}

describe("/signin honours only a same-origin path in `next`", () => {
  beforeEach(() => {
    resetRouteMocks();
    setDb(fakeDb());
    session.user = null;
  });

  for (const next of HOSTILE.filter((n) => !/[\t\n\r]/.test(n))) {
    it(`refuses to send a visitor off-site for ${JSON.stringify(next)}`, async () => {
      const dest = browserResolves(await signInRedirect(next));
      expect(dest.origin).toBe(SITE);
      expect(dest.hostname).toBe("sloptic.org");
    });
  }

  // A browser deletes tab, newline and carriage return from a URL BEFORE parsing it, so
  // "/<TAB>/evil.com" clears any check on the first two characters and is then resolved as an
  // authority. The redirect here is relative (next/navigation's redirect emits the value as given),
  // so nothing else would keep it on our origin. lib/redirect parses instead of pattern-matching,
  // and refuses control characters outright.
  // CLAUDE.md: only a same-origin path may be honoured.
  for (const next of HOSTILE.filter((n) => /[\t\n\r]/.test(n))) {
    it(`refuses to send a visitor off-site for ${JSON.stringify(next)}`, async () => {
      const dest = browserResolves(await signInRedirect(next));
      expect(dest.origin).toBe(SITE);
    });
  }

  it("keeps an ordinary in-site destination", async () => {
    expect(await signInRedirect("/events/my-hackathon")).toBe("/events/my-hackathon");
  });

  it("falls back to the homepage when `next` is absent", async () => {
    nav.to.length = 0;
    session.user = { id: "u-alice", email: "alice@example.com" };
    await expect(SignInPage({ searchParams: {} })).rejects.toThrow("NEXT_REDIRECT");
    expect(nav.to[0]).toBe("/");
  });

  it("does not redirect a signed-out visitor anywhere", async () => {
    nav.to.length = 0;
    session.user = null;
    await SignInPage({ searchParams: { next: "/account" } });
    expect(nav.to).toEqual([]);
  });
});

describe("/auth/callback", () => {
  beforeEach(() => {
    resetRouteMocks();
    setDb(fakeDb({ store: { profiles: [] } }));
    session.exchange = { data: { user: { id: "u-alice", email: "alice@example.com" } }, error: null };
  });

  for (const next of HOSTILE) {
    it(`lands on our own origin for ${JSON.stringify(next)}`, async () => {
      const res = await callback(
        getRequest(`${SITE}/auth/callback?code=abc&next=${encodeURIComponent(next)}`)
      );
      const dest = browserResolves(res.headers.get("location") ?? "");
      expect(dest.origin).toBe(SITE);
    });
  }

  it("exchanges the code and lands on the requested in-site page", async () => {
    const res = await callback(getRequest(`${SITE}/auth/callback?code=abc&next=%2Fevents`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${SITE}/events`);
  });

  it("refuses without a code, and touches nothing", async () => {
    const db = fakeDb();
    setDb(db);
    const res = await callback(getRequest(`${SITE}/auth/callback?next=%2Faccount`));
    expect(res.headers.get("location")).toBe(`${SITE}/signin?error=missing_code`);
    expect(db.calls).toEqual([]);
  });

  it("writes no profile when the code does not exchange", async () => {
    const db = fakeDb();
    setDb(db);
    session.exchange = { data: { user: null }, error: { message: "invalid grant" } };
    const res = await callback(getRequest(`${SITE}/auth/callback?code=forged`));
    expect(res.headers.get("location")).toBe(`${SITE}/signin?error=exchange_failed`);
    expect(db.calls).toEqual([]);
  });

  it("stamps terms acceptance once and never re-dates it", async () => {
    const db = fakeDb({ store: { profiles: [] } });
    setDb(db);
    await callback(getRequest(`${SITE}/auth/callback?code=abc`));
    const first = db.rows("profiles")[0].terms_accepted_at as string;
    expect(first).toBeTruthy();

    await callback(getRequest(`${SITE}/auth/callback?code=abc`));
    expect(db.rows("profiles")).toHaveLength(1);
    expect(db.rows("profiles")[0].terms_accepted_at).toBe(first);
  });

  it("still signs the user in when the profile write fails", async () => {
    const db = fakeDb({ store: { profiles: [] } });
    db.failures.push({ table: "profiles", error: { code: "42501", message: "denied" } });
    setDb(db);
    const res = await callback(getRequest(`${SITE}/auth/callback?code=abc&next=%2Faccount`));
    expect(res.headers.get("location")).toBe(`${SITE}/account`);
  });
});

describe("/auth/signout", () => {
  beforeEach(() => {
    resetRouteMocks();
    setDb(fakeDb());
    session.signOuts = 0;
  });

  it("is POST only, so a prefetch or an <img> cannot sign anyone out", () => {
    expect(typeof signout.POST).toBe("function");
    expect((signout as Record<string, unknown>).GET).toBeUndefined();
  });

  it("clears the session and returns to our own homepage", async () => {
    const res = await signout.POST(getRequest(`${SITE}/auth/signout`));
    expect(session.signOuts).toBe(1);
    expect(res.status).toBe(303);
    expect(browserResolves(res.headers.get("location") ?? "").href).toBe(`${SITE}/`);
  });
});

// `read` is imported for parity with the other route tests; the redirect handlers have no body.
void read;
