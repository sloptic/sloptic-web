/** The ASVS 5.0 citations on /checks and /methodology.
 *
 *  A wrong citation on a page whose whole claim is rigor costs more than a missing one, so these pin
 *  the shape of the mapping: every security check is accounted for, every requirement resolves to a
 *  real section and link, and the three cases the grader team flagged stay the way they were flagged.
 */
import { describe, it, expect } from "vitest";
import { ASVS, ASVS_VERSION, SECTION_NAME, asvsCounts, asvsHref } from "@/lib/asvs";
import { PROBE_FACTS } from "@/lib/checks";

const security = PROBE_FACTS.filter((f) => f.area === "security").map((f) => f.id);

describe("the ASVS mapping", () => {
  it("accounts for every security check, including the ones with no requirement", () => {
    expect(security.filter((id) => !Object.hasOwn(ASVS, id))).toEqual([]);
  });

  it("cites nothing for a check outside security, or for one the catalog no longer has", () => {
    expect(Object.keys(ASVS).filter((id) => !security.includes(id))).toEqual([]);
  });

  it("cites only requirements that resolve to a known section, at a real level", () => {
    for (const [id, ref] of Object.entries(ASVS)) {
      if (!("req" in ref)) continue;
      const section = ref.req.split(".").slice(0, 2).join(".");
      expect([id, Object.hasOwn(SECTION_NAME, section)]).toEqual([id, true]);
      expect([id, [1, 2, 3].includes(ref.level)]).toEqual([id, true]);
    }
  });

  it("links a requirement to its section at the release tag", () => {
    expect(ASVS_VERSION).toBe("5.0.0");
    expect(asvsHref("1.2.4")).toBe(
      "https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x10-V1-Encoding-and-Sanitization.md#v12-injection-prevention",
    );
    expect(asvsHref("12.2.1")).toBe(
      "https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/en/0x21-V12-Secure-Communication.md#v122-https-communication-with-external-facing-services",
    );
  });

  it("never cites ASVS for the localStorage check, which ASVS 14.3.3 allows", () => {
    const ref = ASVS["sec-session-005"];
    expect(ref.kind).toBe("stricter");
    expect("req" in ref).toBe(false);
  });

  it("cites the clickjacking requirement as related, not as a match", () => {
    // 3.4.6 asks for CSP frame-ancestors; the check also accepts X-Frame-Options.
    expect(ASVS["sec-headers-004"]).toMatchObject({ kind: "related", req: "3.4.6" });
  });

  it("says which part of a documentation-relative requirement Sloptic tests", () => {
    // 6.3.1 and 15.2.1 are written against the app's own docs, which Sloptic cannot read.
    for (const id of ["sec-ratelimit-001", "sec-deps-001"]) expect(ASVS[id]).toHaveProperty("note");
  });

  it("adds up to the security battery", () => {
    const n = asvsCounts();
    expect(n.maps + n.near + n.stricter + n.none).toBe(n.security);
    expect(n).toMatchObject({ security: 63, maps: 49, near: 9, stricter: 1, none: 4 });
  });

  it("never claims compliance, and keeps its notes to simple sentences", () => {
    const notes = Object.values(ASVS).flatMap((r) => ("note" in r && r.note ? [r.note] : []));
    const joins = /;|, (and|but|or|so) | (if|because|unless|when|while|although|since|which|whose) /i;
    for (const n of notes) {
      expect(n).not.toMatch(/complian|certif|verified/i);
      expect([n, joins.test(n)]).toEqual([n, false]);
    }
  });
});
