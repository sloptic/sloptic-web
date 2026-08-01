import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sloptic — grade any deployed web app",
  description:
    "Submit a deployed web app URL and get its slop score: the security, qa, and performance floor every app should have. Passive by default.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a className="brand" href="/">
            sloptic<span className="dot">.org</span>
          </a>
          <span className="tagline">the slop, brought into focus</span>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <p>
            Passive grade only. Sloptic tests only the unauthenticated, observable surface, and only
            targets you own or are authorized to test.
          </p>
        </footer>
      </body>
    </html>
  );
}
