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

  it("promises the full battery only when the window was open at verification", async () => {
    setDb(store([verifiedClaim()]));
    const html = await markup("the-real-token");
    expect(html).toContain("full battery");
    expect(html).toContain("attack traffic");
  });

  it("says passive only when the disclosure went up after the deadline", async () => {
    setDb(store([verifiedClaim({ window_open_at_verification: false })]));
    const html = await markup("the-real-token");
    expect(html).toContain("passive checks and nothing else");
    expect(html).not.toContain("full battery");
  });

  it("renders an unknown window as uncertainty, never as either answer", async () => {
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
