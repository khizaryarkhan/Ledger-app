// Server-only enforcement for module-gated API routes. Kept separate from
// lib/modules.ts (which is imported by client components — nav, reports hub,
// admin modules card) so this file's `db` import never reaches a client bundle.

import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { bad } from "@/lib/api";
import { MODULES, hasModule, type ModuleKey } from "@/lib/modules";

// Mirrors requireOrg()'s { error } shape so call sites read the same way:
//   const { error: modErr } = await requireModule(orgId!, "manufacturing");
//   if (modErr) return modErr;
export async function requireModule(orgId: string, key: ModuleKey) {
  const [org] = await db.select({ enabledModules: organisations.enabledModules })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (!hasModule(org?.enabledModules, key)) {
    return { error: bad(`${MODULES[key].label} is not enabled for this organisation.`, 403) };
  }
  return { error: null };
}
