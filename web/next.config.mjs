import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Load the monorepo ROOT .env so the web package and the worker share one env file. Next still also
// reads web/.env.local for local overrides (those take precedence: dotenv here does not clobber Next's).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "..", ".env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API route handlers are the only server surface; no grading logic or secrets reach the client.

  // Next sends `x-powered-by: Next.js` by default, which names the framework and its major to anyone
  // choosing an exploit. Sloptic grades that (sec-headers-006) and we were serving it.
  poweredByHeader: false,

  // The headers that are the same on every response, set HERE rather than in middleware because
  // middleware deliberately skips _next/static, and the static chunks are most of what a browser
  // actually loads. Grading ourselves found the missing nosniff on every one of them.
  //
  // The CSP is not here: it carries a per-request nonce, so it belongs in middleware.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stops a browser from second-guessing our content types, which is how a .txt or a JSON
          // response becomes executable script.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // A report URL is a capability. Sending it to another origin in a Referer header would hand
          // that capability away, so cross-origin requests carry the origin and nothing more.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing here is meant to be framed, and clickjacking a grade form is clickjacking a
          // request to point traffic at someone's server. CSP frame-ancestors says the same thing to
          // modern browsers; this covers the rest.
          { key: "X-Frame-Options", value: "DENY" },
          // We use none of these. Saying so costs nothing and shrinks what an injected script could
          // ask the browser for.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
