/**
 * GET/POST /api/parties/[type]  (type = customers | suppliers | employees)
 *
 * A uniform view over the three Name lists for the Accounting module, each row
 * normalised to { id, name, email, currency, source, status }. Every module
 * reads the SAME lists — source (native / qbo / xero) is a column, not a
 * separate list. POST creates a NATIVE record.
 */

import { db } from "@/db";
import { customers, apSuppliers, employees } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and, isNull, desc } from "drizzle-orm";

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
      id: r.id, name: r.name, email: r.email ?? null, currency: r.currency ?? null, status: r.status,
      source: r.qboId ? "qbo" : r.xeroId ? "xero" : "native",
    })));
  }
  if (params.type === "suppliers") {
    const where = nativeOnly
      ? and(eq(apSuppliers.orgId, orgId!), eq(apSuppliers.source, "native"))
      : eq(apSuppliers.orgId, orgId!);
    const rows = await db.select().from(apSuppliers).where(where).orderBy(desc(apSuppliers.createdAt));
    return ok(rows.map(r => ({
      id: r.id, name: r.displayName || r.name, email: r.email ?? null, currency: r.currency ?? null, status: r.status,
      source: r.source ?? "native",
    })));
  }
  const where = nativeOnly
    ? and(eq(employees.orgId, orgId!), eq(employees.source, "native"))
    : eq(employees.orgId, orgId!);
  const rows = await db.select().from(employees).where(where).orderBy(desc(employees.createdAt));
  return ok(rows.map(r => ({
    id: r.id, name: r.name, email: r.email ?? null, currency: r.currency ?? null, status: r.status, source: r.source ?? "native",
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
  const email = body?.email ? String(body.email).trim() : null;
  const currency = body?.currency ? String(body.currency).trim().toUpperCase().slice(0, 8) : null;

  if (params.type === "customers") {
    const code = `NAT-${Date.now().toString(36).toUpperCase()}`; // native customers need a code
    const [row] = await db.insert(customers).values({ orgId: orgId!, name, code, email, currency: currency ?? undefined } as any).returning();
    return ok({ id: row.id, name: row.name, email: row.email ?? null, currency: row.currency, status: row.status, source: "native" });
  }
  if (params.type === "suppliers") {
    const [row] = await db.insert(apSuppliers).values({ orgId: orgId!, name, displayName: name, email, currency: currency ?? undefined, source: "native" } as any).returning();
    return ok({ id: row.id, name: row.displayName || row.name, email: row.email ?? null, currency: row.currency, status: row.status, source: "native" });
  }
  const [row] = await db.insert(employees).values({ orgId: orgId!, name, email, currency, source: "native" }).returning();
  return ok({ id: row.id, name: row.name, email: row.email ?? null, currency: row.currency, status: row.status, source: "native" });
}
