/**
 * GET /api/batch/bulk-edit/meta?entity=<id>
 *
 * Everything the Bulk Edit UI needs to render its pickers for one entity:
 * the live Class + Location lists, the customer list (for filtering), and
 * whether the company tracks Class per line (affects how we apply it safely).
 */

import { requireOrg, ok } from "@/lib/api";
import { getEntity } from "@/lib/batch/entities";
import { getOrgQboToken } from "@/lib/qbo-token";
import { RefResolver } from "@/lib/batch/ref-resolver";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const entity = getEntity(new URL(req.url).searchParams.get("entity") || "");
  const supported = !!(entity && entity.qboEntity && entity.qboReadName && entity.supports?.modify);
  if (!supported) return ok({ supported: false, connected: false });

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) return ok({ supported: true, connected: false });

  const resolver = new RefResolver(token);
  // The customer filter only makes sense for customer transactions.
  const wantCustomers = entity!.group === "customer";
  const [classes, locations, customers, profile] = await Promise.all([
    resolver.listRefs("Class").catch(() => []),
    resolver.listRefs("Department").catch(() => []),
    wantCustomers ? resolver.listRefs("Customer").catch(() => []) : Promise.resolve([]),
    resolver.company().catch(() => null),
  ]);

  // Estimates carry a document status worth filtering on; other txns don't.
  const statuses = entity!.id === "estimate" ? ["Pending", "Accepted", "Closed", "Rejected"] : [];

  return ok({
    supported: true,
    connected: true,
    classPerLine: !!profile?.classPerLine,
    classes,
    locations,
    customers,
    statuses,
    label: entity!.label,
  });
}
