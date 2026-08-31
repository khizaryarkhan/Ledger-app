/**
 * Invoice chasing Inngest functions.
 *
 * chaseScheduler   — cron 08:00 UTC daily → fans out one event per org
 * runOrgChase      — handles one org in isolation (retried independently)
 * brokenPromiseSweep — marks overdue Active promises as Broken
 *
 * Each contact is wrapped in its own step.run() so:
 *   • On retry, already-sent contacts are memoised and skipped automatically.
 *   • A failed contact does not block the rest of the org.
 *   • nextSendAt is only advanced AFTER a confirmed successful send.
 */

import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import {
  invoices, contacts, customers, projects,
  emailTemplates, communications, organisations, invoicePromises,
  jobWorkOrders, tradeDocuments, manufacturingOrders, supplyChainAlerts,
} from "@/db/schema";
import type { EmailTemplate } from "@/db/schema";
import { eq, and, or, isNull, isNotNull, lte, lt, ne, notInArray, inArray } from "drizzle-orm";
import { sendEmail, hasEmailTransport } from "@/lib/mailer";
import { requireActiveSubscription } from "@/lib/billing";
import { fetchQboInvoicePdf } from "@/lib/qbo-token";
import { fetchXeroInvoicePdf } from "@/lib/xero-token";
import { createPortalToken } from "@/lib/portal";
import { genEmailRef } from "@/lib/email-ref";
import { renderInvoiceEmail } from "@/lib/ar-email";

// ─── helpers (mirrors cron/route.ts) ────────────────────────────────────────

function daysFromDate(dateStr: string): number {
  const due = new Date(dateStr + "T12:00:00Z").getTime();
  return Math.floor((Date.now() - due) / 86400000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

const PAUSE_STAGES = ["Disputed", "On Hold", "Promised", "Promise to Pay"];

function fillTemplate(template: string, name: string, invoiceLines: string[], ref: string): string {
  return template
    .replace(/\{name\}/gi, name)
    .replace(/\{invoicelines\}/gi, invoiceLines.join("\n"))
    .replace(/\{ref\}/gi, ref);
}

// ─── 1. Scheduler ────────────────────────────────────────────────────────────

export const chaseScheduler = inngest.createFunction(
  { id: "chase-scheduler", triggers: [{ cron: "0 8 * * *" }] },
  async ({ step }) => {
    const orgs = await step.run("fetch-orgs", () =>
      db.select({ id: organisations.id }).from(organisations),
    );

    if (orgs.length === 0) return { queued: 0 };

    await inngest.send(
      orgs.map(org => ({ name: "invoice/chase-org" as const, data: { orgId: org.id } })),
    );

    return { queued: orgs.length };
  },
);

// ─── 2. Per-org chase ────────────────────────────────────────────────────────

export const runOrgChase = inngest.createFunction(
  { id: "run-org-chase", retries: 2, triggers: [{ event: "invoice/chase-org" }] },
  async ({ event, step }) => {
    const { orgId } = event.data;
    const now = new Date();
    let emailsSent = 0;
    let skipped = 0;
    const errors: string[] = [];

    const hasTransport = await step.run("check-transport", () => hasEmailTransport(orgId));
    if (!hasTransport) return { orgId, skipped: 1, reason: "no-transport" };

    // Gate on subscription — cancelled/unpaid orgs must not receive chase emails
    const { access: subAccess, status: subStatus } = await step.run("check-subscription", () =>
      requireActiveSubscription(orgId),
    ) as { access: string; status?: string };
    if (subAccess === "blocked" || subAccess === "readonly") {
      return { orgId, skipped: 1, reason: `subscription-${subAccess}` };
    }

    const orgTemplates = await step.run("load-templates", (): Promise<EmailTemplate[]> =>
      db.select().from(emailTemplates)
        .where(and(eq(emailTemplates.orgId, orgId), eq(emailTemplates.isActive, true))),
    ) as unknown as EmailTemplate[];

    const templateByStage = new Map<string, EmailTemplate>(
      orgTemplates.filter(t => t.collectionStage).map(t => [t.collectionStage!, t]),
    );
    if (templateByStage.size === 0) return { orgId, skipped: 1, reason: "no-templates" };

    // Scoped to this org only — no longer loads all orgs' invoices
    const orgInvoices = await step.run("load-invoices", () =>
      db.select().from(invoices).where(eq(invoices.orgId, orgId)),
    );

    const dueContacts = await step.run("load-due-contacts", () =>
      db.select().from(contacts).where(and(
        eq(contacts.orgId, orgId),
        eq(contacts.receivesAuto, true),
        or(isNull(contacts.nextSendAt), lte(contacts.nextSendAt, now)),
      )),
    );

    const enabledContacts = dueContacts.filter(c => c.email);

    for (const contact of enabledContacts) {
      // Each contact is its own memoised step — on retry, already-sent
      // contacts are skipped automatically by Inngest.
      const result = await step.run(`contact-${contact.id}`, async (): Promise<{ outcome: "sent" | "skipped" }> => {
        const relatedInvoices = orgInvoices.filter(inv => {
          if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") return false;
          if ((inv.total - (inv.paid || 0)) <= 0) return false;
          if (PAUSE_STAGES.includes(inv.collectionStage)) return false;
          if ((inv as any).automationsPaused) return false;
          if (contact.projectId) return inv.projectId === contact.projectId;
          return inv.customerId === contact.customerId;
        });

        if (relatedInvoices.length === 0) {
          await db.update(contacts).set({ nextSendAt: null }).where(eq(contacts.id, contact.id));
          return { outcome: "skipped" as const };
        }

        const sortedByOverdue = [...relatedInvoices].sort(
          (a, b) => daysFromDate(b.dueDate) - daysFromDate(a.dueDate),
        );
        const matchedInv = sortedByOverdue.find(inv => templateByStage.has(inv.collectionStage));
        if (!matchedInv) return { outcome: "skipped" as const };

        const template = templateByStage.get(matchedInv.collectionStage)!;
        const intervalDays = template.sendIntervalDays ?? 7;

        const [custRow] = await db.select().from(customers)
          .where(eq(customers.id, contact.customerId)).limit(1);
        const custName = custRow?.name ?? custRow?.code ?? null;

        let entityRef = "";
        let projName: string | null = null;
        if (contact.projectId) {
          const [proj] = await db.select().from(projects)
            .where(eq(projects.id, contact.projectId)).limit(1);
          projName = proj?.name ?? null;
          entityRef = proj?.name ?? proj?.code ?? "";
        } else {
          entityRef = custRow?.code ?? custRow?.name ?? "";
        }

        const invoiceLines = relatedInvoices.map(inv => {
          const balance = inv.total - (inv.paid || 0);
          const d = daysFromDate(inv.dueDate);
          const overdueStr = d > 0 ? `${d} days overdue` : d === 0 ? "due today" : `due in ${Math.abs(d)} days`;
          return `  • ${inv.invoiceNumber} — Balance: ${balance.toLocaleString("en-IE", { style: "currency", currency: inv.currency || "EUR" })} (${overdueStr})`;
        });

        const greeting = contact.name?.split(" ")[0] || "Sir/Madam";
        const emailRef = genEmailRef();
        const subject = fillTemplate(template.subject, greeting, invoiceLines, entityRef) + ` | Ref ${emailRef}`;
        const introText = fillTemplate(template.body, greeting, [], entityRef);

        let portalUrl: string | null = null;
        try {
          portalUrl = (await createPortalToken(orgId, contact.customerId, relatedInvoices.map(i => i.id), null)).url;
        } catch (e: any) {
          console.warn("inngest/chase: portal link failed:", e?.message);
        }

        const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
        const bodyHtml = renderInvoiceEmail({
          subject, dateStr, portalUrl, intro: introText,
          total: relatedInvoices.reduce((s, i) => s + (i.total - (i.paid || 0)), 0),
          rows: relatedInvoices.map(i => ({
            invoiceNumber: i.invoiceNumber, customerName: custName, projectName: projName,
            invoiceDate: i.invoiceDate, dueDate: i.dueDate,
            balance: i.total - (i.paid || 0),
            currency: i.currency, daysOverdue: daysFromDate(i.dueDate),
          })),
        });

        // PDF attachments — silent failures
        const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
        for (const inv of relatedInvoices) {
          const pdf = (inv as any).xeroId
            ? await fetchXeroInvoicePdf(orgId, inv as any).catch(() => null)
            : await fetchQboInvoicePdf(orgId, inv as { qboId?: string; invoiceNumber: string }).catch(() => null);
          if (pdf) attachments.push({
            filename: `Invoice-${inv.invoiceNumber}.pdf`,
            content: pdf,
            contentType: "application/pdf",
          });
        }

        const sendResult = await sendEmail(orgId, {
          to: contact.email!,
          subject,
          body: bodyHtml,
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        // Only advance nextSendAt AFTER confirmed send
        await db.update(contacts)
          .set({ nextSendAt: addDays(now, intervalDays) })
          .where(eq(contacts.id, contact.id));

        await db.insert(communications).values({
          orgId,
          customerId:  contact.customerId,
          projectId:   contact.projectId ?? null,
          invoiceId:   matchedInv.id,
          contactId:   contact.id,
          direction:   "Outbound",
          channel:     "Email",
          subject,
          body:        introText,
          sender:      sendResult.from,
          recipients:  contact.email!,
          matchedBy:   "Auto",
          isDraft:     false,
          stageAtSend: matchedInv.collectionStage,
          authorId:    null,
          refNumber:   emailRef,
        }).catch(err => {
          console.warn("inngest/chase: communication log failed:", err?.message);
        });

        return { outcome: "sent" as const };
      });

      if (result.outcome === "sent") emailsSent++;
      else skipped++;
    }

    await step.run("update-org-stats", () =>
      db.update(organisations).set({
        lastCronRun:   now,
        lastCronStats: { emailsSent, skipped, errors },
      }).where(eq(organisations.id, orgId)).catch(() => {}),
    );

    return { orgId, emailsSent, skipped, errors };
  },
);

// ─── 3. Broken-promise sweep ─────────────────────────────────────────────────

export const brokenPromiseSweep = inngest.createFunction(
  { id: "broken-promise-sweep", triggers: [{ cron: "0 8 * * *" }] },
  async ({ step }) => {
    const today = new Date().toISOString().slice(0, 10);

    const stale = await step.run("find-stale-promises", () =>
      db.select({
        id:            invoicePromises.id,
        invoiceId:     invoicePromises.invoiceId,
        customerId:    invoicePromises.customerId,
        promiseDate:   invoicePromises.promiseDate,
        orgId:         invoicePromises.orgId,
        projectId:     invoices.projectId,
        paymentStatus: invoices.paymentStatus,
      })
      .from(invoicePromises)
      .leftJoin(invoices, eq(invoices.id, invoicePromises.invoiceId))
      .where(and(eq(invoicePromises.status, "Active"), lt(invoicePromises.promiseDate, today))),
    );

    const toBreak = stale.filter(s => s.paymentStatus !== "Paid");
    if (toBreak.length === 0) return { broken: 0 };

    await step.run("mark-broken", async () => {
      const ids = toBreak.map(s => s.id);
      for (let i = 0; i < ids.length; i += 100) {
        await db.update(invoicePromises)
          .set({ status: "Broken" })
          .where(inArray(invoicePromises.id, ids.slice(i, i + 100)));
      }
    });

    await step.run("log-broken", () =>
      db.insert(communications).values(
        toBreak.map(p => ({
          orgId:      p.orgId,
          customerId: p.customerId!,
          invoiceId:  p.invoiceId ?? undefined,
          projectId:  p.projectId ?? undefined,
          direction:  "Inbound" as const,
          channel:    "Promise",
          subject:    "Promise broken",
          body:       `Promise was due ${p.promiseDate} — marked broken. Invoice still unpaid.`,
          sender:     "System",
          matchedBy:  "System",
          isDraft:    false,
        })),
      ).catch(() => {}),
    );

    return { broken: toBreak.length };
  },
);

// ─── 4. Supply-chain delay watchdog ─────────────────────────────────────────
// Same shape as brokenPromiseSweep above: one daily sweep across every org,
// scanning Job Work / Purchase Orders / Manufacturing Orders still open past
// their expected date, upserting supply_chain_alerts (keyed by source doc,
// resolved — not deleted — once the doc closes or its date is no longer
// past). Powers the Order Production Tracker's per-step badges, the
// Delivery Risk report, and the header alert bell.

function daysLate(dateStr: string, today: string): number {
  return Math.max(0, Math.floor((new Date(today).getTime() - new Date(dateStr).getTime()) / 86_400_000));
}

export const supplyChainWatchdog = inngest.createFunction(
  { id: "supply-chain-watchdog", triggers: [{ cron: "0 7 * * *" }] },
  async ({ step }) => {
    const today = new Date().toISOString().slice(0, 10);

    const lateJobWork = await step.run("find-late-jobwork", () =>
      db.select({
        id: jobWorkOrders.id, orgId: jobWorkOrders.orgId, docNumber: jobWorkOrders.docNumber,
        salesOrderId: jobWorkOrders.salesOrderId, expectedReturnDate: jobWorkOrders.expectedReturnDate,
      }).from(jobWorkOrders).where(and(
        ne(jobWorkOrders.status, "Closed"),
        isNotNull(jobWorkOrders.expectedReturnDate),
        lt(jobWorkOrders.expectedReturnDate, today),
      )),
    );

    const latePOs = await step.run("find-late-pos", () =>
      db.select({
        id: tradeDocuments.id, orgId: tradeDocuments.orgId, docNumber: tradeDocuments.docNumber,
        salesOrderId: tradeDocuments.salesOrderId, expiryDate: tradeDocuments.expiryDate,
      }).from(tradeDocuments).where(and(
        eq(tradeDocuments.kind, "PurchaseOrder"),
        notInArray(tradeDocuments.status, ["Converted", "Closed"]),
        isNotNull(tradeDocuments.expiryDate),
        lt(tradeDocuments.expiryDate, today),
      )),
    );

    const lateMOs = await step.run("find-late-mos", () =>
      db.select({
        id: manufacturingOrders.id, orgId: manufacturingOrders.orgId, moNo: manufacturingOrders.moNo,
        salesOrderId: manufacturingOrders.salesOrderId, dueDate: manufacturingOrders.dueDate,
      }).from(manufacturingOrders).where(and(
        notInArray(manufacturingOrders.status, ["Completed", "Cancelled"]),
        isNotNull(manufacturingOrders.dueDate),
        lt(manufacturingOrders.dueDate, today),
      )),
    );

    const toUpsert = [
      ...lateJobWork.map(j => ({
        orgId: j.orgId, sourceType: "jobwork" as const, sourceId: j.id, salesOrderId: j.salesOrderId,
        kind: "late" as const, severity: daysLate(j.expectedReturnDate!, today) > 3 ? "critical" as const : "warning" as const,
        message: `Job Work ${j.docNumber ?? ""} expected back ${j.expectedReturnDate}, ${daysLate(j.expectedReturnDate!, today)} day(s) late`.trim(),
      })),
      ...latePOs.map(p => ({
        orgId: p.orgId, sourceType: "po" as const, sourceId: p.id, salesOrderId: p.salesOrderId,
        kind: "late" as const, severity: daysLate(p.expiryDate!, today) > 3 ? "critical" as const : "warning" as const,
        message: `Purchase Order ${p.docNumber ?? ""} expected ${p.expiryDate}, ${daysLate(p.expiryDate!, today)} day(s) late`.trim(),
      })),
      ...lateMOs.map(m => ({
        orgId: m.orgId, sourceType: "mo" as const, sourceId: m.id, salesOrderId: m.salesOrderId,
        kind: "late" as const, severity: daysLate(m.dueDate!, today) > 3 ? "critical" as const : "warning" as const,
        message: `Manufacturing Order ${m.moNo ?? ""} due ${m.dueDate}, ${daysLate(m.dueDate!, today)} day(s) late`.trim(),
      })),
    ];

    if (toUpsert.length > 0) {
      await step.run("upsert-alerts", async () => {
        for (const row of toUpsert) {
          await db.insert(supplyChainAlerts).values({ ...row, detectedAt: new Date(), resolvedAt: null })
            .onConflictDoUpdate({
              target: [supplyChainAlerts.orgId, supplyChainAlerts.sourceType, supplyChainAlerts.sourceId],
              set: { message: row.message, severity: row.severity, salesOrderId: row.salesOrderId, resolvedAt: null, detectedAt: new Date() },
            });
        }
      });
    }

    // Resolve open alerts whose source no longer qualifies as late (the
    // order closed, or its expected date was pushed out) — never deleted,
    // so there's a real history of what was late and when it cleared.
    const stillLateKeys = new Set(toUpsert.map(r => `${r.orgId}:${r.sourceType}:${r.sourceId}`));
    const openAlerts = await step.run("find-open-alerts", () =>
      db.select({ id: supplyChainAlerts.id, orgId: supplyChainAlerts.orgId, sourceType: supplyChainAlerts.sourceType, sourceId: supplyChainAlerts.sourceId })
        .from(supplyChainAlerts)
        .where(and(isNull(supplyChainAlerts.resolvedAt), inArray(supplyChainAlerts.sourceType, ["jobwork", "po", "mo"]))),
    );
    const toResolve = openAlerts.filter(a => !stillLateKeys.has(`${a.orgId}:${a.sourceType}:${a.sourceId}`));
    if (toResolve.length > 0) {
      await step.run("resolve-alerts", async () => {
        const ids = toResolve.map(a => a.id);
        for (let i = 0; i < ids.length; i += 100) {
          await db.update(supplyChainAlerts).set({ resolvedAt: new Date() }).where(inArray(supplyChainAlerts.id, ids.slice(i, i + 100)));
        }
      });
    }

    return { flagged: toUpsert.length, resolved: toResolve.length };
  },
);
