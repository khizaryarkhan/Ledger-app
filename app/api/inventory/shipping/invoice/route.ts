/** POST /api/inventory/shipping/invoice → create an Invoice from shipments (revenue only). */

import { requireOrg, ok, bad } from "@/lib/api";
import { invoiceFromShipments, type InvoiceFromShipmentsInput } from "@/lib/inventory/shipping";
import { LedgerValidationError } from "@/lib/ledger";

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const body = (await req.json().catch(() => ({}))) as InvoiceFromShipmentsInput;
  try {
    const res = await invoiceFromShipments(orgId!, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[shipping] invoice failed:", e);
    return bad("Failed to create invoice", 500);
  }
}
