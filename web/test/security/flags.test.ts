/** The two email allowlists that stand in for a grant: isAdmin and mayOverrideEvents.
 *
 *  These are the only privilege in the product that is not proved, only asserted in an env var, so
 *  the interesting question is never "does the listed address match" but "what ELSE matches". Every
 *  case below is a way an address that is not on the list could be read as one that is.
 */
import { describe, it, expect, afterEach } from "vitest";
import { isAdmin, mayOverrideEvents, adminAccounts, eventOverrideAccounts } from "@/lib/flags";

const ADMIN = "SLOPTIC_ADMIN_ACCOUNTS";
const OVERRIDE = "SLOPTIC_EVENT_OVERRIDE";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  delete process.env[ADMIN];
  delete process.env[OVERRIDE];
});

describe("the admin allowlist is closed by default", () => {
  it("holds nobody when the variable is unset", () => {
    setEnv(ADMIN, undefined);
    expect(adminAccounts()).toEqual([]);
    expect(isAdmin("alice@example.com")).toBe(false);
  });

  it("holds nobody when the variable is empty or only separators", () => {
    for (const value of ["", "   ", ",", ",,,", " , , "]) {
      setEnv(ADMIN, value);
      expect(adminAccounts()).toEqual([]);
      expect(isAdmin("alice@example.com")).toBe(false);
    }
  });
});

describe("who the allowlist matches", () => {
  it("matches the listed address whatever case either side is written in", () => {
    setEnv(ADMIN, "Alice@Example.COM");
    expect(isAdmin("alice@example.com")).toBe(true);
    expect(isAdmin("ALICE@EXAMPLE.COM")).toBe(true);
  });

  it("reads a comma separated list with spaces around the entries", () => {
    setEnv(ADMIN, " alice@example.com , bob@example.com ");
    expect(adminAccounts()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(isAdmin("bob@example.com")).toBe(true);
  });

  it("does not match an empty, null or undefined email", () => {
    setEnv(ADMIN, "alice@example.com");
    expect(isAdmin("")).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it("does not let a blank list entry match an account with no email", () => {
    setEnv(ADMIN, "alice@example.com, ,");
    expect(isAdmin("")).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(" ")).toBe(false);
  });

  it("matches the whole address, so a lookalike domain is not the listed one", () => {
    setEnv(ADMIN, "alice@example.com");
    for (const impostor of [
      "alice@example.com.evil.com",
      "alice@example.co",
      "alice@exarnple.com",
      "alice@examp1e.com",
      "alice@sub.example.com",
      "alice@example.com@evil.com",
      "evil+alice@example.com",
      "alice@example.com ",
      " alice@example.com",
    ]) {
      expect(isAdmin(impostor)).toBe(false);
    }
  });

  it("does not treat a listed address as a prefix of a longer one", () => {
    setEnv(ADMIN, "alice@example.com");
    expect(isAdmin("malice@example.com")).toBe(false);
  });

  it("does not fold a unicode lookalike onto an ASCII address", () => {
    setEnv(ADMIN, "alice@example.com");
    // Cyrillic a and e, which render identically and are a different account entirely.
    expect(isAdmin("аlicе@example.com")).toBe(false);
  });
});

describe("the two switches are separate privileges", () => {
  it("does not give override to an admin, nor admin to an override account", () => {
    setEnv(ADMIN, "admin@example.com");
    setEnv(OVERRIDE, "override@example.com");
    expect(isAdmin("admin@example.com")).toBe(true);
    expect(mayOverrideEvents("admin@example.com")).toBe(false);
    expect(mayOverrideEvents("override@example.com")).toBe(true);
    expect(isAdmin("override@example.com")).toBe(false);
  });

  it("reads the override list with the same rules", () => {
    setEnv(OVERRIDE, " Over@Example.com ,");
    expect(eventOverrideAccounts()).toEqual(["over@example.com"]);
    expect(mayOverrideEvents("over@example.com")).toBe(true);
    expect(mayOverrideEvents("over@example.com.evil.com")).toBe(false);
    expect(mayOverrideEvents(undefined)).toBe(false);
  });

  it("is read per call, so removing an address takes effect without a restart", () => {
    setEnv(ADMIN, "alice@example.com");
    expect(isAdmin("alice@example.com")).toBe(true);
    setEnv(ADMIN, "");
    expect(isAdmin("alice@example.com")).toBe(false);
  });
});
