/** normalizeTarget: the string a person pasted, turned into the origin we will grade.
 *
 *  This is a security boundary as well as a parser. A grant authorizes URLs under a verified ORIGIN,
 *  so whatever comes out of here is the scope a later grade is measured against, and every route that
 *  makes the worker connect to a caller-chosen host goes through it.
 *
 *  The scheme is optional and defaults to https. It did not used to be, and the restriction protected
 *  nothing: http:// was always accepted, so requiring the prefix only turned "myapp.com" into an
 *  error. What is NOT done is guessing http for an app that only serves http. Nothing here fetches,
 *  so there is nothing to fall back with, and guessing the other way would grade an https app over
 *  plaintext and then deduct it for a downgrade we chose.
 */
import { describe, it, expect } from "vitest";
import { normalizeTarget, UrlRejected } from "@/lib/origin";

const origin = (raw: string) => normalizeTarget(raw).origin;
const rejects = (raw: unknown) => expect(() => normalizeTarget(raw)).toThrow(UrlRejected);

describe("normalizeTarget, the scheme", () => {
  it("keeps https when it is given", () => {
    expect(origin("https://example.com")).toBe("https://example.com");
  });

  it("keeps http when it is given, which is the point of letting it be given", () => {
    // An app served over plaintext has to be gradeable, or it cannot be deducted for being served
    // over plaintext. Rewriting it to https would grade something the submitter did not point at.
    expect(origin("http://example.com")).toBe("http://example.com");
  });

  it("assumes https when none is given", () => {
    expect(origin("example.com")).toBe("https://example.com");
    expect(origin("www.example.com")).toBe("https://www.example.com");
  });

  it("does not mistake a host:port for a scheme", () => {
    // The trap that makes this a regex rather than a try/parse: new URL("example.com:8080") SUCCEEDS,
    // reading "example.com:" as the scheme and "8080" as the path. A parse check would have taken
    // that as scheme-bearing and then refused it for a protocol nobody typed.
    expect(origin("example.com:8080")).toBe("https://example.com:8080");
  });

  it("takes a protocol-relative address", () => {
    expect(origin("//example.com")).toBe("https://example.com");
  });

  it("still refuses a scheme that is neither http nor https", () => {
    for (const raw of ["ftp://example.com", "ws://example.com", "file:///etc/passwd", "gopher://example.com:70/"]) {
      rejects(raw);
    }
  });

  it("does not let a scheme-shaped string smuggle something past the default", () => {
    for (const raw of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"]) {
      rejects(raw);
    }
  });
});

describe("normalizeTarget, the origin it produces", () => {
  it("is scheme, host and port only", () => {
    expect(origin("https://example.com/a/b?q=1#f")).toBe("https://example.com");
    expect(origin("example.com/dash?x=1")).toBe("https://example.com");
  });

  it("keeps an explicit port and lowercases the host", () => {
    expect(origin("HTTPS://EXAMPLE.COM:8443/x")).toBe("https://example.com:8443");
  });

  it("drops a trailing dot, which is the same name to a resolver", () => {
    expect(origin("example.com.")).toBe("https://example.com");
  });
});

describe("normalizeTarget, what it refuses", () => {
  it("refuses anything that is not a string, since the body is parsed JSON", () => {
    for (const raw of [undefined, null, 42, ["https://example.com"], {}]) rejects(raw);
  });

  it("refuses empty and whitespace", () => {
    for (const raw of ["", "   "]) rejects(raw);
  });

  it("refuses a bare scheme with no host", () => {
    for (const raw of ["https://", "http://"]) rejects(raw);
  });

  it("refuses a name with no dot, so the https default cannot reach an internal host", () => {
    // The default makes this matter more than it did: "intranet" used to be refused for having no
    // scheme, and now has to be refused on its own merits.
    for (const raw of ["localhost", "intranet", "router", "app.localhost", "db.internal"]) rejects(raw);
  });

  it("refuses credentials, which are a display lie and a stored secret at once", () => {
    rejects("https://good.example.com@evil.example.com");
    rejects("https://user:pass@example.com");
    // And through the default too, or the guard would depend on how the address was typed.
    rejects("user:pass@example.com");
  });

  it("refuses an absurdly long string rather than storing it on every grade", () => {
    rejects(`https://example.com/${"a".repeat(3000)}`);
  });
});
