/** GET /api/search?q= — org-wide global search across every entity. */

import { requireReadScope, ok } from "@/lib/api";
import { globalSearch } from "@/lib/search";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;
  const q = new URL(req.url).searchParams.get("q") || "";
  return ok(await globalSearch(orgIds, q));
}
