import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import {
  AREAS,
  CATALOG_URL,
  TOTALS,
  categorySpan,
  priceLabel,
  priceNotes,
  probeName,
  probesFor,
  rungsFor,
  sharedRungs,
  type ProbeFact,
} from "@/lib/checks";

export const metadata: Metadata = pageMeta(
  "Sloptic's checks",
  `The ${TOTALS.total} checks Sloptic runs, grouped by kind of slop. ${TOTALS.passive} run on any URL and the other ${TOTALS.active} need you to verify your site or event.`,
  "/checks",
);

/** Names mark code with backticks. */
function Code({ text }: { text: string }) {
  return <>{text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>;
}

/** A ladder's rungs: points in a column, what it takes beside them. */
function Rungs({ rungs }: { rungs: { points: number; text: string }[] }) {
  return (
    <dl className="probe-rungs">
      {rungs.map((r) => (
        <div key={r.points}>
          <dt>{r.points}</dt>
          <dd>{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One check: its name, where it runs and its price, then what lifts or sets the price. A ladder the
 *  whole category shares is shown once for the category, so the row leaves it out. */
function ProbeRow({ f, shared }: { f: ProbeFact; shared: boolean }) {
  const rungs = shared ? [] : rungsFor(f);
  const notes = priceNotes(f);
  return (
    <li className="probe-row" id={f.id} data-kind={f.pricing.kind}>
      <span className="probe-name">
        <Code text={probeName(f)} />
      </span>
      <span className="probe-runs">{f.passive ? "any URL" : "verified"}</span>
      <span className="probe-points">{priceLabel(f.pricing)}</span>
      <span className="probe-id">{f.id}</span>
      {rungs.length > 0 && <Rungs rungs={rungs} />}
      {notes.length > 0 && (
        <ul className="probe-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ChecksPage() {
  return (
    <>
      <div className="page-head">
        <h1>Sloptic's checks</h1>
        <p className="page-lead">
          Sloptic runs {TOTALS.total} checks across {AREAS.reduce((n, a) => n + a.categories, 0)} kinds of
          slop. Each check is one file in the{" "}
          <a href={CATALOG_URL} target="_blank" rel="noopener noreferrer">
            open grader
          </a>
          .
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">The counts</h2>
        <p className="section-intro">
          {TOTALS.passive} of the {TOTALS.total} run on any URL. The other {TOTALS.active} send test traffic.
          They only run on a verified site or event.
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
      </section>

      {/* Every number in the tables below is generated from the pinned grader
          (scripts/generate-checks.py); only the words around them are written here. */}
      <section className="section" id="points">
        <h2 className="section-head">What each check costs</h2>
        <p className="section-intro">
          Each check has a price in points. Most have one price. Some rise with proof of worse harm. Some are
          measured. A few count nothing. Repeats count less.{" "}
          <a href="/methodology#scoring">How Sloptic finds slop</a> has the rules.
        </p>
      </section>

      {/* One category open at a time, page wide: every <details> shares a name, which makes the browser
          close the open one. Browsers without exclusive accordions just allow several open. */}
      {AREAS.map((area) => (
        <section className="section" key={area.id} id={area.id}>
          <h2 className="section-head">
            <span className="measure-swatch" data-axis={area.id} aria-hidden /> {area.label}
          </h2>
          <p className="section-intro">
            {area.categories} kinds of slop, {area.probes} checks. Open a kind to see its checks.
          </p>
          <div className="probe-cats">
            {probesFor(area.id).map(({ category, probes }) => {
              const shared = sharedRungs(probes);
              return (
                <details
                  className="cat-group probe-cat"
                  name="checks"
                  key={category.slug}
                  id={`kind-${category.slug}`}
                >
                  <summary className="cat-head">
                    <span className="cat-arrow" aria-hidden>
                      ▸
                    </span>
                    <span className="cat-title">
                      {category.name} <span className="cat-count">{probes.length}</span>
                    </span>
                    <span className="probe-cat-span">{categorySpan(probes)}</span>
                  </summary>
                  <div className="probe-cat-body">
                    <div className="probe-cols" aria-hidden>
                      <span>check</span>
                      <span>runs on</span>
                      <span>points</span>
                    </div>
                    <ul className="probe-list">
                      {probes.map((f) => (
                        <ProbeRow f={f} shared={shared !== null} key={f.id} />
                      ))}
                    </ul>
                    {shared && (
                      <div className="probe-shared">
                        <p>Proof raises the price:</p>
                        <Rungs rungs={shared} />
                      </div>
                    )}
                    {category.href && (
                      <p className="probe-cat-more">
                        <a href={category.href} target="_blank" rel="noopener noreferrer">
                          About {category.name}
                        </a>
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
