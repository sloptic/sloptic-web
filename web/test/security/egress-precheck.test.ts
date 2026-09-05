/** The submit-time egress gate.
 *
 *  CLAUDE.md, on every outbound fetch (grade AND verification): block loopback, RFC1918,
 *  link-local, 169.254.169.254. This module is only the first of the four tiers in
 *  docs/egress-plan.md (the authoritative ones are the grader's resolver guard, its browser route
 *  filter, and the uid-scoped nftables deny on the worker host), so a hole here is not by itself a
 *  way into anyone's network. It is still the tier that decides what gets QUEUED, and the one whose
 *  refusal a submitter actually sees, so it is worth holding to the list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dns = vi.hoisted(() => ({
  addresses: [] as string[],
  fail: false,
}));
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: async () => {
      if (dns.fail) throw new Error("ENOTFOUND");
      return dns.addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
  },
}));

import { egressPrecheck } from "@/lib/egress";

beforeEach(() => {
  dns.addresses = ["93.184.216.34"];
  dns.fail = false;
});

const INTERNAL = [
  "127.0.0.1",
  "127.1.2.3",
  "0.0.0.0",
  "10.0.0.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "169.254.169.254",
  "169.254.0.1",
  "100.64.0.1",
  "224.0.0.1",
  "255.255.255.255",
  "::1",
  "::",
  "fe80::1",
  "FE80::1",
  "fd00::1",
  "fc00::1",
  "::ffff:127.0.0.1",
  "::ffff:169.254.169.254",
];

const PUBLIC = ["93.184.216.34", "8.8.8.8", "203.0.113.5", "172.15.0.1", "172.32.0.1", "2606:4700::1111"];

describe("a literal address in the submitted URL", () => {
  for (const ip of INTERNAL) {
    it(`refuses ${ip}`, async () => {
      expect(await egressPrecheck(ip)).toMatch(/cannot be graded/);
    });
  }

  for (const ip of PUBLIC) {
    it(`allows ${ip}`, async () => {
      expect(await egressPrecheck(ip)).toBeNull();
    });
  }

  // The deprecated "::127.0.0.1" form still parses and still routes, and it was walking past the
    // gate that stops its ::ffff: sibling. The OS tier drops it either way; this is the cheap check
    // in front agreeing with itself.
  it("refuses the IPv4-compatible form of loopback", async () => {
    expect(await egressPrecheck("::127.0.0.1")).toMatch(/cannot be graded/);
  });
});

describe("a hostname that resolves somewhere internal", () => {
  it("refuses a name pointing at the cloud metadata address", async () => {
    dns.addresses = ["169.254.169.254"];
    expect(await egressPrecheck("metadata.attacker.example")).toMatch(/cannot be graded/);
  });

  it("refuses when ANY resolved address is internal, not just the first", async () => {
    dns.addresses = ["93.184.216.34", "10.1.2.3"];
    expect(await egressPrecheck("split-horizon.example")).toMatch(/cannot be graded/);
  });

  it("refuses a decimal or octal spelling of loopback, which resolves rather than parses", async () => {
    dns.addresses = ["127.0.0.1"];
    for (const host of ["2130706433", "0177.0.0.1"]) {
      expect(await egressPrecheck(host)).toMatch(/cannot be graded/);
    }
  });

  it("refuses a name that does not resolve at all", async () => {
    dns.fail = true;
    expect(await egressPrecheck("nowhere.example")).toMatch(/could not be resolved/);
  });

  it("refuses a name that resolves to nothing", async () => {
    dns.addresses = [];
    expect(await egressPrecheck("empty.example")).toMatch(/could not be resolved/);
  });

  it("allows an ordinary public host", async () => {
    dns.addresses = ["93.184.216.34", "2606:4700::1111"];
    expect(await egressPrecheck("example.com")).toBeNull();
  });
});
