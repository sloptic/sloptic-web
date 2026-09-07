/** The participant notice at /e/<token>, which is the consent half of the active event tier.
 *
 *  This page is the only thing a participant ever reads, so the honesty rules are load-bearing: it
 *  may promise the active battery ONLY for an event verified while its submission window was still
 *  open, it must render "we could not tell" as uncertainty rather than as either answer, and a
 *  retired token must stop meaning anything at all. It also names the event and never the
 *  organizer: a participant needs to know what happens to their app, not who filed the claim.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { fakeDb, type FakeSupabase } from "../helpers/supabase";
import { setDb, resetRouteMocks } from "../helpers/route";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/supabase", async () => {
  const { getDb } = await import("../helpers/route");
  return { supabaseAdmin: () => getDb() };
});

import DisclosurePage from "@/app/e/[token]/page";

const ALICE = "u-alice";

type ClaimSeed = Record<string, unknown>;

function store(claims: ClaimSeed[]): FakeSupabase {
  return fakeDb({ store: { event_claims: claims } });
}

const verifiedClaim = (over: ClaimSeed = {}): ClaimSeed => ({
  id: "c1",
  account_id: ALICE,
  slug: "alices-hack",
  token: "the-real-token",
  status: "verified",
  verified_at: "2026-02-01T00:00:00.000Z",
  window_open_at_verification: true,
  // Unapproved by default, as the column is. What this page owes a participant is what will actually
  // happen to their app, and an unapproved event gets the passive floor however the window landed.
  active_approved: false,
  ...over,
});

async function markup(token: string): Promise<string> {
  const page = (await DisclosurePage({ params: { token } })) as ReactElement;
  return renderToStaticMarkup(page);
}

describe("/e/<token>", () => {
  beforeEach(() => resetRouteMocks());

  it("is not a page for a token nobody was issued", async () => {
    setDb(store([verifiedClaim()]));
    await expect(markup("not-a-token")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("matches the whole token, so a prefix of a live one buys nothing", async () => {
    setDb(store([verifiedClaim()]));
    for (const guess of ["the-real", "the-real-token-and-more", "THE-REAL-TOKEN", ""]) {
      await expect(markup(guess)).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("stops rendering once the claim is revoked, retiring the published link", async () => {
    setDb(store([verifiedClaim({ status: "revoked" })]));
    await expect(markup("the-real-token")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // Anchored on the SENTENCE that does the disclosing, not on a phrase. The wording here is Ian's
  // and will keep changing; what must not change is that a participant is told attack traffic is
  // coming when it is, and is not told so when it is not. An earlier version matched "full battery"
  // and broke on a rewrite that kept the promise intact, which is a test measuring the wrong thing.
  const WARNS_OF_ATTACKS = /send real attack traffic/i;

  it("warns of attack traffic when the window was open and the event approved", async () => {
    setDb(store([verifiedClaim({ active_approved: true })]));
    const html = await markup("the-real-token");
    expect(html).toMatch(WARNS_OF_ATTACKS);
  });

  it("promises no attack traffic for an unapproved event, whatever the window says", async () => {
    // The page must not describe traffic that will not arrive. An event inside its window is still
    // passive until a human has approved it, and telling participants otherwise would be a warning
    // about something that never happens, which is its own way of not being believed next time.
    setDb(store([verifiedClaim()]));
    const html = await markup("the-real-token");
    expect(html).not.toMatch(WARNS_OF_ATTACKS);
    expect(html).toContain("passive checks and nothing else");
  });

  it("says passive only when the disclosure went up after the deadline", async () => {
    setDb(store([verifiedClaim({ window_open_at_verification: false })]));
    const html = await markup("the-real-token");
    expect(html).toContain("passive checks and nothing else");
    // The load-bearing half: a notice published after the event closed was shown to nobody, so it
    // cannot authorize attack traffic, and must not read as though it did.
    expect(html).not.toMatch(WARNS_OF_ATTACKS);
  });

  it("renders an unknown window as uncertainty, never as either answer", async () => {
    // Approval must not collapse the third state. NULL means we could not tell whether the window
    // was open, and an unapproved event whose window is unknown is still unknown, not passive.
    setDb(store([verifiedClaim({ window_open_at_verification: null })]));
    const html = await markup("the-real-token");
    expect(html).not.toContain("full battery");
    expect(html).not.toContain("passive checks and nothing else");
    expect(html).toContain("settled when the organizer verifies it");
  });

  it("promises nothing for a claim that has not verified", async () => {
    setDb(store([verifiedClaim({ status: "pending", verified_at: null, window_open_at_verification: null })]));
    const html = await markup("the-real-token");
    expect(html).toContain("has not completed verification");
    expect(html).not.toContain("full battery");
  });

  it("names the event and never the organizer", async () => {
    setDb(store([verifiedClaim({ account_id: "u-alice", organizer_email: "alice@example.com" })]));
    const html = await markup("the-real-token");
    expect(html).toContain("alices-hack.devpost.com");
    expect(html).not.toContain("u-alice");
    expect(html).not.toContain("alice@example.com");
  });

  it("shows one claim's page without carrying another's token into it", async () => {
    setDb(store([verifiedClaim(), verifiedClaim({ id: "c2", token: "someone-elses-token", slug: "other-hack" })]));
    const html = await markup("the-real-token");
    expect(html).not.toContain("someone-elses-token");
  });
});
