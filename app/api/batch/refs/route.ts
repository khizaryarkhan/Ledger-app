/**
 * GET /api/batch/refs?entity=<id>
 *
 * Returns the valid QuickBooks values for every reference column of an entity,
 * so the import UI can render dropdowns (Customer, Supplier, Item, Account,
 * Tax Code, Class, Location, Payment Method, Terms).
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { entityRefColumns, entityRefKinds } from "@/lib/batch/ref-columns";
import { getOrgQboToken } from "@/lib/qbo-token";
import { RefResolver } from "@/lib/batch/ref-resolver";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const entity = getEntity(new URL(req.url).searchParams.get("entity") || "");
  if (!entity) return bad("Unknown entity", 404);

  const columns = entityRefColumns(entity);
  const kinds = entityRefKinds(entity);

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return ok({ columns, options: {}, connected: false });

  const resolver = new RefResolver(token);
  const options: Record<string, string[]> = {};
  await Promise.all(
    kinds.map(async (k) => { options[k] = await resolver.listNames(k); })
  );

  return ok({ columns, options, connected: true });
}
