/**
 * Admin — set/clear an organisation's branded subdomain (white-label Phase 1).
 *
 * PATCH /api/admin/organisations/:id/subdomain
 *   { subdomain: string | null }
 *
 * Empty string / null clears it (org reverts to the default app, no
 * subdomain branding). See middleware.ts + app/login/page.tsx for how this
 * is actually resolved on pre-auth pages.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/billing";

const RESERVED_SUBDOMAINS = new Set(["app", "admin", "www", "api", "mail", "static", "assets", "localhost"]);

const schema = z.object({
  subdomain: z.string().trim().toLowerCase().max(63)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and hyphens only — no leading/trailing hyphen")
    .nullable(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  // Empty string means "clear it" — treat the same as null before validating.
  const parsed = schema.safeParse({ subdomain: body?.subdomain ? body.subdomain : null });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid subdomain" }, { status: 400 });
  }
  const subdomain = parsed.data.subdomain;

  if (subdomain && RESERVED_SUBDOMAINS.has(subdomain)) {
    return NextResponse.json({ error: `"${subdomain}" is reserved and can't be used` }, { status: 400 });
  }

  const [org] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, params.id)).limit(1);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  if (subdomain) {
    const [taken] = await db.select({ id: organisations.id }).from(organisations)
      .where(and(eq(organisations.subdomain, subdomain), ne(organisations.id, params.id))).limit(1);
    if (taken) return NextResponse.json({ error: `"${subdomain}" is already in use by another organisation` }, { status: 409 });
  }

  await db.update(organisations).set({ subdomain, updatedAt: new Date() }).where(eq(organisations.id, params.id));
  return NextResponse.json({ ok: true, subdomain });
}
