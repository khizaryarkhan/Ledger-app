import { auth } from "@/auth.config";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isAuth = !!req.auth;
  const path = req.nextUrl.pathname;
  const role = (req.auth?.user as any)?.role;

  const host = req.headers.get("host") || "";

  // ── admin.primeaccountax.com → admin portal subdomain ───────────────────────
  // Clean URLs: admin.primeaccountax.com/leads → internal /admin/leads.
  // Unauthenticated users get a dedicated admin login page (not the main app login).
  if (host === "admin.primeaccountax.com" && !path.startsWith("/api/") && !path.startsWith("/_next/")) {
    // Allow the admin login page itself (don't auth-gate it)
    if (path === "/login" || path === "/admin-login") {
      const url = req.nextUrl.clone();
      url.pathname = "/admin-login";
      return NextResponse.rewrite(url);
    }
    if (!isAuth) {
      return NextResponse.redirect(new URL("/login", "https://admin.primeaccountax.com"));
    }
    if (role !== "platform_admin" && role !== "super_admin") {
      // Non-admin authenticated users: show a clear rejection page
      return NextResponse.redirect(new URL("/login", "https://admin.primeaccountax.com"));
    }
    // / → /admin, /leads → /admin/leads, /admin/leads stays as-is
    const url = req.nextUrl.clone();
    url.pathname = path === "/"
      ? "/admin"
      : path.startsWith("/admin") ? path : `/admin${path}`;
    return NextResponse.rewrite(url);
  }

  // ── *.vercel.app → "under development in Foodready" placeholder ─────────────
  // The auto-generated Vercel URL shows a coming-soon page so the app isn't
  // browsable there. The real domain (primeaccountax.com) serves the app
  // normally. /api/* is left alone so webhooks, cron, and OAuth callbacks work.
  if (
    process.env.VERCEL_ENV === "production" &&
    host.endsWith(".vercel.app") &&
    !path.startsWith("/api/")
  ) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Foodready — Coming soon</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0c0a09;color:#fafaf9;padding:24px}
      .card{max-width:520px;text-align:center}
      .badge{display:inline-block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a8a29e;border:1px solid #292524;border-radius:999px;padding:6px 14px;margin-bottom:28px}
      h1{font-size:30px;font-weight:700;line-height:1.25;margin-bottom:14px}
      p{font-size:16px;line-height:1.6;color:#d6d3d1}
      .brand{color:#34d399;font-weight:600}
      .foot{margin-top:32px;font-size:13px;color:#78716c}
    </style></head><body><div class="card">
      <span class="badge">Coming soon</span>
      <h1>Receivable flows are now under development in <span class="brand">Foodready</span></h1>
      <p>This module is being built into the Foodready platform. Check back soon.</p>
      <div class="foot">Foodready</div>
    </div></body></html>`;
    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  // Public token-authenticated portals — no login required
  const isPortal = path.startsWith("/portal/") || path.startsWith("/api/portal/")
    || path.startsWith("/owner-portal/") || path.startsWith("/api/owner-portal/")
    || path.startsWith("/approver/") || path.startsWith("/api/approver/");
  const isLegal = path === "/privacy" || path === "/terms";
  const isHome = path === "/"; // public marketing landing (Google verification needs this)
  // Public SEO / marketing pages (solution landing pages + blog)
  const MARKETING_PATHS = new Set([
    "/accounts-receivable-software-for-quickbooks",
    "/accounts-receivable-software-for-xero",
    "/credit-control-software",
    "/automated-invoice-reminders",
    "/customer-payment-portal",
  ]);
  const isMarketing =
    path === "/blog" ||
    path.startsWith("/blog/") ||
    path === "/alternatives" ||
    path.endsWith("-alternative") ||
    MARKETING_PATHS.has(path);
  const isPublic = isHome || isMarketing || path === "/login" || path === "/admin-login" || path === "/forgot-password" || path === "/reset-password" || path === "/register" || path === "/register/success" || path.startsWith("/api/register") || path.startsWith("/api/auth") || path.startsWith("/api/mobile/auth") || path.startsWith("/api/public/") || path === "/api/qbo/callback" || path === "/api/xero/callback" || path === "/api/gmail/callback" || path === "/api/microsoft/callback" || path === "/api/debug-auth" || path === "/api/interest" || path === "/api/health" || isPortal || isLegal;
  // Cron/webhook paths bypass session auth (they authenticate via CRON_SECRET /
  // signed payloads instead). The sequence processor lives under /api/admin for
  // historical reasons but is a Vercel cron — let it through so it actually runs.
  // /api/inngest authenticates every request itself via HMAC signature
  // verification against INNGEST_SIGNING_KEY (built into the Inngest SDK's
  // serve() handler) — it was never supposed to need our session cookie at
  // all. Without this bypass, every request Inngest's servers made (both the
  // app-sync/introspection call and every actual function invocation) hit
  // this middleware first and got a blanket 401 before Inngest's own auth
  // ever ran. Confirmed live 2026-09-06: Inngest's dashboard showed dozens of
  // failed sync attempts going back to at least 9/3, all with "We could not
  // reach your URL" — meaning self-chained background processing has
  // effectively never worked in production; every job that ever completed
  // did so only via a manual nudge or the client-side fallback poke, not
  // real self-healing.
  const isCron = path.startsWith("/api/cron") || path.startsWith("/api/webhooks") || path === "/api/admin/sequences/process" || path === "/api/inngest";
  const isApi = path.startsWith("/api/");
  const isRepPortal = path === "/rep-portal" || path.startsWith("/rep-portal/");
  const isAdmin = path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/");

  if (isCron) return NextResponse.next();

  if (isPublic) {
    if (isAuth) {
      // Logged-in users skip the login page and go straight to the app.
      // ("/" is the public marketing site — everyone can view it.)
      if (path === "/login" || path === "/register") {
        const dest = role === "rep" ? "/rep-portal" : "/dashboard";
        return NextResponse.redirect(new URL(dest, req.nextUrl));
      }
    }
    return NextResponse.next();
  }

  // The mobile app authenticates via `Authorization: Bearer <token>` instead
  // of the session cookie (`req.auth` only ever sees the cookie), so it never
  // satisfies isAuth here. Let any bearer-carrying API request through to its
  // route handler — requireOrg()/requireAuth() in lib/api.ts do the real,
  // DB-backed verification of that token. An invalid/expired bearer token
  // still gets rejected, just by the route itself instead of by this blanket
  // check, matching what already happens for cookie sessions.
  const hasBearerAuth = isApi && /^Bearer\s+/i.test(req.headers.get("authorization") || "");

  if (!isAuth && !hasBearerAuth) {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // Admin panel — platform_admin and super_admin only
  if (isAdmin) {
    if (role !== "platform_admin" && role !== "super_admin") {
      if (isApi) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
    return NextResponse.next();
  }

  // Rep users can only access /rep-portal and /api routes
  if (role === "rep") {
    if (!isRepPortal && !isApi) {
      return NextResponse.redirect(new URL("/rep-portal", req.nextUrl));
    }
    return NextResponse.next();
  }

  // Non-rep admin/users cannot access rep portal
  if (isRepPortal && role !== "rep") {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  // "/" is the public landing page — let it render even for logged-in users.
  // They can click "Open dashboard" from there.
  return NextResponse.next();
});

export const config = {
  // Exclude assets that must be served raw (never auth-redirected):
  //  - kill-switch service worker scripts (real JavaScript)
  //  - SEO files: robots.txt, sitemap.xml, and the generated OG image
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|service-worker.js|robots.txt|sitemap.xml|opengraph-image).*)",
  ],
};
