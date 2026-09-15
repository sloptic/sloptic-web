/** Wiring for testing App Router route handlers.
 *
 *  Route handlers reach the world through exactly two modules, `@/lib/supabase` (the service-role
 *  client) and `@/lib/auth` (the session), so those are the only two a test has to replace. The
 *  registry below holds what they should return; the mock factories in a test file read it lazily,
 *  which keeps them clear of vi.mock's hoisting.
 *
 *  Put this at the top of a route test:
 *
 *      vi.mock("@/lib/supabase", async () => {
 *        const { getDb } = await import("../helpers/route");
 *        return { supabaseAdmin: () => getDb() };
 *      });
 *      vi.mock("@/lib/auth", async () => {
 *        const { getUser, getDb } = await import("../helpers/route");
 *        return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
 *      });
 *
 *  then call setDb()/setUser() in beforeEach.
 */
import type { NextRequest } from "next/server";
import type { FakeSupabase } from "./supabase";

export type TestUser = { id: string; email: string } | null;

let db: FakeSupabase | null = null;
let user: TestUser = null;

export function setDb(next: FakeSupabase) {
  db = next;
}
export function getDb(): FakeSupabase {
  if (!db) throw new Error("setDb() was not called: the route reached the database before the test seeded one");
  return db;
}
export function setUser(next: TestUser) {
  user = next;
}
export function getUser(): TestUser {
  return user;
}
export function resetRouteMocks() {
  db = null;
  user = null;
}

/** A POST with a JSON body, which is every mutating route here. */
export function jsonRequest(url: string, body: unknown, method = "POST"): NextRequest {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** A POST whose body is not JSON, to exercise the parse-failure branch every route carries. */
export function malformedRequest(url: string): NextRequest {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }) as unknown as NextRequest;
}

export function getRequest(url: string): NextRequest {
  return new Request(url, { method: "GET" }) as unknown as NextRequest;
}

/** The status and parsed body of a handler's response, which is what assertions are about. */
export async function read(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** A worker that checked in just now.
 *
 *  POST /api/grade and /api/status both refuse when the heartbeat is stale, because a stopped worker
 *  expires nothing and the queue it accepts into is then failed wholesale on its first pass back. So
 *  every test of the door needs a live worker in the store, and it needs to be the SAME live worker
 *  everywhere: a seed each file wrote for itself is a seed that drifts, and the one that drifts
 *  quietly starts passing for the wrong reason.
 *
 *  Pass `secondsAgo` past 90 to seed the outage instead.
 */
export function liveWorker(over: Record<string, unknown> = {}, secondsAgo = 2) {
  return {
    id: "worker",
    last_seen: new Date(Date.now() - secondsAgo * 1000).toISOString(),
    state: "polling",
    reason: null,
    in_flight: null,
    blocked_lanes: {},
    paused_note: null,
    ...over,
  };
}
