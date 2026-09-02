import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import ThemeToggle from "./ThemeToggle";
import NavMenu from "./NavMenu";
import MobileNav from "./MobileNav";
import { ACCOUNT, REFERENCE } from "@/lib/nav";
import { currentUser } from "@/lib/auth";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Sloptic",
  description:
    "Give Sloptic a live URL and get one number for how well the app holds up, the security, accessibility, and performance floor every app should have. Passive by default.",
};

// Apply a stored theme choice before paint so there is no light/dark flash. No stored choice = follow
// the system, which the CSS does on its own.
const themeInit = `try{var t=localStorage.getItem('sloptic-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

// The masthead reflects sign-in state, so the layout is dynamic. Auth being unconfigured is not an
// error: the site works entirely signed-out, and only verification needs an account.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let user = null;
  try {
    user = await currentUser();
  } catch {
    user = null;
  }

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <header className="masthead">
          <a className="wordmark" href="/">
            sloptic
          </a>
          <span className="masthead-note">grades any live web app</span>
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
                <form action="/auth/signout" method="post" className="nav-menu-signout">
                  <button type="submit">Sign out</button>
                </form>
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
                sloptic
              </a>
              <p>
                One number for how well a deployed web app holds up, on the same scale for every app.
              </p>
              <a className="colophon-contact" href="mailto:hello@sloptic.org">
                hello@sloptic.org
              </a>
              <p className="colophon-legal">
                <a href="/terms">Terms of use</a> <span aria-hidden>·</span>{" "}
                <a href="/privacy">Privacy</a>
              </p>
            </div>

            {/* Four links, and each is here because something depends on it.
                The address is the takedown route /terms, /privacy and the participant notice all
                tell people to write to, so it has to be findable from any page. The grader source is
                evidence for the claim the whole product rests on, that the method is open and
                checkable. Terms and privacy are where people look for them.
                The page list that used to sit here is in the menus now. */}
            <nav className="colophon-links" aria-label="Site">
              <a href="https://github.com/sloptic/sloptic-main">The grader, in full</a>
              <a href="/about">Who made it</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
