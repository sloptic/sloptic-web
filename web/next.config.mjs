/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API route handlers are the only server surface; no grading logic or secrets reach the client.
};

export default nextConfig;
