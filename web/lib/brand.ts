/** The mark, in one place, as SVG source.
 *
 *  What it says: inside the lens are four cells, three identical and one that is not. That is the
 *  product in a shape. A grader looks at a population of near-identical apps and reports the thing
 *  that does not conform, and the odd cell is a triangle because ▲ already reads as a flag and
 *  because curved-versus-angular is the difference that survives being shrunk, where a difference
 *  in size or shade does not.
 *
 *  It is also an argument about its own subject. The documented signatures of AI slop are uniform
 *  border radius, perfect symmetry, and a smooth plastic sameness across unrelated products. So the
 *  mark is asymmetric, the handle sits at 34 degrees rather than 45, and no joint is rounded. A
 *  smooth centred gradient glyph on a product named after slop would be self-parody.
 *
 *  The favicon is a REDUCED version of this and lives in app/icon.svg, because at 16px the lens
 *  interior is about eight real pixels across and four cells become one smudge. It keeps the lens
 *  and one triangle. Kept as a separate file rather than derived, since Next serves app/icon.svg by
 *  filename convention and cannot import from here.
 */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g fill="none" stroke="#1e211b" stroke-linecap="butt">
    <circle cx="27" cy="27" r="22" stroke-width="4.5"/>
    <path d="M43.5 42.5 L60 57" stroke-width="6.5"/>
  </g>
  <g fill="#6b6f61">
    <circle cx="19" cy="19" r="5.5"/>
    <circle cx="35" cy="19" r="5.5"/>
    <circle cx="19" cy="35" r="5.5"/>
  </g>
  <path d="M35 28.6 L41.2 39.9 L28.8 39.9 Z" fill="#9e530d"/>
</svg>`;

/** The mark as a data URI.
 *
 *  Satori (what next/og renders with) does not take an inline <svg> element, but it does take an
 *  <img> whose src is a data URI, so this is how the mark reaches the OG card. Base64 rather than
 *  percent-encoding: the raw source contains `#` and `"`, which break a naive url() unescaped.
 */
export const MARK_DATA_URI =
  `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;
