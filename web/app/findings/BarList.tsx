/** One measure across a handful of categories: a bar per row, the count printed at its end, so the
 *  list is its own table view and the bars are decoration (hidden from assistive tech). Every bar is
 *  the same recessive colour; nothing here is singled out. Same look as the exploitable chart. */
export default function BarList({
  rows,
  label,
  total,
}: {
  rows: { label: string; n: number }[];
  label: string;
  total?: { label: string; n: number };
}) {
  const peak = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="hbar-chart" aria-label={label}>
      {rows.map((r) => (
        <li className="hbar-row" key={r.label}>
          <span className="hbar-name">{r.label}</span>
          <span className="hbar-track" aria-hidden>
            <span className="hbar-bar" style={{ width: `${(r.n / peak) * 100}%` }}>
              <span className="seg" style={{ flexGrow: 1 }} />
            </span>
          </span>
          <span className="hbar-n">{r.n.toLocaleString("en-US")}</span>
        </li>
      ))}
      {total && (
        <li className="hbar-row hbar-total">
          <span className="hbar-name">{total.label}</span>
          <span className="hbar-track" aria-hidden />
          <span className="hbar-n">{total.n.toLocaleString("en-US")}</span>
        </li>
      )}
    </ul>
  );
}
