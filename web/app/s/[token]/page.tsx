import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SHARE_TOKEN, loadShare } from "@/lib/share-server";
import { fmtShareScore, shareText, shareTitle, type ShareCard } from "@/lib/share";
import BarList from "@/app/findings/BarList";

export const dynamic = "force-dynamic";

// A shared score: the summary of a grade, reached by its share token, never by its report id.
//
// Shows exactly what the card image shows and nothing else. The report behind it (every finding,
// and while unclaimed the right to delete it) stays with whoever holds the report link, and nothing
// on this page leads there. Kept out of search: a score someone posted is theirs to post, not ours
// to index.

async function find(token: string) {
  if (!SHARE_TOKEN.test(token)) return null;
  const found = await loadShare({ token });
  if (!found.ok) throw new Error(`share lookup failed: ${found.reason}`);
  return found.share;
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const robots = { index: false, follow: false };
  let card: ShareCard | null = null;
  try {
    card = (await find(params.token))?.card ?? null;
  } catch {
    card = null;
  }
  if (!card) return { title: "Sloptic", robots };
  const title = shareTitle(card);
  const description = shareText(card);
  const image = { url: `/s/${params.token}/card`, width: 1200, height: 630, alt: description };
  return {
    title,
    description,
    robots,
    openGraph: { type: "website", siteName: "Sloptic", title, description, url: `/s/${params.token}`, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SharePage({ params }: { params: { token: string } }) {
  const share = await find(params.token);
  if (!share) notFound();

  const card = share.card;
  if (!card) {
    return (
      <>
        <div className="page-head">
          <h1>Score unavailable</h1>
          <p className="page-lead">The report behind this link has expired or was deleted.</p>
        </div>
        <section className="section">
          <div className="cta-row">
            <a className="button" href="/">
              Grade your app
            </a>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <p className="share-kicker">A Sloptic grade</p>
        <h1 className="share-host">{card.host}</h1>
      </div>

      <section className="section share-summary">
        <div className="share-score">
          <span className="score-fig">{fmtShareScore(card.score)}</span>
          <span className="score-cap">slop, lower is better</span>
        </div>
        {card.cleanerThan !== null && (
          <p className="share-place">
            cleaner than <b>{Math.round(card.cleanerThan)}%</b> of{" "}
            {card.mode === "active" ? "actively" : "passively"} graded apps
          </p>
        )}
        <BarList
          label="slop by axis"
          format={fmtShareScore}
          rows={card.axes.map((a) => ({ label: a.label, n: a.slop }))}
        />
        <div className="share-tags">
          <span className="tag">{card.mode}</span>
          <span className="tag">ruler {card.ruler}</span>
          {card.verifiedOwner && <span className="tag share-owner">verified owner</span>}
          {card.provisional && <span className="tag">provisional</span>}
        </div>
        <p className="section-intro fineprint">
          {card.mode === "active"
            ? "An active grade also runs attack checks, with the owner's permission."
            : "A passive grade reads only what any visitor can see."}
          {card.provisional && " A retry is pending, so this score can still change."}
        </p>
      </section>

      <section className="section">
        <p className="section-intro">
          Sloptic grades a deployed web app from the outside. It scores the slop no app should have.
        </p>
        <div className="cta-row">
          <a className="button" href="/">
            Grade your app
          </a>
          <a className="button secondary" href="/methodology">
            How Sloptic finds slop
          </a>
        </div>
      </section>
    </>
  );
}
