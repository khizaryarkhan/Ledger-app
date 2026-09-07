/** @type {import('next').NextConfig} */

const securityHeaders = [
  // HSTS — force HTTPS for 2 years, covers all subdomains
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Clickjacking protection
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't send full referrer to third-party sites
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down browser features we don't use
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // DNS prefetch for performance
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Restrict Server Actions to our own domains only — prevents CSRF from
    // third-party sites calling our mutations directly.
    serverActions: {
      allowedOrigins: [
        "primeaccountax.com",
        "app.primeaccountax.com",
        "admin.primeaccountax.com",
        // White-label Phase 1: any org's branded subdomain (e.g.
        // aberny.primeaccountax.com). Requires a wildcard domain attached to
        // the Vercel project — see CLAUDE.md's white-label note.
        "*.primeaccountax.com",
        "localhost:3000",
      ],
    },
    // Next 14 key (was incorrectly set as top-level `serverExternalPackages`,
    // which Next 14 ignores). Keep heavy server-only deps out of the bundle.
    serverComponentsExternalPackages: ["openai", "imapflow", "mailparser", "nodemailer"],
  },
  async headers() {
    return [
      {
        // Apply security headers to every route
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  // Phase 1a module IA restructure (see CLAUDE.md): Production renamed to
  // Supply Chain and absorbed Receiving/Shipping/BOM from Accounting.
  // Permanent (308) redirects so existing bookmarks, emails and links to the
  // old paths keep working. app/api/** is untouched — only these page routes
  // moved, and the mobile app calls the API directly, never these pages.
  async redirects() {
    return [
      { source: "/production", destination: "/supply-chain", permanent: true },
      { source: "/production/build", destination: "/supply-chain/build", permanent: true },
      { source: "/accounting/receiving", destination: "/supply-chain/receiving", permanent: true },
      { source: "/accounting/shipping", destination: "/supply-chain/shipping", permanent: true },
      { source: "/accounting/bom", destination: "/supply-chain/bom", permanent: true },
      // Customer/Supplier are shared master data owned by Receivables/Payables
      // respectively (see CLAUDE.md) — Accounting's thinner third copy of
      // these two screens was retired in favour of pointing straight at the
      // real ones; these keep old bookmarks/links working.
      { source: "/accounting/parties/customers", destination: "/customers", permanent: true },
      { source: "/accounting/parties/customers/:id", destination: "/customers/:id", permanent: true },
      { source: "/accounting/parties/suppliers", destination: "/payables/suppliers", permanent: true },
      { source: "/accounting/parties/suppliers/:id", destination: "/payables/suppliers/:id", permanent: true },
    ];
  },
};

// Only wrap with Sentry's build plugin when a DSN is configured, so the build
// is completely unchanged (zero risk) until you opt in by setting SENTRY_DSN.
// Source-map upload runs only when SENTRY_AUTH_TOKEN is also set; without it
// the build still succeeds (upload is skipped).
if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const { withSentryConfig } = require("@sentry/nextjs");
  module.exports = withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    widenClientFileUpload: true,
    disableLogger: true,
  });
} else {
  module.exports = nextConfig;
}
