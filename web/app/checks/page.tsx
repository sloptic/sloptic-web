import type { Metadata } from "next";
import { AREAS, CATALOG_URL, TOTALS, categoriesFor } from "@/lib/checks";

export const metadata: Metadata = {
  title: "Every check Sloptic runs",
  description:
    "The full catalog by category: how many checks each covers, and which run on any URL versus which need you to verify the site is yours.",
};

const ACCESS_TEXT: Record<string, string> = {
  open: "any URL",
  gated: "verified only",
  mixed: "part verified",
};

export default function ChecksPage() {
  return (
    <>
      <div className="page-head">
        <h1>Every check</h1>
        <p className="page-lead">
          The catalog is {TOTALS.total} checks across {AREAS.reduce((n, a) => n + a.categories, 0)}{" "}
          kinds of fault. Each check is a single file in the{" "}
          <a href={CATALOG_URL} target="_blank" rel="noopener noreferrer">
            open grader
          </a>
          , and this page is generated from it.
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">The counts</h2>
        <p className="section-intro">
          {TOTALS.passive} of the {TOTALS.total} run on any URL. The remaining {TOTALS.active} send
          test traffic, so they run only once you have shown the site is yours.
        </p>
        <div className="table-scroll">
          <table className="count-table">
            <thead>
              <tr>
                <th>area</th>
                <th>kinds</th>
                <th>runs on any URL</th>
                <th>needs verification</th>
                <th>total</th>
              </tr>
            </thead>
            <tbody>
              {AREAS.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    <span className="measure-swatch" data-axis={a.id} aria-hidden />
                    {a.label}
                  </th>
                  <td>{a.categories}</td>
                  <td>{a.passive}</td>
                  <td>{a.probes - a.passive}</td>
                  <td>{a.probes}</td>
                </tr>
              ))}
              <tr className="total-row">
                <th scope="row">all</th>
                <td>{AREAS.reduce((n, a) => n + a.categories, 0)}</td>
                <td>{TOTALS.passive}</td>
                <td>{TOTALS.active}</td>
                <td>{TOTALS.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="section-intro" style={{ marginTop: "1.5rem" }}>
          The share swings by area because that is where the attack traffic lives. Performance is
          almost all observation, while security mostly isn't.
        </p>
      </section>

      {AREAS.map((area) => (
        <section className="section" key={area.id} id={area.id}>
          <h2 className="section-head">
            <span className="measure-swatch" data-axis={area.id} aria-hidden /> {area.label}
          </h2>
          <p className="section-intro">
            {area.categories} kinds of fault, {area.probes} checks between them. Click on a link to learn more about it.
          </p>
          <div className="table-scroll">
            <table className="cat-table">
              <thead>
                <tr>
                  <th>what it looks for</th>
                  <th>checks</th>
                  <th>runs on</th>
                </tr>
              </thead>
              <tbody>
                {categoriesFor(area.id).map((c) => (
                  <tr key={c.slug} data-access={c.access}>
                    <th scope="row">
                      {c.href ? (
                        <a href={c.href} target="_blank" rel="noopener noreferrer" className="probe-link">
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                    </th>
                    <td>{c.probes}</td>
                    <td className="access">
                      {c.access === "mixed"
                        ? `${c.passive} of ${c.probes} on any URL`
                        : ACCESS_TEXT[c.access]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="section">
        <h2 className="section-head">Why a kind holds several checks</h2>
        <p className="section-intro">
          A kind of fault is often represented by several checks because a single technique proving nothing is not the same
          as the fault being absent. Injection gets tried several ways before Sloptic will say it found
          nothing. Those still collapse to one finding when they fire, so a kind with five checks cannot
          cost you five times.
        </p>
        <div className="cta-row">
          <a className="button" href="/">
            Grade an app
          </a>
          <a className="button secondary" href="/verify">
            Why only some run
          </a>
        </div>
      </section>
    </>
  );
}
