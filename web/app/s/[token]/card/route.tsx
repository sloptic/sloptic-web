import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { MARK_DATA_URI } from "@/lib/brand";
import { SHARE_TOKEN, loadShare } from "@/lib/share-server";
import { fmtShareScore, type ShareCard } from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The card a shared score unfurls into, in X, LinkedIn, Bluesky, Reddit, Slack and Discord.
//
// Built from the share summary and nothing else (lib/share-server.ts never loads a finding), and it
// says the two things a stranger would otherwise get wrong: that lower is better, and which battery
// ran. A clean passive score is clean on what a visitor can see, and the card names the mode so it
// never reads as "secure".
//
// Rendered per request, so the font is read at runtime and must ship with the function: see
// outputFileTracingIncludes in next.config.mjs. The site's light palette, as on the site's own card.

const PAPER = "#f3f0e6";
const SURFACE = "#faf8f0";
const INK = "#1e211b";
const MUTED = "#6b6f61";
const LINE = "#d8d3c1";
const ACCENT = "#9e530d";

const size = { width: 1200, height: 630 };

/** Long hosts are cut rather than wrapped: the layout has one line for it. */
function fitHost(host: string): string {
  return host.length > 34 ? `${host.slice(0, 33)}…` : host;
}

function Card({ card }: { card: ShareCard }) {
  const peak = Math.max(...card.axes.map((a) => a.slop), 1);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: PAPER,
        padding: "56px 72px",
        fontFamily: "PlexMono",
        color: INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK_DATA_URI} width={56} height={56} alt="" />
          <div style={{ display: "flex", fontSize: 36, letterSpacing: "-0.01em" }}>sloptic</div>
        </div>
        {card.verifiedOwner ? (
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: INK,
              border: `2px solid ${INK}`,
              borderRadius: 4,
              padding: "6px 14px",
            }}
          >
            ✓ verified owner
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 44, color: MUTED }}>{fitHost(card.host)}</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 36, marginTop: 6 }}>
          <div style={{ display: "flex", fontSize: 150, lineHeight: 1, letterSpacing: "-0.04em" }}>
            {fmtShareScore(card.score)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", paddingBottom: 14, gap: 6 }}>
            <div style={{ display: "flex", fontSize: 30 }}>slop, lower is better</div>
            {card.cleanerThan !== null ? (
              <div style={{ display: "flex", fontSize: 26, color: MUTED }}>
                cleaner than {Math.round(card.cleanerThan)}% of apps Sloptic has graded
              </div>
            ) : (
              <div style={{ display: "flex" }} />
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {card.axes.map((a) => (
          <div
            key={a.id}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              background: SURFACE,
              border: `1px solid ${LINE}`,
              borderRadius: 4,
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", fontSize: 20, color: MUTED }}>{a.label}</div>
            <div style={{ display: "flex", fontSize: 34, marginTop: 4 }}>{fmtShareScore(a.slop)}</div>
            <div style={{ display: "flex", height: 8, marginTop: 10, background: LINE, borderRadius: 4 }}>
              <div
                style={{
                  display: "flex",
                  width: `${Math.max(0, (a.slop / peak) * 100)}%`,
                  height: 8,
                  background: ACCENT,
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: 18,
          borderTop: `2px solid ${LINE}`,
          fontSize: 22,
          color: MUTED,
        }}
      >
        <div style={{ display: "flex" }}>
          {card.mode} grade · ruler {card.ruler}
          {card.provisional ? " · provisional" : ""}
        </div>
        <div style={{ display: "flex", color: INK }}>sloptic.org</div>
      </div>
    </div>
  );
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  if (!SHARE_TOKEN.test(params.token)) return new Response("Not found", { status: 404 });
  const found = await loadShare({ token: params.token });
  if (!found.ok) return new Response("Unavailable", { status: 503 });
  const card = found.share?.card;
  if (!card) return new Response("Not found", { status: 404 });

  const mono = await readFile(join(process.cwd(), "app/_fonts/IBMPlexMono-SemiBold.ttf"));
  return new ImageResponse(<Card card={card} />, {
    ...size,
    fonts: [{ name: "PlexMono", data: mono, style: "normal", weight: 600 }],
    // Short: a retry can still move a provisional score, and a deleted report must stop unfurling
    // within minutes, not days. Platforms keep their own copy of a card regardless.
    headers: { "Cache-Control": "public, max-age=600" },
  });
}
