import type { Metadata } from "next";
import BrandMark from "@/app/BrandMark";

export const metadata: Metadata = {
  title: "About Sloptic",
  description:
    "Why Sloptic exists, what it can judge, and who made it.",
};

export default function AboutPage() {
  return (
    <>
      {/* The one page where identity IS the content, so the mark leads. Not on the landing hero,
          where the masthead already carries it eighty pixels up and everything above the URL input
          is delay. */}
      <div className="page-head page-head-mark">
        <div>
          <h1>About Sloptic</h1>
          <p className="page-lead">
            Sloptic grades any running web app from outside. It does not need source code.
          </p>
        </div>
        <BrandMark size={112} className="page-head-brand" />
      </div>

      <section className="section">
        <h2 className="section-head">Why does Sloptic exist?</h2>
        <p className="section-intro">
          Building a web app got almost free, thanks to AI. And it shows. Apps ship looking finished yet never
          hardened against the real world. No security headers, inaccessible controls, dead buttons,
          uncaught errors, and more routinely show up. Such is the case of {" "}
          <a href="https://en.wikipedia.org/wiki/AI_slop" target="_blank" rel="noopener noreferrer">
          AI slop
          </a>, where AI would happily produce the happy path, and... little else.
        </p>
        <p className="section-intro">
          Yet this is not so much a slop problem so much as it is the state of the web.{" "}
          <a href="https://webaim.org/projects/million/" target="_blank" rel="noopener noreferrer">
            96% of the top million home pages
          </a>{" "}
          have noticeable accessibility failures, and that number got worse last year. Only about{" "}
          <a
            href="https://almanac.httparchive.org/en/2025/security"
            target="_blank"
            rel="noopener noreferrer"
          >
            one site in five
          </a>{" "}
          has a Content Security Policy at all. 
        </p>
        <p className="section-intro">
          It's tempting to call these minor, since none of them are break-ins. Yet you don't need a break-in
          to frustrate a user. Many apps fail in such frustrating ways, such as dead buttons, crashes, 
          and pages that take "forever" to load.
          {" "}
          <a
            href="https://scientiamobile.com/53-of-mobile-site-visitors-abandon-if-it-takes-more-than-3-seconds-to-load-page/"
            target="_blank"
            rel="noopener noreferrer"
          >
            In fact, more than half of mobile visitors
          </a>{" "}
          leave if a page takes more than 3 seconds to load — that is how high user expecations are.
        </p>
        <p className="section-intro">
          <em>Oh, and concerning the break-ins, {" "}
          <a href="https://www.veracode.com/blog/genai-code-security-report/" target="_blank" rel="noopener noreferrer">according to Veracode</a>
          , AI produces vulnerable code 45% of the time, which is alarmingly high!</em>
        </p>
        <p className="section-intro">
          These problems persist year after year. And yet nobody bothers to check because nobody is rewarded for it. 
          Only when a user complains, or a bug is filed, or a breach occurs, does anyone care. Especially in hackathons,
          where the demo is what's judged, not where most of the slop lives. 
        </p>
        <p>Hence the need for Sloptic.</p>
      </section>

      <section className="section">
        <h2 className="section-head">The name</h2>
        <div className="definition">
          <p className="definition-word">
            sloptic <span className="definition-pron">/ˈslɒp.tɪk/</span>{" "}
            <span className="definition-pos">noun</span>
          </p>
          <p className="definition-body">
            From <b>slop</b>, Merriam-Webster&apos;s word of the year for 2025, the shoddy digital
            content AI now produces in bulk, and <b>optic</b>, an instrument for bringing something
            into focus. The instrument that grades software slop, the app that ships working but
            unhardened, into one comparable score, serenely indifferent to whatever it was meant to
            be.
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">Why not a scanner?</h2>
        <p className="section-intro">
          A scanner, like Burp Suite, Nuclei, Nikto, or even PageSpeed Insights, exists to hand you a list of
          findings to fix on one app. Sloptic exists to grade and rank, so apps with nothing in common
          can be compared.
        </p>
        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                <th>most scanners</th>
                <th className="mine">Sloptic</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">what it assumes</th>
                <td>what you tell it to look for or what the app is meant to do</td>
                <td className="mine">nothing about what the app is for</td>
              </tr>
              <tr>
                <th scope="row">what it needs</th>
                <td>configuration, templates, or a spec</td>
                <td className="mine">a URL</td>
              </tr>
              <tr>
                <th scope="row">what it hands back</th>
                <td>a list of findings</td>
                <td className="mine">a score</td>
              </tr>
              <tr>
                <th scope="row">what it is for</th>
                <td>fixing one app</td>
                <td className="mine">comparing and ranking many</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">What it can and cannot judge</h2>
        <p className="section-intro">
          Sloptic only judges what is wrong no matter what an app is for. 
          It does not judge the rest, because humans judge those better anyway.
        </p>
        <div className="judge-grid">
          <div className="judge" data-kind="can">
            <h3>It can judge</h3>
            <ul>
              <li>Whether a screen reader can operate the controls</li>
              <li>Whether the page loads fast enough on a phone</li>
              <li>Whether the defenses a browser expects are set</li>
              <li>Whether a secret is sitting in the code you ship</li>
              <li>Whether links resolve and errors are handled properly</li>
              <li>Whether what is live is a finished build</li>
            </ul>
          </div>
          <div className="judge" data-kind="cannot">
            <h3>It cannot judge</h3>
            <ul>
              <li>Whether the idea is any good</li>
              <li>Whether a feature does what it claims</li>
              <li>Whether the design works for anyone</li>
              <li>How hard the thing was to build</li>
              <li>Whether the code behind it is any good</li>
              <li>Whether the app is worth using at all</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-head">Who made it</h2>
        <p className="section-intro">
          Sloptic was built and calibrated by{" "}
          <a href="https://www.linkedin.com/in/iansun20" target="_blank" rel="noopener noreferrer">
            Ian Sun
          </a>
          . He finished a computer science degree at Boston University in May 2026 and starts a
          master&apos;s in CS there the same year. He holds the PNPT and has been active in the security community, 
          having spoken at SecureWorld, Layer 8 and the NICE Conference, and hosted sessions at RSAC 2026.
        </p>
        <p className="section-intro">
          It started as an objective scorer for a hackathon league, dealing with the problem of
          judging a diverse set of web apps identically. But it evolved as its own project as this problem
          proved harder than anticipated. 
        </p>
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
          <a className="button secondary" href="https://github.com/sloptic/sloptic-main">
            View the source code
          </a>
        </div>
      </section>
    </>
  );
}
