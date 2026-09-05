/** Where a sign-in may send someone afterwards, reduced to somewhere on this origin.
 *
 *  Prefix checks do not work here, and the reason is worth stating because the obvious fix looks
 *  right: a browser DELETES tab, carriage return and line feed from a URL before it parses it. So
 *  "/<tab>/evil.com" passes "starts with one slash and not two", and the browser then resolves it
 *  as "//evil.com", which is an authority, not a path. Backslashes fold to slashes too.
 *
 *  So the string is parsed the way a browser parses it, against a sentinel origin, and kept only if
 *  it landed on that origin. What comes back is rebuilt from the parsed parts rather than echoed,
 *  so nothing unparsed survives into a Location header.
 */
const SENTINEL = "https://sloptic.invalid";

export function safeNext(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw === "") return fallback;
  // Control characters are either stripped by the browser (changing the meaning of whatever we
  // checked) or refused by header validation (a 500 on input we should have refused outright).
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;

  let u: URL;
  try {
    u = new URL(raw, SENTINEL);
  } catch {
    return fallback;
  }
  // An absolute URL, a protocol-relative one, and the backslash forms all land on another origin.
  if (u.origin !== SENTINEL) return fallback;

  const out = `${u.pathname}${u.search}${u.hash}`;
  return out.startsWith("/") ? out : fallback;
}
