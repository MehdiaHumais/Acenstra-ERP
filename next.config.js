/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets `next dev` use a separate output folder (NEXT_DIST_DIR=.next-dev) so it
  // can run alongside a production `next start` without overwriting its build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  eslint: { ignoreDuringBuilds: true },
  // Allow the browser to open the dev server via 127.0.0.1 as well as localhost.
  // Without this, Next.js logs cross-origin warnings for /_next/* resources and
  // can block asset loads when the app is opened via the IP address.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Heavy demo dataset + cold SQLite open makes route-module evaluation exceed
  // the 60s default on slow machines; page-data collection then fails the build.
  staticPageGenerationTimeout: 300,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        // The service worker must always be revalidated so a new build can
        // replace stale cached assets instead of running old JavaScript.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
