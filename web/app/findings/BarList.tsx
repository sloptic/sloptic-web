/** One measure across a handful of categories: a bar per row, the count printed at its end, so the
 *  list is its own table view and the bars are decoration (hidden from assistive tech). Bars are
 *  recessive unless a row is `hot`, which is emphasis for the rows the prose is about, never a hue
 *  per row. Same look as the exploitable chart. */
export default function BarList({
  rows,
  label,
  total,
  format,
}: {
  rows: { label: string; n: number; hot?: boolean }[];
  label: string;
  total?: { label: string; n: number };
  format?: (n: number) => string;
}) {
  const show = format ?? ((n: number) => n.toLocaleString("en-US"));
  const peak = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="hbar-chart" aria-label={label}>
      {rows.map((r) => (
        <li className="hbar-row" key={r.label}>
          <span className="hbar-name">{r.label}</span>
          <span className="hbar-track" aria-hidden>
            <span className="hbar-bar" data-hot={r.hot ? "accent" : undefined} style={{ width: `${(r.n / peak) * 100}%` }}>
              <span className="seg" style={{ flexGrow: 1 }} />
            </span>
          </span>
          <span className="hbar-n">{show(r.n)}</span>
        </li>
      ))}
      {total && (
        <li className="hbar-row hbar-total">
          <span className="hbar-name">{total.label}</span>
          <span className="hbar-track" aria-hidden />
          <span className="hbar-n">{show(total.n)}</span>
        </li>
      )}
    </ul>
  );
}
