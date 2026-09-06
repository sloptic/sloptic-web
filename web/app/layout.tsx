import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import BrandMark from "./BrandMark";
import ThemeToggle from "./ThemeToggle";
import NavMenu from "./NavMenu";
import MobileNav from "./MobileNav";
import { ACCOUNT, REFERENCE } from "@/lib/nav";
import { headers } from "next/headers";
import { currentUser } from "@/lib/auth";
import "./globals.css";
import SignOutButton from "./SignOutButton";

// Instrument type: IBM Plex Sans for text, Plex Mono for the readouts. Technical, distinctive, and not
// the generic Inter/Roboto stack that reads machine-made.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono",
});

const DESCRIPTION =
  "Give Sloptic a live URL and it will score the app the way a visitor would. The lower, the better.";

// metadataBase is what makes every relative og:url and image absolute. Without it a shared link
// renders as a bare URL in Slack, Discord and iMessage, which is where report and board links
// actually travel.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sloptic.org";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  // No "%s | Sloptic" template: four pages already carry the name in their own title, and the
  // template would make them "About Sloptic | Sloptic".
  title: "Sloptic",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Sloptic",
    title: "Sloptic",
    description: DESCRIPTION,
    url: "/",
  },
  // summary_large_image now that opengraph-image.tsx exists. With "summary" the card is a small
  // square thumbnail, which crops a 1200x630 image to its middle and loses the wordmark.
  twitter: { card: "summary_large_image", title: "Sloptic", description: DESCRIPTION },
};

// Apply a stored theme choice before paint so there is no light/dark flash. No stored choice = follow
// the system, which the CSS does on its own.
const themeInit = `try{var t=localStorage.getItem('sloptic-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

// The masthead reflects sign-in state, so the layout is dynamic. Auth being unconfigured is not an
// error: the site works entirely signed-out, and only verification needs an account.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The nonce middleware minted for THIS response. Without it the CSP blocks the theme script below
  // and every visitor on a dark theme gets a flash of the light one, which is the exact thing that
  // script exists to prevent.
  const nonce = headers().get("x-nonce") ?? undefined;
  let user = null;
  try {
    user = await currentUser();
  } catch {
    user = null;
  }

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* Cookieless, same-origin page analytics: paths, referrers, country, device class. The one
            measurement the privacy policy names, and the only script the site carries. */}
        <Analytics />
        <header className="masthead">
          <a className="wordmark" href="/">
            <BrandMark size={22} />
            sloptic
          </a>
          <span className="masthead-note">checks any web app for slop</span>
          <span className="masthead-spacer" />
          <nav className="mast-nav">
            {/* The reference pages fold into one menu so the masthead stays scannable. /about is the
                first item rather than the trigger, since a control that both navigates and opens a
                menu does neither predictably. */}
            <NavMenu
              label="about"
              items={REFERENCE}
            />
            <a href="/organizers">organizers</a>
            {/* Signed OUT, the browser's own list is the only way back to a report, so it stays a
                top level link. Signed in it moves into the account menu with the rest. */}
            {user ? null : <a href="/grades">your grades</a>}
          </nav>
          {user ? (
            <div className="mast-auth">
              <NavMenu
                label={user.email ?? "account"}
                title={user.email ?? ""}
                align="right"
                items={ACCOUNT}
              >
                <SignOutButton className="nav-menu-signout" />
              </NavMenu>
            </div>
          ) : (
            <a className="mast-auth-link" href="/signin">
              sign in / up
            </a>
          )}
          <ThemeToggle />
          <MobileNav email={user?.email ?? null} />
        </header>
        <main className="sheet">{children}</main>
        <footer className="colophon">
          <div className="colophon-inner">
            <div className="colophon-brand">
              <a className="wordmark" href="/">
                <BrandMark size={20} />
                sloptic
              </a>
              <p>
                Slop grading for any app you own
              </p>
            </div>

            {/* One row, because four links stacked in a column beside the brand read as a leftover
                nav. Each is here because something depends on it: the address is the takedown route
                /terms, /privacy and the participant notice all point at, and the grader source is
                the evidence for the claim the product rests on. The page list is in the menus. */}
            <div className="colophon-bar">
              <a className="colophon-contact" href="mailto:hello@sloptic.org">
                hello@sloptic.org
              </a>
              <nav className="colophon-links" aria-label="Site">
                <a href="/terms">Terms of use</a>
                <a href="/privacy">Privacy</a>
                <a href="https://github.com/sloptic/sloptic-main">The grader in full</a>
                <a href="/about">Who made it</a>
              </nav>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
