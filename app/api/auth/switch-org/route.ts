import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userOrganisations, organisations, orgGroups, orgGroupUsers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId       = (session.user as any).id    as string;
  const userRole     = (session.user as any).role  as string;
  const defaultOrgId = (session.user as any).orgId as string | null;
  const isSuperAdmin = userRole === "super_admin";

  const body = await req.json();

  // ── Group (consolidated) selection ─────────────────────────────────────────
  // Enters group mode: sets active_group_id. The consolidated views read it via
  // requireGroupScope(). We leave active_org_id untouched so exiting the group
  // returns to the last single org.
  if (body?.groupId) {
    const groupId = String(body.groupId);
    if (isSuperAdmin) {
      const [g] = await db.select({ id: orgGroups.id }).from(orgGroups).where(eq(orgGroups.id, groupId)).limit(1);
      if (!g) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    } else {
      const [grant] = await db.select({ id: orgGroupUsers.id }).from(orgGroupUsers)
        .where(and(eq(orgGroupUsers.userId, userId), eq(orgGroupUsers.groupId, groupId))).limit(1);
      if (!grant) return NextResponse.json({ error: "You do not have access to this group" }, { status: 403 });
    }
    const res = NextResponse.json({ success: true, groupId, group: true });
    res.cookies.set("active_group_id", groupId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  }

  const { orgId } = body;
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  // Super admin: can switch to ANY existing org (verify it exists).
  if (isSuperAdmin) {
    const [org] = await db.select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.id, orgId))
      .limit(1);
    if (!org) {
      return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    }
  } else {
    // Regular user: must be a member via junction table OR their default org.
    const [membership] = await db.select({ orgId: userOrganisations.orgId })
      .from(userOrganisations)
      .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId)))
      .limit(1);

    if (!membership && orgId !== defaultOrgId) {
      return NextResponse.json({ error: "You do not have access to this organisation" }, { status: 403 });
    }
  }

  const res = NextResponse.json({ success: true, orgId });
  res.cookies.set("active_org_id", orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  // Selecting a single org exits any consolidated (group) view.
  res.cookies.set("active_group_id", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
