/** The Content Security Policy, as a pure function so it can be asserted on.
 *
 *  Extracted from the middleware because one of its branches is security relevant: the policy is
 *  strictly tighter in production than in development, and a refactor that loses that distinction
 *  would ship 'unsafe-eval' to real visitors without failing anything. Sloptic prices a weak CSP
 *  itself (sec-csp-001), so shipping one here is the kind of thing the product exists to catch.
 */

/** @param nonce  fresh per response, or it is not a nonce
 *  @param dev    true only under `next dev`; see the script-src note below */
export function policy(nonce: string, dev: boolean): string {
  // 'unsafe-eval' in DEVELOPMENT ONLY. Next's dev bundler evaluates every module as a string, so a
  // policy without it kills the entire client bundle: React never hydrates, and every interactive
  // control on the site (the theme toggle, the nav menu, the grade form) is dead on localhost while
  // production works fine. That is a nasty way to lose an afternoon, because the page still renders,
  // it just does nothing.
  const evalForDevBundler = dev ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    // strict-dynamic is what makes this workable: scripts Next loads from its own nonced loader
    // inherit trust, so the chunk filenames do not have to be enumerated here. Older browsers that
    // do not know strict-dynamic fall back to 'self'.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'${evalForDevBundler}`,
    // style-src keeps 'unsafe-inline' and that is a deliberate limit rather than an oversight: React
    // writes inline style attributes (the progress bars and score bars here are width percentages)
    // and no nonce reaches those. Inline STYLE is not script execution, which is why the grader
    // judges script-src and not this.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The API routes talk to Supabase from the SERVER, but the browser client signs in directly.
    "connect-src 'self' https://*.supabase.co https://*.supabase.in",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
