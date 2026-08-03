import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import ThemeToggle from "./ThemeToggle";
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
    "Give Sloptic a live URL and get one number for how well the app holds up: the security, accessibility, and performance floor every app should have. Passive by default.",
};

// Apply a stored theme choice before paint so there is no light/dark flash. No stored choice = follow
// the system, which the CSS does on its own.
const themeInit = `try{var t=localStorage.getItem('sloptic-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <header className="masthead">
          <a className="wordmark" href="/">
            sloptic
          </a>
          <span className="masthead-note">black-box web app grader</span>
          <span className="masthead-spacer" />
          <ThemeToggle />
        </header>
        <main className="sheet">{children}</main>
        <footer className="colophon">
          <p>
            Passive check only. Sloptic reads the unauthenticated, observable surface, and only apps
            you own or are authorized to test.
          </p>
        </footer>
      </body>
    </html>
  );
}
