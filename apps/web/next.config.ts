import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Every locale of src/i18n/routing.ts (LOCALES in @kitoko/i18n), as a path prefix. Spelled out because the config is
// loaded before workspace TypeScript is compiled.
const LOCALE_PREFIXES = ["/en", "/fr", "/it", "/es", "/pt"];

const privateHeaders = [
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Robots-Tag", value: "noindex" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

// Deployed on Vercel. Dynamic rendering throughout (no Cache Components): every page reads live bookings.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
    // The pro page's cover renditions: phone, phone 2x, desktop, large desktop, retina desktop.
    deviceSizes: [390, 780, 1280, 1920, 2560],
  },
  transpilePackages: [
    "@kitoko/agent",
    "@kitoko/booking",
    "@kitoko/channels",
    "@kitoko/db",
    "@kitoko/i18n",
    "@kitoko/mcp",
    "@kitoko/paypal",
    "@kitoko/themes",
    "@kitoko/ui",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // Deposit pages and the pro dashboard carry a booking or a session: never cache, index or leak them.
      ...["", ...LOCALE_PREFIXES].map((prefix) => ({ source: `${prefix}/pay/:path*`, headers: privateHeaders })),
      { source: "/dashboard/:path*", headers: privateHeaders },
      { source: "/dashboard", headers: privateHeaders },
    ];
  },
};

export default createNextIntlPlugin()(nextConfig);
