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
import { qboQueryTop } from "@/lib/batch/qbo-client";

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
  const [classes, locations, customers, profile, sample] = await Promise.all([
    resolver.listRefs("Class").catch(() => []),
    resolver.listRefs("Department").catch(() => []),
    wantCustomers ? resolver.listRefs("Customer").catch(() => []) : Promise.resolve([]),
    resolver.company().catch(() => null),
    qboQueryTop(token, entity!.qboReadName!, 20).catch(() => [] as any[]),
  ]);

  // Discover the company's custom fields from a sample of recent records — QBO
  // exposes them per-transaction as CustomField[{DefinitionId,Name,Type}]. We
  // union across the sample so all defined fields show even if some are blank.
  const cfMap = new Map<string, { definitionId: string; name: string }>();
  for (const rec of sample) {
    for (const cf of (rec?.CustomField || [])) {
      if (cf?.DefinitionId && cf?.Name && (cf.Type ?? "StringType") === "StringType") {
        cfMap.set(String(cf.DefinitionId), { definitionId: String(cf.DefinitionId), name: String(cf.Name) });
      }
    }
  }
  const customFields = [...cfMap.values()];

  // BillEmail exists on customer sales transactions.
  const supportsEmail = entity!.group === "customer";

  // Estimates carry a document status worth filtering on; other txns don't.
  const statuses = entity!.id === "estimate" ? ["Pending", "Accepted", "Closed", "Rejected"] : [];

  return ok({
    supported: true,
    connected: true,
    classPerLine: !!profile?.classPerLine,
    classes,
    locations,
    customers,
    customFields,
    supportsEmail,
    statuses,
    label: entity!.label,
  });
}
