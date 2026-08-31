import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import ThemeToggle from "./ThemeToggle";
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
            <a href="/about">about</a>
            <a href="/checks">checks</a>
            <a href="/organizers">organizers</a>
            <a href="/methodology">methodology</a>
          </nav>
          {user ? (
            <form action="/auth/signout" method="post" className="mast-auth">
              <span className="mast-user" title={user.email ?? ""}>
                {user.email}
              </span>
              <button type="submit">sign out</button>
            </form>
          ) : (
            <a className="mast-auth-link" href="/signin">
              sign in
            </a>
          )}
          <ThemeToggle />
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
            </div>

            <div className="colophon-col">
              <h4>grade</h4>
              <ul>
                <li>
                  <a href="/">Grade an app</a>
                </li>
                <li>
                  <a href="/#checks">What it checks</a>
                </li>
                <li>
                  <a href="/checks">Every check</a>
                </li>
                <li>
                  <a href="/#sample">What you get back</a>
                </li>
                <li>
                  <a href="/verify">Why only some run</a>
                </li>
              </ul>
            </div>

            <div className="colophon-col">
              <h4>understand</h4>
              <ul>
                <li>
                  <a href="/#what">What is Sloptic</a>
                </li>
                <li>
                  <a href="/#score">The score</a>
                </li>
                <li>
                  <a href="/methodology">How grading works</a>
                </li>
              </ul>
            </div>

            <div className="colophon-col">
              <h4>use it</h4>
              <ul>
                <li>
                  <a href="/about">About Sloptic</a>
                </li>
                <li>
                  <a href="/organizers">For organizers</a>
                </li>
                <li>
                  <a href="https://github.com/sloptic/sloptic-main">The grader</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="colophon-bar">
            <div className="colophon-bar-inner">
              <span>Sloptic 2026</span>
              <span>Only test apps you own or are authorized to test.</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
