import type { BoardRow } from "./BoardTable";

/** The shape of a field, above the table.
 *
 *  A board is a wall of rows otherwise, and the questions an organizer actually has are about the
 *  field: how spread out it is, where the middle sits, whether the top is genuinely good or merely
 *  the best of a weak set. Everything here is computed from the rows on the board, so it always
 *  describes exactly what is shown.
 */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const f1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function BoardStats({ rows }: { rows: BoardRow[] }) {
  const slop = rows.map((r) => r.slop).sort((a, b) => a - b);
  if (slop.length === 0) return null;

  const n = slop.length;
  const mean = slop.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(slop.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const min = slop[0];
  const max = slop[n - 1];
  const q1 = quantile(slop, 0.25);
  const med = quantile(slop, 0.5);
  const q3 = quantile(slop, 0.75);

  const lh = rows.map((r) => r.lighthouse).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const lhMed = lh.length ? quantile(lh, 0.5) : null;

  // Bins across the field's own range, so a tight field is not one bar and a wide one is not fifty.
  const BINS = 10;
  const width = Math.max(1, Math.ceil((max - min) / BINS)) || 1;
  const lo = Math.floor(min / width) * width;
  const bins: { from: number; to: number; n: number }[] = [];
  for (let b = lo; b <= max; b += width) {
    bins.push({ from: b, to: b + width, n: slop.filter((v) => v >= b && v < b + width).length });
  }
  if (bins.length) bins[bins.length - 1].n = slop.filter((v) => v >= bins[bins.length - 1].from).length;
  const peak = Math.max(1, ...bins.map((b) => b.n));

  return (
    <div className="board-stats">
      <ul className="stat-tiles">
        <li><span className="k">{f1(med)}</span><span className="v">median slop</span></li>
        <li><span className="k">{f1(mean)}</span><span className="v">mean</span></li>
        <li><span className="k">{f1(sd)}</span><span className="v">standard deviation</span></li>
        <li><span className="k">{f1(min)}</span><span className="v">best</span></li>
        <li><span className="k">{f1(max)}</span><span className="v">worst</span></li>
        {lhMed !== null && (
          <li><span className="k">{Math.round(lhMed)}</span><span className="v">median Lighthouse</span></li>
        )}
      </ul>

      <figure className="chart board-hist">
        <svg viewBox={`0 0 720 ${140 + 26}`} role="img"
             aria-label={`Slop across ${n} graded entries, from ${f1(min)} to ${f1(max)}, median ${f1(med)}.`}>
          {bins.map((b, i) => {
            const w = 720 / bins.length;
            const h = (b.n / peak) * 140;
            return (
              <g key={b.from}>
                <title>{`${b.from} to ${b.to}: ${b.n} ${b.n === 1 ? "entry" : "entries"}`}</title>
                <rect x={i * w + 1} y={140 - h} width={w - 2} height={h} rx="3" className="bar" />
              </g>
            );
          })}
          <line x1="0" y1="140" x2="720" y2="140" className="axis" />
          <g className="tick">
            <text x="0" y="158">{f1(bins[0]?.from ?? min)}</text>
            <text x="720" y="158" textAnchor="end">{f1(max)} slop</text>
          </g>
        </svg>
      </figure>

      <p className="section-intro fineprint">
        Middle half of the field between {f1(q1)} and {f1(q3)}. {n} entries graded.
      </p>
    </div>
  );
}
