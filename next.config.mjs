/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Playwright drives the dev server over 127.0.0.1; silence the dev-only
  // cross-origin warning so a clean boot has no noise.
  allowedDevOrigins: ["127.0.0.1"],
  // F08-T03 — the server-side PDF route launches the Playwright-provided
  // Chromium. Playwright resolves its browser binary and driver from the
  // installed package, so it must be loaded from node_modules at runtime, not
  // bundled into the route chunk. Externalizing the playwright packages is
  // what keeps /api/opsp/:id/pdf able to find the browser the E2E suite
  // already installs.
  serverExternalPackages: ["@playwright/test", "playwright", "playwright-core"],
};

export default nextConfig;