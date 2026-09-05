/** POST /api/grade: what may be submitted for grading at all.
 *
 *  This route is the front door to an outbound fetcher, so its contract is mostly refusals. The
 *  binding ones come from CLAUDE.md: passive by default for anything unverified, an egress sandbox
 *  over every outbound fetch (loopback, RFC1918, link-local, 169.254.169.254), and a rate limit plus
 *  a quota on every grade. Those are legal safety, so the tests here assert the refusal, not the
 *  message.
 *
 *  DNS is mocked because the egress gate resolves the host: the point of the gate is what the name
 *  RESOLVES to, not how it is spelled, and a test that depended on the machine's resolver would be
 *  testing the network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeDb, type FakeSupabase } from "../../helpers/supabase";
import { setDb, setUser, resetRouteMocks, jsonRequest, malformedRequest, read } from "../../helpers/route";

vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../../helpers/route");
  return { supabaseAdmin: () => getDb() };
});
vi.mock("@/lib/auth", async () => {
  const { getUser, getDb } = await import("../../helpers/route");
  return { currentUser: async () => getUser(), supabaseSession: () => getDb() };
});

const PUBLIC_IP = "93.184.216.34";
const dns = vi.hoisted(() => ({
  /** host -> addresses. Anything unregistered resolves to a public address. */
  answers: new Map<string, string[]>(),
  missing: new Set<string>(),
  calls: [] as string[],
}));
vi.mock("node:dns/promises", () => {
  const lookup = async (host: string) => {
    dns.calls.push(host);
    if (dns.missing.has(host)) throw new Error("ENOTFOUND");
    const addrs = dns.answers.get(host) ?? ["93.184.216.34"];
    return addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return { default: { lookup }, lookup };
});

const { POST } = await import("@/app/api/grade/route");

function submit(url: unknown, ip = "203.0.113.7") {
  const req = jsonRequest("http://localhost/api/grade", { url });
  req.headers.set("x-forwarded-for", ip);
  return POST(req);
}

let db: FakeSupabase;
const savedEnv = { ...process.env };

beforeEach(() => {
  db = fakeDb({ store: { grades: [], rate_limits: [] } });
  setDb(db);
  setUser(null);
  dns.answers.clear();
  dns.missing.clear();
  dns.calls = [];
  process.env.GRADING_OPEN = "1";
  process.env.RATE_LIMIT_MAX = "5";
  process.env.RATE_LIMIT_WINDOW_SECONDS = "3600";
  process.env.MAX_QUEUE_DEPTH = "30";
});
afterEach(() => {
  resetRouteMocks();
  process.env = { ...savedEnv };
});

describe("POST /api/grade, the switch and the body", () => {
  it("refuses everything while grading is closed, before touching the database", async () => {
    delete process.env.GRADING_OPEN;
    const { status } = await read(await submit("https://example.com"));
    expect(status).toBe(503);
    expect(db.calls).toEqual([]);
  });

  it("treats any value but a true-ish flag as closed, since a queued grade nobody runs never finishes", async () => {
    for (const v of ["0", "false", "no", "", "maybe"]) {
      process.env.GRADING_OPEN = v;
      expect((await submit("https://example.com")).status).toBe(503);
    }
  });

  it("rejects a body that is not JSON", async () => {
    const { status } = await read(await POST(malformedRequest("http://localhost/api/grade")));
    expect(status).toBe(400);
    expect(db.rows("grades")).toEqual([]);
  });

  it("rejects a missing or empty url", async () => {
    for (const v of [undefined, "", "   ", null]) {
      const { status } = await read(await submit(v));
      expect(status).toBe(400);
    }
    expect(db.rows("grades")).toEqual([]);
  });
});

describe("POST /api/grade, normalising the target", () => {
  it("accepts a public https URL and queues it", async () => {
    const { status, body } = await read(await submit("https://example.com/dashboard?x=1#top"));
    expect(status).toBe(202);
    expect(body.status).toBe("queued");
    // The grade covers an origin, not a path: the worker pins the run to it.
    expect(body.origin).toBe("https://example.com");
    expect(db.rows("grades")).toHaveLength(1);
  });

  it("lowercases the host, drops path, query and fragment, and keeps an explicit port", async () => {
    await submit("https://EXAMPLE.COM:8443/a/b?q=1#f");
    expect(db.rows("grades")[0].origin).toBe("https://example.com:8443");
  });

  it("keeps the raw submission for display without letting it widen the graded scope", async () => {
    await submit("  https://example.com/admin  ");
    const row = db.rows("grades")[0];
    expect(row.submitted_url).toBe("https://example.com/admin");
    expect(row.origin).toBe("https://example.com");
  });

  it("stores a unicode host as punycode, so the graded origin is unambiguous", async () => {
    // The homograph is the display problem; the origin must be the one form a resolver agrees on.
    await submit("https://exaмple.com");
    expect(String(db.rows("grades")[0].origin)).toMatch(/^https:\/\/xn--/);
  });

  it("queues every grade as passive, whatever the caller asks for", async () => {
    // Active probing is a gated tier behind two ownership proofs (CLAUDE.md). This route issues none,
    // so nothing it accepts may ever be queued active.
    const req = jsonRequest("http://localhost/api/grade", { url: "https://example.com", mode: "active" });
    req.headers.set("x-forwarded-for", "203.0.113.7");
    await POST(req);
    expect(db.rows("grades")[0].mode).toBe("passive");
  });
});

describe("POST /api/grade, schemes and shapes that are not gradeable targets", () => {
  it("refuses a scheme that is not http or https", async () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://example.com/x",
      "gopher://example.com:70/",
      "ws://example.com/socket",
    ]) {
      const { status } = await read(await submit(url));
      expect(status, url).toBe(400);
    }
    expect(db.rows("grades")).toEqual([]);
    expect(dns.calls).toEqual([]);
  });

  it("refuses a string that is not a URL at all", async () => {
    for (const url of ["example.com", "not a url", "//example.com", "https://"]) {
      expect((await submit(url)).status, url).toBe(400);
    }
    expect(db.rows("grades")).toEqual([]);
  });

  it("refuses an internal name at the parse gate, without asking a resolver", async () => {
    for (const url of [
      "http://localhost:3000",
      "https://app.localhost",
      "https://db.internal",
      "http://intranet",
    ]) {
      expect((await submit(url)).status, url).toBe(400);
    }
    expect(dns.calls).toEqual([]);
  });
});

describe("POST /api/grade, the egress sandbox", () => {
  const internal = [
    "http://127.0.0.1:3000",
    "http://127.1",
    "http://0.0.0.0",
    "http://10.0.0.5",
    "http://172.16.0.1",
    "http://172.31.255.254",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1",
    "http://224.0.0.1",
    "http://[::1]",
    "http://[fd00::1]",
    "http://[fe80::1]",
  ];

  it("refuses a literal address inside a blocked range", async () => {
    // A fresh address per target: a refusal still costs quota, and a 429 would hide the refusal
    // this test is about.
    for (const [i, url] of internal.entries()) {
      const { status } = await read(await submit(url, `198.51.100.${i}`));
      expect(status, url).toBe(400);
    }
    expect(db.rows("grades")).toEqual([]);
  });

  it("refuses an obfuscated spelling of a loopback address", async () => {
    // Decimal and hex forms are the classic bypass; the URL parser canonicalises them, so the
    // range check sees 127.0.0.1 either way.
    const forms = ["http://0x7f.0.0.1", "http://2130706433", "http://127.0.0.1.", "http://0177.0.0.1"];
    for (const [i, url] of forms.entries()) {
      expect((await submit(url, `198.51.100.20${i}`)).status, url).toBe(400);
    }
  });

  it("allows an address just outside a blocked range, so the gate is not merely refusing everything", async () => {
    for (const url of ["http://172.32.0.1", "http://11.0.0.1", "http://192.169.0.1", "http://100.128.0.1"]) {
      const { status } = await read(await submit(url, `203.0.113.${internal.length}`));
      expect(status, url).toBe(202);
    }
  });

  it("refuses a public NAME that resolves to an internal address", async () => {
    // The name is the attacker's to choose; only the resolved address matters.
    dns.answers.set("internal.example.com", ["10.1.2.3"]);
    const { status } = await read(await submit("https://internal.example.com"));
    expect(status).toBe(400);
    expect(db.rows("grades")).toEqual([]);
  });

  it("refuses when ANY resolved address is internal, not only the first", async () => {
    dns.answers.set("split.example.com", [PUBLIC_IP, "192.168.0.9"]);
    expect((await submit("https://split.example.com")).status).toBe(400);
  });

  it("refuses when the only address is an IPv6 loopback, link-local or unique-local", async () => {
    const cases: [string, string][] = [["a.example.com", "::1"], ["b.example.com", "fe80::1"], ["c.example.com", "fd12::9"]];
    for (const [i, [host, addr]] of cases.entries()) {
      dns.answers.set(host, [addr]);
      expect((await submit(`https://${host}`, `198.51.100.3${i}`)).status, addr).toBe(400);
    }
  });

  it("refuses an IPv4-mapped IPv6 answer that points at loopback", async () => {
    dns.answers.set("mapped.example.com", ["::ffff:127.0.0.1"]);
    expect((await submit("https://mapped.example.com")).status).toBe(400);
  });

  it("refuses a host that does not resolve", async () => {
    dns.missing.add("gone.example.com");
    const { status } = await read(await submit("https://gone.example.com"));
    expect(status).toBe(400);
    expect(db.rows("grades")).toEqual([]);
  });

  it("charges the rate limit for a refused target, so probing internal space is not free", async () => {
    dns.answers.set("internal.example.com", ["10.1.2.3"]);
    for (let i = 0; i < 5; i++) await submit("https://internal.example.com", "198.51.100.4");
    const { status } = await read(await submit("https://example.com", "198.51.100.4"));
    expect(status).toBe(429);
  });
});

describe("POST /api/grade, rate limit and quota", () => {
  it("allows up to the window maximum from one address and then refuses", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await submit("https://example.com", "198.51.100.1")).status).toBe(202);
    }
    const { status, body } = await read(await submit("https://example.com", "198.51.100.1"));
    expect(status).toBe(429);
    expect(body.error).toMatch(/rate limit/i);
    expect(db.rows("grades")).toHaveLength(5);
  });

  it("counts per address, so one exhausted submitter does not close the site", async () => {
    for (let i = 0; i < 5; i++) await submit("https://example.com", "198.51.100.1");
    expect((await submit("https://example.com", "198.51.100.2")).status).toBe(202);
  });

  it("stores a hash of the submitter address, never the address", async () => {
    await submit("https://example.com", "198.51.100.77");
    const hash = String(db.rows("grades")[0].submitter_ip_hash);
    expect(hash).not.toContain("198.51.100.77");
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(String(db.rows("rate_limits")[0].ip_hash)).toBe(hash);
  });

  it("refuses once the public queue is at its depth cap", async () => {
    process.env.MAX_QUEUE_DEPTH = "3";
    for (let i = 0; i < 3; i++) db.rows("grades").push({ id: `q${i}`, status: "queued", event_run_id: null });
    const { status, body } = await read(await submit("https://example.com"));
    expect(status).toBe(503);
    expect(body.waiting).toBe(3);
  });

  it("counts only the public lane toward that cap", async () => {
    // The worker claims every public grade before any event grade (claim_job), so an event field
    // waiting cannot be what closes the door on a single submission.
    process.env.MAX_QUEUE_DEPTH = "3";
    for (let i = 0; i < 40; i++) db.rows("grades").push({ id: `e${i}`, status: "queued", event_run_id: "run-1" });
    expect((await submit("https://example.com")).status).toBe(202);
  });

  it("counts only queued grades, not the ones already running or done", async () => {
    process.env.MAX_QUEUE_DEPTH = "2";
    db.rows("grades").push({ id: "r1", status: "running", event_run_id: null });
    db.rows("grades").push({ id: "d1", status: "done", event_run_id: null });
    expect((await submit("https://example.com")).status).toBe(202);
  });

  it("accepts when the depth count cannot be read, since an unreadable count is not a full queue", async () => {
    db.failures.push({ table: "grades", kind: "select", error: { code: "08006", message: "connection lost" } });
    const { status } = await read(await submit("https://example.com"));
    expect(status).toBe(202);
  });

  it("reports a failed insert as a server error rather than a queued grade", async () => {
    db.failures.push({ table: "grades", kind: "insert", error: { code: "23514", message: "check violation" } });
    const { status, body } = await read(await submit("https://example.com"));
    expect(status).toBe(500);
    expect(body.id).toBeUndefined();
  });
});

describe("POST /api/grade, ownership of the queued row", () => {
  it("leaves an anonymous submission unowned, so retention reaches its report", async () => {
    const { status } = await read(await submit("https://example.com"));
    expect(status).toBe(202);
    expect(db.rows("grades")[0].account_id).toBeNull();
  });

  it("attaches a signed-in submitter's account, so their own grade does not quietly expire", async () => {
    setUser({ id: "user-1", email: "a@example.com" });
    await submit("https://example.com");
    expect(db.rows("grades")[0].account_id).toBe("user-1");
  });
});

describe("POST /api/grade, gaps between the contract and the code", () => {
  // The limit is the only quota between an anonymous caller and the worker fetching a URL of their
  // choosing, so it has to hold against traffic that is not already polite. Migration 0026 makes
  // the increment and the verdict one statement.
  it("holds the per-address limit against a concurrent burst", async () => {
    const burst = await Promise.all(
      Array.from({ length: 12 }, () => submit("https://example.com", "198.51.100.9"))
    );
    expect(burst.filter((r) => r.status === 202)).toHaveLength(5);
  });

  // Credentials in a URL are two problems at once: `https://good.example.com@evil.example.com`
  // reads as the first host and is graded as the second, and anything pasted into the userinfo
  // would be stored on the grade and served back to every link holder.
  it("refuses a URL carrying credentials", async () => {
    const { status } = await read(await submit("https://user:secret@example.com"));
    expect(status).toBe(400);
    expect(db.rows("grades")).toEqual([]);
  });

  // Whatever is submitted is stored per grade and carried back out by every list view.
  it("refuses an absurdly long URL", async () => {
    const { status } = await read(await submit(`https://example.com/${"a".repeat(200_000)}`));
    expect(status).toBe(400);
  });

  // The body is parsed JSON, so `url` can be a number or an array. Those are a bad request, which
  // is what the route documents, not a 500 out of .trim().
  it("answers a non-string url with a 400, not a crash", async () => {
    for (const v of [42, ["https://example.com"], { href: "https://example.com" }, true]) {
      const { status } = await read(await submit(v));
      expect(status, JSON.stringify(v)).toBe(400);
    }
  });

  // A trailing dot is the same name to a resolver and a different string to endsWith. The resolved
  // address check would catch these anyway; this is the cheap gate in front of it holding its line.
  it("refuses an internal name written with a trailing dot", async () => {
    dns.answers.set("localhost.", [PUBLIC_IP]);
    dns.answers.set("db.internal.", [PUBLIC_IP]);
    expect((await submit("http://localhost./")).status).toBe(400);
    expect((await submit("http://db.internal./")).status).toBe(400);
  });

  // The bucket comes from the header the PLATFORM writes, not the one the caller can. Vercel
  // replaces x-forwarded-for today, so reading its first entry is correct there, but it is one
  // deployment behind a proxy that appends away from being a free bypass: rotate the prefix, get a
  // fresh bucket. This asserts the precedence rather than the topology, which is the part we
  // control. Whether a bare x-forwarded-for can be trusted depends on the host, so it is not
  // asserted here at all.
  it("buckets on the platform header, not on one the caller can write", async () => {
    const spend = async (xff: string, platform: string) => {
      const req = jsonRequest("http://localhost/api/grade", { url: "https://example.com" });
      req.headers.set("x-forwarded-for", xff);
      req.headers.set("x-vercel-forwarded-for", platform);
      return read(await POST(req));
    };
    // One real caller behind a rotating claim about who they are.
    for (let i = 0; i < 5; i++) await spend(`198.51.100.${i}, 203.0.113.99`, "203.0.113.7");
    const { status } = await spend("10.9.8.7, 203.0.113.99", "203.0.113.7");
    expect(status).toBe(429);
  });
});
