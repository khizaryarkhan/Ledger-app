/**
 * GET /api/estimates — list all estimates for the org
 * Optional query params: customerId, projectId, status
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { estimates, customers, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrg } from "@/lib/api";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const projectId  = searchParams.get("projectId");
  const status     = searchParams.get("status");

  const conditions = [eq(estimates.orgId, orgId!)];
  if (customerId) conditions.push(eq(estimates.customerId, customerId));
  if (projectId)  conditions.push(eq(estimates.projectId, projectId));
  if (status)     conditions.push(eq(estimates.status, status));

  const rows = await db
    .select({
      estimate: estimates,
      customerName: customers.name,
      projectName:  projects.name,
    })
    .from(estimates)
    .leftJoin(customers, eq(estimates.customerId, customers.id))
    .leftJoin(projects,  eq(estimates.projectId,  projects.id))
    .where(and(...conditions))
    .orderBy(estimates.estimateDate);

  return NextResponse.json(rows);
}
