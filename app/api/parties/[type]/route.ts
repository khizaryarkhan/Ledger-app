/**
 * GET/POST /api/parties/[type]  (type = customers | suppliers | employees)
 *
 * A uniform view over the three Name lists for the Accounting module, each row
 * normalised to { id, name, email, currency, source, status }. Every module
 * reads the SAME lists — source (native / qbo / xero) is a column, not a
 * separate list. POST creates a NATIVE record.
 */

import { db } from "@/db";
import { customers, apSuppliers, employees, organisations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and, isNull, desc } from "drizzle-orm";

/**
 * A blank currency at creation time defaults to the org's home currency —
 * EXCEPT when multi-currency is on, where it's left as "" (the party table's
 * currency column is NOT NULL, so "" is the "not yet set" sentinel, not
 * `null`/omitted — either of those would fall through to the column's own
 * default). The party's currency then locks to whatever its first real
 * transaction uses (see lib/accounting/documents.ts's postDocument /
 * resolvePartyCurrency, which also treat "" as unset) instead of presuming
 * home currency before the party has actually transacted in one.
 */
async function defaultCurrency(orgId: string): Promise<string> {
  const [org] = await db.select({ currency: organisations.currency, mc: organisations.multicurrencyEnabled }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (org?.mc) return "";
  return org?.currency ?? "EUR";
}

type PartyType = "customers" | "suppliers" | "employees";
const valid = (t: string): t is PartyType => t === "customers" || t === "suppliers" || t === "employees";

/**
 * GET /api/parties/[type]?native=1
 *
 * `native=1` scopes the list to records that live in the native accounting
 * app only — used by the Accounting module, which is a self-contained ledger
 * and must NOT show names that exist only because they were synced from
 * QuickBooks/Xero for the Receivable/Payable side. Without the flag the list
 * returns every record source-labeled (for the integration-facing modules).
 *
 * For customers, "native" = no qboId and no xeroId (customers has no source
 * column). For suppliers/employees, "native" = source = 'native'.
 */
export async function GET(req: Request, { params }: { params: { type: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (!valid(params.type)) return bad("Unknown list", 404);
  const nativeOnly = new URL(req.url).searchParams.get("native") === "1";

  if (params.type === "customers") {
    const where = nativeOnly
      ? and(eq(customers.orgId, orgId!), isNull(customers.qboId), isNull(customers.xeroId))
      : eq(customers.orgId, orgId!);
    const rows = await db.select().from(customers).where(where).orderBy(desc(customers.createdAt));
    return ok(rows.map(r => ({
      id: r.id, name: r.name, email: r.email ?? null, currency: r.currency || null, status: r.status,
      source: r.qboId ? "qbo" : r.xeroId ? "xero" : "native",
    })));
  }
  if (params.type === "suppliers") {
    const where = nativeOnly
      ? and(eq(apSuppliers.orgId, orgId!), eq(apSuppliers.source, "native"))
      : eq(apSuppliers.orgId, orgId!);
    const rows = await db.select().from(apSuppliers).where(where).orderBy(desc(apSuppliers.createdAt));
    return ok(rows.map(r => ({
      id: r.id, name: r.displayName || r.name, email: r.email ?? null, currency: r.currency || null, status: r.status,
      source: r.source ?? "native",
    })));
  }
  const where = nativeOnly
    ? and(eq(employees.orgId, orgId!), eq(employees.source, "native"))
    : eq(employees.orgId, orgId!);
  const rows = await db.select().from(employees).where(where).orderBy(desc(employees.createdAt));
  return ok(rows.map(r => ({
    id: r.id, name: r.name, email: r.email ?? null, currency: r.currency || null, status: r.status, source: r.source ?? "native",
  })));
}

export async function POST(req: Request, { params }: { params: { type: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  if (!valid(params.type)) return bad("Unknown list", 404);

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) return bad("Name is required");

  const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
  const email = s(body?.email);
  // No client value (blank field, or a request that raced the org-settings
  // fetch) defaults to the org's own home currency — never a hardcoded
  // literal — UNLESS multi-currency is on, where it's left unset so the
  // party's currency locks to its first real transaction instead (see
  // defaultCurrency above).
  const currency = body?.currency ? String(body.currency).trim().toUpperCase().slice(0, 8) : await defaultCurrency(orgId!);
  const paymentTerms = Number.isFinite(Number(body?.paymentTerms)) ? Math.max(0, Math.trunc(Number(body.paymentTerms))) : undefined;

  // Shared, internationally-generic contact/address fields.
  const contact = {
    firstName: s(body?.firstName, 128), lastName: s(body?.lastName, 128),
    phone: s(body?.phone, 64), mobile: s(body?.mobile, 64), website: s(body?.website),
    taxNumber: s(body?.taxNumber, 64), notes: s(body?.notes, 4000),
    addressStreet: s(body?.addressStreet), addressLine2: s(body?.addressLine2),
    addressCity: s(body?.addressCity, 128), addressState: s(body?.addressState, 128),
    addressPostcode: s(body?.addressPostcode, 32), country: s(body?.country, 64),
  };

  if (params.type === "customers") {
    const code = s(body?.code, 64) || `NAT-${Date.now().toString(36).toUpperCase()}`;
    const [row] = await db.insert(customers).values({
      orgId: orgId!, name, code, email, currency: currency ?? undefined,
      companyName: s(body?.companyName), ...contact,
      ...(paymentTerms != null ? { paymentTerms } : {}),
    } as any).returning();
    return ok({ id: row.id, name: row.name, email: row.email ?? null, currency: row.currency, status: row.status, source: "native" });
  }
  if (params.type === "suppliers") {
    const [row] = await db.insert(apSuppliers).values({
      orgId: orgId!, name, displayName: name, email, currency: currency ?? undefined, source: "native",
      ...contact, ...(paymentTerms != null ? { paymentTerms } : {}),
    } as any).returning();
    return ok({ id: row.id, name: row.displayName || row.name, email: row.email ?? null, currency: row.currency, status: row.status, source: "native" });
  }
  const [row] = await db.insert(employees).values({ orgId: orgId!, name, email, phone: contact.phone, currency, source: "native" } as any).returning();
  return ok({ id: row.id, name: row.name, email: row.email ?? null, currency: row.currency, status: row.status, source: "native" });
}
