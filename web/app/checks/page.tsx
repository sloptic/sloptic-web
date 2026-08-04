import type { Metadata } from "next";
import { CHANNELS, TOTALS, CATALOG_URL, type Check } from "@/lib/checks";

export const metadata: Metadata = {
  title: "Every check Sloptic runs",
  description:
    "The full catalog: how many checks there are, how they split across security, accessibility and quality, and performance, and which ones need you to verify the site is yours.",
};

function CheckList({ items }: { items: Check[] }) {
  return (
    <ul className="probe-list">
      {items.map((c) => (
        <li key={c.name} className="probe-item">
          <span className="probe-id" aria-hidden>
            +
          </span>
          {c.href ? (
            <a href={c.href} target="_blank" rel="noopener noreferrer" className="probe-link">
              {c.name}
            </a>
          ) : (
            c.name
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ChecksPage() {
  return (
    <>
      <div className="page-head">
        <h1>Every check</h1>
        <p className="page-lead">
          The catalog is {TOTALS.total} checks. Each one is a single file in the{" "}
          <a href={CATALOG_URL} target="_blank" rel="noopener noreferrer">
            open grader
          </a>
          , so none of the numbers here are ours to assert: you can go count them.
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
                <th>runs on any URL</th>
                <th>needs verification</th>
                <th>total</th>
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map((ch) => (
                <tr key={ch.id}>
                  <th scope="row">
                    <span className="measure-swatch" data-axis={ch.id} aria-hidden />
                    {ch.label}
                  </th>
                  <td>{ch.passive}</td>
                  <td>{ch.total - ch.passive}</td>
                  <td>{ch.total}</td>
                </tr>
              ))}
              <tr className="total-row">
                <th scope="row">all</th>
                <td>{TOTALS.passive}</td>
                <td>{TOTALS.active}</td>
                <td>{TOTALS.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="section-intro" style={{ marginTop: "1.5rem" }}>
          The share swings by area because that is where the attack traffic lives. Performance is
          almost all observation; security mostly is not.
        </p>
      </section>

      {CHANNELS.map((ch) => (
        <section className="section" key={ch.id} id={ch.id}>
          <h2 className="section-head">
            <span className="measure-swatch" data-axis={ch.id} aria-hidden /> {ch.label}
          </h2>
          <p className="section-intro">{ch.blurb}</p>
          <p className="probe-group-label">Runs on any URL ({ch.passive})</p>
          <CheckList items={ch.open} />
          <p className="probe-group-label" style={{ marginTop: "1.25rem" }}>
            Needs you to verify the site is yours ({ch.total - ch.passive})
          </p>
          <CheckList items={ch.gated} />
        </section>
      ))}

      <section className="section">
        <h2 className="section-head">Why the list is shorter than the count</h2>
        <p className="section-intro">
          Each area above names the kinds of thing Sloptic looks at, not all {TOTALS.total} checks one
          by one. A single kind, injection say, is several checks: one per technique it has to try
          before it can honestly report nothing found. The catalog has the full list.
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
