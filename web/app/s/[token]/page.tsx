import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SHARE_TOKEN, loadShare } from "@/lib/share-server";
import { shareText, shareTitle, shareVerdict, type ShareCard } from "@/lib/share";
import ScoreBand from "@/app/ScoreBand";

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
        {shareVerdict(card) && <p className="page-lead">{shareVerdict(card)}</p>}
      </div>

      {/* The report's own score band, so a shared score looks like the report it came from: the same
          big number, placement, bars and checks/points toggle. Built from counts only. */}
      <section className="section attached share-summary">
        <ScoreBand
          score={card.score}
          cleanerThanPct={card.cleanerThan}
          mode={card.mode}
          rows={card.rows}
          referenceMark={!!card.reference}
          footer={
            <>
              <div>
                {card.reference && <p className="band-footnote">* compared against {card.reference}.</p>}
              </div>
              <div className="score-chips">
                <span className="tag">{card.mode}</span>
                <span className="tag">ruler {card.ruler}</span>
                {card.verifiedOwner && <span className="tag share-owner">verified owner</span>}
                {card.provisional && <span className="tag">provisional</span>}
              </div>
            </>
          }
        />
      </section>

      <section className="section">
        <p className="section-intro">
          Sloptic checks a web app on the outside and scores on the slop no app should have.
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
