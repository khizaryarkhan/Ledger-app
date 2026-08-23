/**
 * PATCH  /api/parties/[type]/[id]  → edit a native customer/supplier/employee
 * DELETE /api/parties/[type]/[id]  → delete, guarded until a transaction uses it
 *
 * House rule: editable/deletable until something depends on it. Deactivate via
 * PATCH { status: "Inactive" } when the record can't be deleted.
 */

import { db } from "@/db";
import { customers, apSuppliers, employees } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { partyReferences, blockerMessage } from "@/lib/inventory/references";
import { NextResponse } from "next/server";

type PartyType = "customers" | "suppliers" | "employees";
const valid = (t: string): t is PartyType => t === "customers" || t === "suppliers" || t === "employees";
const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

const CONTACT = ["firstName", "lastName", "phone", "mobile", "website", "taxNumber", "notes",
  "addressStreet", "addressLine2", "addressCity", "addressState", "addressPostcode", "country"] as const;

export async function GET(_req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (!valid(params.type)) return bad("Unknown list", 404);
  const table = params.type === "customers" ? customers : params.type === "suppliers" ? apSuppliers : employees;
  const [row] = await db.select().from(table as any).where(and(eq((table as any).id, params.id), eq((table as any).orgId, orgId!))).limit(1);
  if (!row) return bad("Not found", 404);
  return ok({ ...row, name: (row as any).displayName || row.name });
}

export async function PATCH(req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  if (!valid(params.type)) return bad("Unknown list", 404);
  const b = await req.json().catch(() => ({}));

  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.name !== undefined) { const n = s(b.name); if (!n) return bad("Name is required"); set.name = n; }
  if (b.email !== undefined) set.email = s(b.email);
  if (b.currency !== undefined) set.currency = b.currency ? String(b.currency).trim().toUpperCase().slice(0, 8) : null;
  if (b.status !== undefined) set.status = b.status === "Inactive" ? "Inactive" : "Active";
  if (b.paymentTerms !== undefined && Number.isFinite(Number(b.paymentTerms))) set.paymentTerms = Math.max(0, Math.trunc(Number(b.paymentTerms)));

  if (params.type === "employees") {
    if (b.phone !== undefined) set.phone = s(b.phone, 64);
    await db.update(employees).set(set).where(and(eq(employees.id, params.id), eq(employees.orgId, orgId!)));
    return ok({ id: params.id, updated: true });
  }
  // customers & suppliers share the generic contact/address fields.
  for (const k of CONTACT) if (b[k] !== undefined) set[k] = s(b[k], k === "notes" ? 4000 : 255);
  if (b.companyName !== undefined) set.companyName = s(b.companyName);
  if (params.type === "customers") {
    await db.update(customers).set(set).where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!)));
  } else {
    if (set.name !== undefined) set.displayName = set.name;
    await db.update(apSuppliers).set(set).where(and(eq(apSuppliers.id, params.id), eq(apSuppliers.orgId, orgId!)));
  }
  return ok({ id: params.id, updated: true });
}

export async function DELETE(_req: Request, { params }: { params: { type: string; id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  if (!valid(params.type)) return bad("Unknown list", 404);
  const blockers = await partyReferences(orgId!, params.type, params.id);
  if (blockers.length) return NextResponse.json({ error: blockerMessage(params.type.slice(0, -1), blockers), blockers }, { status: 409 });
  const table = params.type === "customers" ? customers : params.type === "suppliers" ? apSuppliers : employees;
  await db.delete(table).where(and(eq((table as any).id, params.id), eq((table as any).orgId, orgId!)));
  return ok({ id: params.id, deleted: true });
}
