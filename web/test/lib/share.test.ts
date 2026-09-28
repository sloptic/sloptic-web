/** What a shared score shows, and the links that post it.
 *
 *  A share is public by design, so the tests that matter are the refusals: a grade with no honest
 *  score (withheld by a bot challenge, from before 3.0, expired, unfinished) must produce no card, and
 *  a card must never say more than the summary. The link builders are checked against each
 *  platform's documented format, since a wrong parameter fails silently on their side.
 */
import { describe, it, expect } from "vitest";
import { VERDICTS, fmtShareScore, hostOf, shareCardFrom, shareTargets, shareText, shareTitle, shareVerdict, type ShareSource } from "@/lib/share";

const RULER = { full: "2026.4", passive: "passive-2026.2" };

function src(over: { grade?: Partial<ShareSource["grade"]>; result?: Partial<NonNullable<ShareSource["result"]>> | null; verifiedOwner?: boolean } = {}): ShareSource {
  return {
    grade: { status: "done", origin: "https://myapp.dev", retry_due_at: null, ...over.grade },
    result:
      over.result === null
        ? null
        : {
            mode: "passive",
            slop_score: "12.4",
            axis_slop: { security: 8, accessibility: 4.4 },
            ruler: RULER,
            ranking: { cleaner_than_pct: 91.2 },
            coverage: { probes_total: 45 },
            blocked_probes: [],
            bot_challenge: false,
            challenge_stage: null,
            ...over.result,
          },
    verifiedOwner: over.verifiedOwner ?? false,
  };
}

describe("shareCardFrom", () => {
  it("summarises a finished 3.0 grade", () => {
    const card = shareCardFrom(src())!;
    expect(card).toMatchObject({ host: "myapp.dev", score: 12.4, cleanerThan: 91.2, mode: "passive", ruler: "passive-2026.2" });
    // All four 3.0 axes, an omitted axis reading as the clean zero it is.
    expect(card.axes.map((a) => [a.id, a.slop])).toEqual([
      ["security", 8],
      ["qa", 0],
      ["accessibility", 4.4],
      ["performance", 0],
    ]);
  });

  it("names the full-grade ruler for an active grade", () => {
    expect(shareCardFrom(src({ result: { mode: "active" } }))?.ruler).toBe("2026.4");
  });

  it("carries only the summary, never a finding", () => {
    const card = shareCardFrom(src())!;
    expect(Object.keys(card).sort()).toEqual(
      ["axes", "cleanerThan", "host", "mode", "provisional", "reference", "rows", "ruler", "score", "verifiedOwner"].sort(),
    );
  });

  it("refuses a grade a bot challenge withheld, whose 0 means nothing ran", () => {
    const withheld = { slop_score: 0, coverage: {}, blocked_probes: ["sec-headers-001"] };
    expect(shareCardFrom(src({ result: withheld }))).toBeNull();
    expect(shareCardFrom(src({ result: { ...withheld, blocked_probes: [], challenge_stage: "entry" } }))).toBeNull();
  });

  it("still shares a grade a challenge only interrupted, since the battery ran", () => {
    expect(shareCardFrom(src({ result: { blocked_probes: ["sec-csrf-001"] } }))).not.toBeNull();
  });

  it("refuses a grade from before 3.0, whose score does not compare", () => {
    expect(shareCardFrom(src({ result: { ruler: null } }))).toBeNull();
  });

  it("refuses an expired report, an unfinished grade and a missing score", () => {
    expect(shareCardFrom(src({ result: null }))).toBeNull();
    expect(shareCardFrom(src({ grade: { status: "running" } }))).toBeNull();
    expect(shareCardFrom(src({ grade: { status: "failed" } }))).toBeNull();
    expect(shareCardFrom(src({ result: { slop_score: null } }))).toBeNull();
  });

  it("keeps the placement on a ranked grade, whose reference only names the curve", () => {
    // Every ranked grade carries one: benchmark.rank() sets it to the curve's own description.
    const ref = "live hackathon web apps, n=1702, passive-2026.2";
    expect(shareCardFrom(src({ result: { ranking: { cleaner_than_pct: 26, reference: ref } } }))?.cleanerThan).toBe(26);
  });

  it("leaves the placement out of an unranked grade", () => {
    expect(shareCardFrom(src({ result: { ranking: null } }))?.cleanerThan).toBeNull();
  });

  it("marks a score a pending retry can still move, and a verified owner", () => {
    const card = shareCardFrom(src({ grade: { retry_due_at: "2026-09-28T12:00:00Z" }, verifiedOwner: true }))!;
    expect(card.provisional).toBe(true);
    expect(card.verifiedOwner).toBe(true);
  });
});

describe("the post", () => {
  const card = shareCardFrom(src())!;

  it("says what the number means, and stays neutral about who is posting", () => {
    expect(shareText(card)).toBe("myapp.dev scored 12.4 on Sloptic, cleaner than 91% of hackathon apps. Lower is better.");
    expect(shareTitle(card)).toBe("myapp.dev scored 12.4 on Sloptic");
  });

  it("drops a whole score's decimal the way the report does", () => {
    expect(fmtShareScore(21)).toBe("21");
    expect(fmtShareScore(21.64)).toBe("21.6");
  });

  it("reads a host from an origin", () => {
    expect(hostOf("https://myapp.dev")).toBe("myapp.dev");
    expect(hostOf("http://localhost:3000")).toBe("localhost:3000");
  });
});

describe("shareVerdict", () => {
  const at = (pct: number | null) =>
    shareVerdict({ ...shareCardFrom(src())!, cleanerThan: pct });

  it("reads the placement by range, top down", () => {
    expect(at(95)).toBe(VERDICTS[0].text);
    expect(at(90)).toBe(VERDICTS[0].text);
    expect(at(89.9)).toBe(VERDICTS[1].text);
    expect(at(50)).toBe(VERDICTS[2].text);
    expect(at(49)).toBe(VERDICTS[3].text);
    expect(at(26)).toBe(VERDICTS[4].text); // 74% of apps are cleaner: sloppier than most
    expect(at(0)).toBe(VERDICTS[5].text);
  });

  it("says nothing for an unranked grade", () => {
    expect(at(null)).toBeNull();
  });

  it("covers every placement, with ranges from high to low", () => {
    const froms = VERDICTS.map((v) => v.from);
    expect(froms).toEqual([...froms].sort((a, b) => b - a));
    expect(froms[froms.length - 1]).toBe(0);
  });
});

describe("shareTargets", () => {
  const card = shareCardFrom(src())!;
  const url = "https://sloptic.org/s/AAAAAAAAAAAAAAAAAAAAAA";
  const targets = shareTargets(url, card);
  const href = (id: string) => {
    const t = targets.find((x) => x.id === id)!;
    return new URL("href" in t ? t.href : "");
  };

  it("offers the seven platforms, Slack and Discord as copies", () => {
    expect(targets.map((t) => t.id)).toEqual(["x", "linkedin", "bluesky", "reddit", "devto", "slack", "discord"]);
    expect(targets.filter((t) => "copy" in t).map((t) => t.id)).toEqual(["slack", "discord"]);
  });

  it("builds each platform's documented share link", () => {
    expect(href("x").origin + href("x").pathname).toBe("https://x.com/intent/post");
    expect(href("x").searchParams.get("url")).toBe(url);
    expect(href("x").searchParams.get("text")).toBe(shareText(card));

    expect(href("linkedin").pathname).toBe("/sharing/share-offsite/");
    expect(href("linkedin").searchParams.get("url")).toBe(url);

    expect(href("bluesky").pathname).toBe("/intent/compose");
    expect(href("bluesky").searchParams.get("text")).toBe(`${shareText(card)} ${url}`);

    expect(href("reddit").pathname).toBe("/submit");
    expect(href("reddit").searchParams.get("url")).toBe(url);
    expect(href("reddit").searchParams.get("title")).toBe(shareTitle(card));
  });

  it("keeps the Bluesky post under its 300 character limit, even for a long host", () => {
    // 253 characters is the longest a hostname can be.
    for (const len of [60, 180, 240]) {
      const long = shareCardFrom(src({ grade: { origin: `https://${"a".repeat(len)}.dev` } }))!;
      const t = shareTargets(url, long).find((x) => x.id === "bluesky")!;
      const text = new URL("href" in t ? t.href : "").searchParams.get("text")!;
      expect([...new Intl.Segmenter().segment(text)].length).toBeLessThanOrEqual(300);
      expect(text).toContain(url);
    }
  });

  it("prefills dev.to with an unpublished draft carrying the link", () => {
    const md = href("devto").searchParams.get("prefill")!;
    expect(md.startsWith("---\ntitle: myapp.dev scored 12.4 on Sloptic\npublished: false\n")).toBe(true);
    expect(md).toContain(url);
  });

  it("never links the report itself", () => {
    for (const t of targets) if ("href" in t) expect(t.href).not.toContain("/grade/");
  });
});
