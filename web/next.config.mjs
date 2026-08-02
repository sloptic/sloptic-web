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
};

export default nextConfig;
