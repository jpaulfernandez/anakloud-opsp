/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Playwright drives the dev server over 127.0.0.1; silence the dev-only
  // cross-origin warning so a clean boot has no noise.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;