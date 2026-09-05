/** Who the server thinks you are, and what the browser is allowed to be told.
 *
 *  Two properties, one file. First, identity comes from the auth server: getUser() verifies the
 *  token, getSession() only decodes whatever cookie was sent, and anything that authorizes on the
 *  second is forgeable by whoever holds a text editor. Second, the service-role key bypasses RLS
 *  and is therefore the whole database: it must exist only in server code, and never on a path that
 *  can reach a client bundle. Sloptic grades apps for leaking exactly this, so the scans at the
 *  bottom are cheap insurance against self-parody.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const client = vi.hoisted(() => ({
  url: "",
  key: "",
  getUserCalls: 0,
  getSessionCalls: 0,
  user: { id: "u-alice", email: "alice@example.com" } as unknown,
  error: null as unknown,
  cookieWritesThrow: false,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (url: string, key: string, opts: { cookies: { setAll: (l: unknown[]) => void } }) => {
    client.url = url;
    client.key = key;
    // Exercised by the read-only-context test: a server component cannot write cookies.
    if (client.cookieWritesThrow) opts.cookies.setAll([{ name: "sb", value: "x", options: {} }]);
    return {
      auth: {
        getUser: async () => {
          client.getUserCalls += 1;
          return { data: { user: client.user }, error: client.error };
        },
        getSession: async () => {
          client.getSessionCalls += 1;
          return { data: { session: { user: { id: "u-forged" } } }, error: null };
        },
      },
    };
  },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    getAll: () => [],
    set: () => {
      if (client.cookieWritesThrow) throw new Error("Cookies can only be modified in a Server Action");
    },
  }),
}));

import { currentUser, supabaseSession, publicSupabaseConfig } from "@/lib/auth";

const ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "SERVICE-ROLE-KEY-DO-NOT-SHIP";
  client.getUserCalls = 0;
  client.getSessionCalls = 0;
  client.user = { id: "u-alice", email: "alice@example.com" };
  client.error = null;
  client.cookieWritesThrow = false;
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("currentUser", () => {
  it("returns the account the auth server vouches for", async () => {
    expect(await currentUser()).toEqual({ id: "u-alice", email: "alice@example.com" });
  });

  it("verifies with the auth server and never decodes the cookie itself", async () => {
    await currentUser();
    expect(client.getUserCalls).toBe(1);
    // getSession() trusts whatever cookie arrived. An authorization decision taken on it would be
    // an authorization decision taken on attacker-supplied JSON.
    expect(client.getSessionCalls).toBe(0);
  });

  it("is null, never a partial user, when the token does not verify", async () => {
    client.user = null;
    client.error = { message: "invalid JWT" };
    expect(await currentUser()).toBeNull();
  });

  it("is null when there is no session at all", async () => {
    client.user = undefined;
    expect(await currentUser()).toBeNull();
  });
});

describe("the session client", () => {
  it("carries the anon key, so RLS still applies to it", () => {
    supabaseSession();
    expect(client.key).toBe("anon-key");
    expect(client.key).not.toBe(process.env.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("survives a context where cookies cannot be written", () => {
    client.cookieWritesThrow = true;
    expect(() => supabaseSession()).not.toThrow();
  });
});

describe("publicSupabaseConfig", () => {
  it("hands out the anon key and only the anon key", () => {
    expect(publicSupabaseConfig()).toEqual({ url: "https://db.example.com", key: "anon-key" });
  });

  it("refuses rather than reaching for something else when the anon key is absent", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    // The service role key is set, and must not be what fills the gap.
    expect(() => publicSupabaseConfig()).toThrow();
  });

  it("never returns the service role key under any env arrangement", () => {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    for (const arrangement of [
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key" },
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_ANON_KEY: "anon-key-2" },
    ]) {
      for (const [k, v] of Object.entries(arrangement)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      expect(publicSupabaseConfig().key).not.toBe(secret);
    }
  });
});

// --- what may reach the browser -----------------------------------------------------------------

// vitest runs from web/, which is the root the aliases and the app directory hang off.
const WEB = process.cwd();

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === ".next" || name === "test") continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const FILES = [...sources(join(WEB, "app")), ...sources(join(WEB, "lib")), join(WEB, "middleware.ts")];
const read = (f: string) => readFileSync(f, "utf8");
const isClient = (src: string) => /^\s*["']use client["']/.test(src);

describe("secrets stay on the server", () => {
  it("names the service role key only in server modules", () => {
    const holders = FILES.filter((f) => read(f).includes("SUPABASE_SERVICE_ROLE_KEY"));
    // lib/supabase.ts builds the service-role client. lib/ratelimit.ts uses the key as the salt it
    // hashes a submitter IP with, so the hashes are not reversible by anyone without it. Both are
    // reached only from route handlers, and this list is meant to stay this short.
    expect(holders.map((f) => relative(WEB, f)).sort()).toEqual(["lib/ratelimit.ts", "lib/supabase.ts"]);
    for (const f of holders) expect(isClient(read(f)), `${relative(WEB, f)} is a client component`).toBe(false);
  });

  it("keeps the service-role client out of every client component", () => {
    const leaks = FILES.filter((f) => {
      const src = read(f);
      return isClient(src) && /from\s+["'](@\/lib\/supabase|\.\.?\/.*lib\/supabase)["']/.test(src);
    }).map((f) => relative(WEB, f));
    expect(leaks).toEqual([]);
  });

  it("publishes no NEXT_PUBLIC_ variable that sounds like a secret", () => {
    const named = new Set<string>();
    for (const f of FILES) for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) named.add(m[0]);
    for (const name of named) {
      expect(name, `${name} is shipped to the browser`).not.toMatch(/SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN/);
    }
  });
});

describe("every mutating route gates itself", () => {
  // The middleware refreshes the auth cookie and nothing more, so it is not, and must never be
  // mistaken for, the access control. Each handler asks who the caller is on its own.
  it("does not decide access in middleware", () => {
    const src = read(join(WEB, "middleware.ts"));
    expect(src).not.toMatch(/401|403|NextResponse\.redirect/);
  });

  it("checks the session in every POST handler under /api/events and /api/account", () => {
    const routes = FILES.filter(
      (f) => f.endsWith("route.ts") && /app\/api\/(events|account)\//.test(f.replace(/\\/g, "/"))
    );
    expect(routes.length).toBeGreaterThan(5);
    for (const f of routes) {
      const src = read(f);
      if (!/export async function POST/.test(src)) continue;
      expect(src, `${relative(WEB, f)} does not call currentUser()`).toMatch(/currentUser\(\)/);
      expect(src, `${relative(WEB, f)} does not refuse a signed-out caller`).toMatch(/status:\s*401/);
    }
  });

  it("scopes every event route's reads to the caller's own account", () => {
    const routes = FILES.filter(
      (f) => f.endsWith("route.ts") && /app\/api\/events\//.test(f.replace(/\\/g, "/"))
    );
    for (const f of routes) {
      const src = read(f);
      if (!/export async function POST/.test(src)) continue;
      expect(src, `${relative(WEB, f)} never filters on the caller's account`).toMatch(
        /eq\("account_id",\s*user\.id\)/
      );
    }
  });
});
