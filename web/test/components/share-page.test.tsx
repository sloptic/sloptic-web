// @vitest-environment node
/** The share page and its card image, rendered from a stubbed lookup.
 *
 *  The card is the easy thing to break without noticing: the image renderer (satori) refuses any box
 *  with several children that is not display:flex, and the failure only shows as a blank unfurl in
 *  someone else's Slack. So it is rendered here for real, for each state it has to draw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShareCard } from "@/lib/share";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";
const CARD: ShareCard = {
  host: "myapp.dev",
  score: 12.4,
  cleanerThan: 91.2,
  mode: "passive",
  ruler: "passive-2026.2",
  axes: [
    { id: "security", label: "security", slop: 8 },
    { id: "qa", label: "quality", slop: 0 },
    { id: "accessibility", label: "accessibility", slop: 4.4 },
    { id: "performance", label: "performance", slop: 0 },
  ],
  rows: [
    { id: "security", label: "security", failed: 3, applied: 16, possible: 17, slop: 8, potential: 200 },
    { id: "qa", label: "quality", failed: 0, applied: 13, possible: 13, slop: 0, potential: 90 },
    { id: "accessibility", label: "accessibility", failed: 1, applied: 3, possible: 3, slop: 4.4, potential: 40 },
    { id: "performance", label: "performance", failed: 0, applied: 11, possible: 12, slop: 0, potential: 90 },
  ],
  reference: "live hackathon web apps, n=1702, passive-2026.2",
  verifiedOwner: false,
  provisional: false,
};

let answer: unknown;
vi.mock("@/lib/share-server", () => ({
  SHARE_TOKEN: /^[A-Za-z0-9_-]{22}$/,
  loadShare: async () => answer,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const found = (card: ShareCard | null) => ({ ok: true, share: { grade: { id: "x" }, card } });

const { default: SharePage, generateMetadata } = await import("@/app/s/[token]/page");
const { GET } = await import("@/app/s/[token]/card/route");

async function page(token = TOKEN) {
  return renderToStaticMarkup(await SharePage({ params: { token } }));
}

beforeEach(() => {
  answer = found(CARD);
});

describe("the share page", () => {
  it("shows the report's own score band: host, score, placement, axis counts, mode and ruler", async () => {
    const html = await page();
    for (const s of ["myapp.dev", "12.4", "cleaner than", "91%", "security", "quality", "accessibility", "passive-2026.2", "score-band"]) {
      expect(html).toContain(s);
    }
    // the checks view's failed / applied / available, as the report prints it
    expect(html).toMatch(/3<span class="of">\/16<\/span><span class="of dim">\/17<\/span>/);
    expect(html).toContain("* compared against live hackathon web apps, n=1702, passive-2026.2.");
  });

  it("links nowhere near the report", async () => {
    expect(await page()).not.toContain("/grade/");
  });

  it("marks a verified owner and a provisional score", async () => {
    answer = found({ ...CARD, verifiedOwner: true, provisional: true });
    const html = await page();
    expect(html).toContain('<span class="tag share-owner">verified owner</span>');
    expect(html).toContain('<span class="tag">provisional</span>');
  });

  it("says a score is unavailable once its report is gone", async () => {
    answer = found(null);
    const html = await page();
    expect(html).toContain("Score unavailable");
    expect(html).not.toContain("12.4");
  });

  it("is a 404 for a token no grade carries, and for a malformed one", async () => {
    answer = { ok: true, share: null };
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(page("../grade/x")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("unfurls with the card image, and stays out of search", async () => {
    const meta = await generateMetadata({ params: { token: TOKEN } });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.openGraph).toMatchObject({ images: [{ url: `/s/${TOKEN}/card`, width: 1200, height: 630 }] });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect(meta.title).toBe("myapp.dev scored 12.4 on Sloptic");
  });
});

describe("the card image", () => {
  const png = async () => {
    const res = await GET(new Request(`http://localhost/s/${TOKEN}/card`), { params: { token: TOKEN } });
    return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
  };

  it.each([
    ["an ordinary passive grade", CARD],
    ["a verified owner's provisional active grade", { ...CARD, mode: "active" as const, ruler: "2026.4", verifiedOwner: true, provisional: true }],
    ["an unranked grade with a very long host", { ...CARD, cleanerThan: null, host: `${"a".repeat(80)}.example.com` }],
    ["a clean app", { ...CARD, score: 0, axes: CARD.axes.map((a) => ({ ...a, slop: 0 })) }],
  ])("renders a PNG for %s", async (_name, card) => {
    answer = found(card);
    const { res, bytes } = await png();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    // The PNG signature, and a real image rather than an empty frame.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it("is a 404 when there is no score to draw", async () => {
    answer = found(null);
    expect((await png()).res.status).toBe(404);
  });
});
