/** GET /api/accounting/fx-exposure?asOf=YYYY-MM-DD → foreign-currency positions + home carrying. */

import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq } from "drizzle-orm";
import { fxExposure } from "@/lib/accounting/fx";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [org] = await db.select({ home: organisations.currency }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  const home = org?.home ?? "PKR";
  const asOf = new URL(req.url).searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
  return ok({ home, asOf, rows: await fxExposure(orgId!, asOf, home) });
}
