/** The share controls on a report.
 *
 *  They hand out the SHARE link (/s/<token>) and never the report's own URL, which is read access to
 *  every finding and, unclaimed, the right to delete the report. They also have to stay out of the way:
 *  two controls, a menu only when asked, and nothing at all when there is no share link to give.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShareControls from "@/app/grade/[id]/ShareControls";
import type { ShareCard } from "@/lib/share";

const ID = "22222222-2222-4222-8222-222222222222";
const SHARE_URL = "https://sloptic.org/s/AAAAAAAAAAAAAAAAAAAAAA";
const CARD: ShareCard = {
  host: "myapp.dev",
  score: 12.4,
  cleanerThan: 91,
  mode: "passive",
  ruler: "passive-2026.2",
  axes: [],
  rows: [],
  reference: null,
  verifiedOwner: false,
  provisional: false,
};

let writeText: ReturnType<typeof vi.fn>;

function mockShare(status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(status === 200 ? { url: SHARE_URL } : { error: "no" }), { status })),
  );
}

beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

async function ready() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Copy link" })).not.toBeDisabled());
}

describe("ShareControls", () => {
  it("asks for this report's share link once, when it mounts", async () => {
    mockShare();
    render(<ShareControls gradeId={ID} card={CARD} />);
    await ready();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe(`/api/grade/${ID}/share`);
  });

  it("copies the share link, never the report's URL", async () => {
    mockShare();
    render(<ShareControls gradeId={ID} card={CARD} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("opens a menu of the platforms on a desktop, every link carrying the share link", async () => {
    mockShare();
    const { container } = render(<ShareControls gradeId={ID} card={CARD} />);
    await ready();
    const toggle = screen.getByRole("button", { name: /Share/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const links = [...container.querySelectorAll(".share-menu a")] as HTMLAnchorElement[];
    expect(links.map((a) => a.textContent)).toEqual(["X", "LinkedIn", "Bluesky", "Reddit", "dev.to"]);
    for (const a of links) {
      expect(a.href).toContain(encodeURIComponent(SHARE_URL));
      expect(a.href).not.toContain("/grade/");
      expect(a.rel).toContain("noopener");
    }
    fireEvent.click(screen.getByRole("button", { name: "Copy link for Slack" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL));
    expect(await screen.findByRole("button", { name: "Copied. Paste it in Slack." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link for Discord" })).toBeInTheDocument();
  });

  it("closes the menu on Escape", async () => {
    mockShare();
    render(<ShareControls gradeId={ID} card={CARD} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Share/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: /Share/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("adds no note under the buttons, whoever keeps the report", async () => {
    mockShare();
    render(<ShareControls gradeId={ID} card={CARD} />);
    await ready();
    expect(screen.queryByText(/stops working|shows the score, not the report/)).toBeNull();
  });

  it("renders nothing when there is no share link to give", async () => {
    mockShare(503);
    const { container } = render(<ShareControls gradeId={ID} card={CARD} />);
    await waitFor(() => expect(container.querySelector(".share")).toBeNull());
  });
});
