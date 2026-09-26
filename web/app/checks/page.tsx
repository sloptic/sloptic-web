import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import {
  AREAS,
  CATALOG_URL,
  TOTALS,
  categoryName,
  groupSiblings,
  measuredText,
  priceLabel,
  probesFor,
  rungSentence,
  type ProbeFact,
} from "@/lib/checks";

export const metadata: Metadata = pageMeta(
  "Sloptic's checks",
  `The ${TOTALS.total} checks Sloptic runs, grouped by kind of slop. ${TOTALS.passive} run on any URL and the other ${TOTALS.active} need you to verify your site or event.`,
  "/checks",
);

/** The grader's report-card copy marks code with backticks. */
function Expected({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
    </>
  );
}

/** Everything about a check's price that the number alone does not say, one line each. */
function PriceNotes({ f }: { f: ProbeFact }) {
  const notes: string[] = [];
  const rungs = rungSentence(f);
  if (rungs) notes.push(rungs);
  const measured = measuredText(f);
  if (measured) notes.push(measured);
  if (f.pricing.kind === "off") notes.push("Shown on the report, but adds nothing to the score.");
  if (f.raised) {
    const when = f.raised.when.map(categoryName).sort().join(" or ");
    notes.push(`Raised to ${f.raised.to} in a grade that also finds ${when}.`);
  }
  const siblings = groupSiblings(f);
  if (siblings.length) {
    notes.push(
      `The same flaw as ${siblings.join(", ")}, found a different way. Only the highest priced of them counts.`,
    );
  }
  if (!notes.length) return null;
  return (
    <ul className="probe-notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export default function ChecksPage() {
  return (
    <>
      <div className="page-head">
        <h1>Sloptic's checks</h1>
        <p className="page-lead">
          The catalog comprises {TOTALS.total} checks across {AREAS.reduce((n, a) => n + a.categories, 0)}{" "}
          different kinds of slop. Each check is a single file in the{" "}
          <a href={CATALOG_URL} target="_blank" rel="noopener noreferrer">
            open grader
          </a>
          .
        </p>
      </div>

      <section className="section">
        <h2 className="section-head">The counts</h2>
        <p className="section-intro">
          {TOTALS.passive} of the {TOTALS.total} run on any URL. The remaining {TOTALS.active} send
          test traffic, so they only run once you verify your site or event.
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
          Every check below has a price in points, which is what it adds to the score when it finds slop.
          Most have one price. Some start low and rise when the check proves worse harm, some are priced
          by what they measure, and a few are shown on the report without counting. Repeats are damped
          before they reach the score, which{" "}
          <a href="/methodology#scoring">How Sloptic finds slop</a> explains.
        </p>
      </section>

      {AREAS.map((area) => (
        <section className="section" key={area.id} id={area.id}>
          <h2 className="section-head">
            <span className="measure-swatch" data-axis={area.id} aria-hidden /> {area.label}
          </h2>
          <p className="section-intro">
            {area.categories} different faults, {area.probes} checks between them.
          </p>
          <div className="probe-wrap">
            <table className="probe-table">
              <thead>
                <tr>
                  <th>check</th>
                  <th>runs on</th>
                  <th>points</th>
                </tr>
              </thead>
              {probesFor(area.id).map(({ category, probes }) => (
                <tbody key={category.slug}>
                  <tr className="probe-cat">
                    <th colSpan={3} scope="colgroup">
                      {category.href ? (
                        <a href={category.href} target="_blank" rel="noopener noreferrer" className="probe-link">
                          {category.name}
                        </a>
                      ) : (
                        category.name
                      )}
                    </th>
                  </tr>
                  {probes.map((f) => (
                    <tr key={f.id} id={f.id} data-kind={f.pricing.kind}>
                      <td className="probe-what">
                        <span className="probe-expected">
                          {f.expected ? <Expected text={f.expected} /> : category.name}
                        </span>
                        <span className="probe-id">{f.id}</span>
                        <PriceNotes f={f} />
                      </td>
                      <td className="probe-runs" data-label="runs on">
                        {f.passive ? "any URL" : "verified only"}
                      </td>
                      <td className="probe-points" data-label="points">
                        {priceLabel(f.pricing)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
