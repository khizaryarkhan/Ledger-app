import { headers } from "next/headers";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { LoginForm } from "@/components/login-form";

// White-label Phase 1: middleware.ts sets x-org-subdomain (pure string
// parsing, no DB — it's deliberately Edge-safe) when the request host is
// <subdomain>.primeaccountax.com. The actual org lookup happens here, in
// the Node runtime, where DB access is normal. No match (no header, or the
// subdomain isn't assigned to any org) → default Prime Accountax branding.
async function resolveBrand(): Promise<{ name: string; logo: string | null }> {
  const sub = headers().get("x-org-subdomain");
  if (!sub) return { name: "Prime Accountax", logo: null };
  try {
    const [org] = await db
      .select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl })
      .from(organisations)
      .where(eq(organisations.subdomain, sub))
      .limit(1);
    if (!org) return { name: "Prime Accountax", logo: null };
    return { name: org.displayName || org.name, logo: org.logoUrl ?? null };
  } catch {
    // Branding is cosmetic — never let a lookup failure block the login page.
    return { name: "Prime Accountax", logo: null };
  }
}

export default async function LoginPage() {
  const brand = await resolveBrand();
  return <LoginForm brandName={brand.name} brandLogo={brand.logo} />;
}
