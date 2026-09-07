/**
 * lib/sage-sync.ts
 *
 * Sage Intacct AR sync — customers, AR invoices, credit memos.
 * Uses Sage's SOAP-like XML API (v3.0 query function) with credential auth.
 * No OAuth; credentials are stored encrypted and a fresh session is obtained
 * per sync run (session tokens expire in 30 min).
 *
 * Env vars required (platform-level):
 *   SAGE_SENDER_ID          – obtained from Sage developer partner program
 *   SAGE_SENDER_PASSWORD    – paired sender password
 */

import { db } from "@/db";
import {
  customers, invoices,
  sageIntacctCredentials, sageSyncLog,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

type SageCreds = {
  companyId: string;
  sageUserId: string;
  password: string;
  entityId?: string | null;
};

// ─── XML helpers ────────────────────────────────────────────────────────────

function xmlVal(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

// ─── SOAP request builder ────────────────────────────────────────────────────

let _ctrlSeq = 1;

function buildXml(creds: SageCreds, functionXml: string): string {
  const senderId = process.env.SAGE_SENDER_ID ?? "Primeaccountax";
  const senderPwd = process.env.SAGE_SENDER_PASSWORD ?? "Primeaccountax1!";
  const ctrlId = `ctrl${_ctrlSeq++}_${Date.now()}`;
  const entityEl = creds.entityId ? `<locationid>${creds.entityId}</locationid>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <control>
    <senderid>${senderId}</senderid>
    <password>${senderPwd}</password>
    <controlid>${ctrlId}</controlid>
    <uniqueid>false</uniqueid>
    <dtdversion>3.0</dtdversion>
    <includewhitespace>false</includewhitespace>
  </control>
  <operation>
    <authentication>
      <login>
        <userid>${creds.sageUserId}</userid>
        <companyid>${creds.companyId}</companyid>
        <password>${creds.password}</password>
        ${entityEl}
      </login>
    </authentication>
    <content>${functionXml}</content>
  </operation>
</request>`;
}

async function sagePost(xml: string): Promise<string> {
  const res = await fetch("https://api.intacct.com/ia/xml/xmlgw.php", {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sage HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.text();
}

function assertSuccess(responseXml: string, fnId: string): string {
  // Find result block for this function
  const results = xmlBlocks(responseXml, "result");
  const block = results.find(r => xmlVal(r, "function") === fnId || xmlVal(r, "controlid") === fnId);
  if (!block) {
    // Try parsing a top-level error
    const errDesc = xmlVal(responseXml, "description2") || xmlVal(responseXml, "description");
    throw new Error(`Sage Intacct: no result for ${fnId}${errDesc ? ` — ${errDesc}` : ""}`);
  }
  const status = xmlVal(block, "status");
  if (status !== "success") {
    const errDesc = xmlVal(block, "description2") || xmlVal(block, "description") || xmlVal(block, "errormessage");
    throw new Error(`Sage Intacct error [${fnId}]: ${errDesc || "Unknown error"}`);
  }
  return block;
}

// ─── Paginated query ─────────────────────────────────────────────────────────

async function sageFetchAll(
  creds: SageCreds,
  objectType: string,
  fields: string[],
  filterXml: string = "",
  pageSize = 1000
): Promise<string[]> {
  const selectXml = fields.map(f => `<field>${f}</field>`).join("");
  const records: string[] = [];
  let offset = 0;
  const objTag = objectType.toLowerCase();

  while (true) {
    const fnId = `q_${objectType}_${offset}`;
    const fn = `<function controlid="${fnId}">
  <query>
    <object>${objectType}</object>
    <select>${selectXml}</select>
    ${filterXml}
    <pagesize>${pageSize}</pagesize>
    <offset>${offset}</offset>
  </query>
</function>`;

    const resp = await sagePost(buildXml(creds, fn));
    const resultBlock = assertSuccess(resp, fnId);

    // numremaining is an attribute on the <data> tag itself, not child content —
    // so we must search resultBlock, not the content extracted by xmlBlocks.
    const numRemainingMatch = resultBlock.match(/numremaining="(\d+)"/i);
    const numRemaining = numRemainingMatch ? parseInt(numRemainingMatch[1]) : 0;

    const dataBlock = xmlBlocks(resultBlock, "data")[0] ?? "";
    const batch = xmlBlocks(dataBlock, objTag);
    records.push(...batch);

    if (numRemaining === 0 || batch.length === 0) break;
    offset += pageSize;
    await sleep(300);
  }

  return records;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function formatSageDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}/${d.getFullYear()}`;
}

/** Sage returns MM/DD/YYYY or MM/DD/YYYY HH:MM:SS → YYYY-MM-DD */
function parseSageDate(raw: string): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const datePart = raw.split(" ")[0];
  const parts = datePart.split("/");
  if (parts.length !== 3) return new Date().toISOString().slice(0, 10);
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Credential test (used by /api/sage/connect) ─────────────────────────────

export async function testSageCredentials(creds: SageCreds): Promise<{ companyName: string }> {
  const fn = `<function controlid="testAuth">
  <query>
    <object>CUSTOMER</object>
    <select><field>CUSTOMERID</field></select>
    <pagesize>1</pagesize>
    <offset>0</offset>
  </query>
</function>`;
  const resp = await sagePost(buildXml(creds, fn));
  assertSuccess(resp, "testAuth");
  // Try to get company name from a separate Company Info query
  let companyName = creds.companyId;
  try {
    const fn2 = `<function controlid="getCompany">
  <query>
    <object>COMPANY</object>
    <select><field>NAME</field></select>
    <pagesize>1</pagesize>
    <offset>0</offset>
  </query>
</function>`;
    const resp2 = await sagePost(buildXml(creds, fn2));
    const block = xmlBlocks(resp2, "result").find(r => xmlVal(r, "controlid") === "getCompany" || xmlVal(r, "function") === "getCompany");
    if (block && xmlVal(block, "status") === "success") {
      const name = xmlVal(xmlBlocks(block, "data")[0] ?? "", "NAME");
      if (name) companyName = name;
    }
  } catch {
    // Company query is optional — carry on
  }
  return { companyName };
}

// ─── Main AR sync ────────────────────────────────────────────────────────────

export async function runSageSync(orgId: string, userId: string, opts: { fullSync?: boolean } = {}) {
  const t0 = Date.now();

  // Load and decrypt credentials
  const [cred] = await db
    .select()
    .from(sageIntacctCredentials)
    .where(eq(sageIntacctCredentials.orgId, orgId))
    .limit(1);
  if (!cred) throw new Error("No Sage Intacct credentials configured");

  const sageCreds: SageCreds = {
    companyId:  cred.companyId,
    sageUserId: cred.sageUserId,
    password:   decryptSecret(cred.password) ?? "",
    entityId:   cred.entityId,
  };

  // Incremental boundary
  const [lastLog] = await db
    .select({ syncedAt: sageSyncLog.syncedAt })
    .from(sageSyncLog)
    .where(and(eq(sageSyncLog.orgId, orgId), eq(sageSyncLog.status, "success")))
    .orderBy(desc(sageSyncLog.syncedAt))
    .limit(1);

  // fullSync forces a complete historical re-fetch (ignores the last-sync log).
  const sinceDate = (!opts.fullSync && lastLog)
    ? new Date(lastLog.syncedAt.getTime() - 10 * 60 * 1000)
    : undefined;

  const dateFilter = sinceDate
    ? `<filter><greaterthanorequalto><field>WHENMODIFIED</field><value>${formatSageDate(sinceDate)}</value></greaterthanorequalto></filter>`
    : "";

  let customersCreated = 0;
  let invoicesCreated  = 0;
  let invoicesUpdated  = 0;
  let invoicesClosed   = 0;
  let creditsCreated   = 0;

  try {
    // ── STEP 1: Customers ──────────────────────────────────────────────────
    const custFields = [
      "CUSTOMERID", "NAME", "CURRENCY", "STATUS",
      "EMAIL1", "PHONE1", "TERMNAME", "BILLTOCONTACTNAME",
    ];
    const sageCusts = await sageFetchAll(sageCreds, "CUSTOMER", custFields, dateFilter);

    for (const c of sageCusts) {
      const sageId  = xmlVal(c, "CUSTOMERID");
      const name    = xmlVal(c, "NAME") || sageId;
      const currency = xmlVal(c, "CURRENCY") || "USD";
      const rawStatus = xmlVal(c, "STATUS");
      const status  = rawStatus === "active" ? "Active" : "Inactive";
      if (!sageId) continue;

      const [existing] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.orgId, orgId), eq(customers.sageIntacctId, sageId)))
        .limit(1);

      if (!existing) {
        // Plain insert, not onConflictDoNothing() — customers is a
        // compatibility view (migration 0079) and Postgres doesn't support
        // ON CONFLICT against a trigger-backed view. The existence check
        // above is the real dedup guard for the normal (non-racing) case.
        const code = `SAGE-${sageId}`.slice(0, 64);
        const inserted = await db.insert(customers).values({
          orgId, name, code, currency, status,
          sageIntacctId: sageId,
        }).returning({ id: customers.id });
        if (inserted.length > 0) customersCreated++;
      } else {
        await db.update(customers)
          .set({ name, currency, status, updatedAt: new Date() })
          .where(eq(customers.id, existing.id));
      }
    }

    // ── STEP 2: AR Invoices ───────────────────────────────────────────────
    const invFields = [
      "RECORDNO", "INVOICEID", "CUSTOMERID", "WHENCREATED", "WHENDUE",
      "TOTALENTERED", "TOTALPAID", "TOTALDUE", "STATE", "CURRENCY",
      "DESCRIPTION", "PONUMBER",
    ];
    const sageInvs = await sageFetchAll(sageCreds, "ARINVOICE", invFields, dateFilter);

    for (const inv of sageInvs) {
      const recordNo     = xmlVal(inv, "RECORDNO");
      const invoiceId    = xmlVal(inv, "INVOICEID") || recordNo;
      const customerId   = xmlVal(inv, "CUSTOMERID");
      const whenCreated  = xmlVal(inv, "WHENCREATED");
      const whenDue      = xmlVal(inv, "WHENDUE");
      const totalEntered = parseFloat(xmlVal(inv, "TOTALENTERED") || "0");
      const totalDue     = parseFloat(xmlVal(inv, "TOTALDUE") || "0");
      const state        = xmlVal(inv, "STATE");
      const currency     = xmlVal(inv, "CURRENCY") || "USD";
      const description  = xmlVal(inv, "DESCRIPTION");
      const poNumber     = xmlVal(inv, "PONUMBER");

      if (!recordNo || state === "Draft" || state === "Voided" || state === "Reversed") continue;

      let paymentStatus: string;
      let collectionStage: string;

      if (state === "Paid" || state === "Closed" || totalDue <= 0) {
        paymentStatus = "Paid";
        collectionStage = "Closed";
      } else if (state === "Partially Paid" || (totalEntered > 0 && totalDue < totalEntered)) {
        paymentStatus = "Partially Paid";
        collectionStage = "Open";
      } else {
        paymentStatus = "Unpaid";
        collectionStage = "Open";
      }

      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.orgId, orgId), eq(customers.sageIntacctId, customerId)))
        .limit(1);
      if (!customer) {
        console.warn(`Sage AR sync: skipping invoice ${recordNo} — customer ${customerId} not found in org ${orgId}`);
        continue;
      }

      const invoiceDate = parseSageDate(whenCreated);
      const dueDate     = parseSageDate(whenDue) || invoiceDate;
      const now = new Date();

      const [existing] = await db
        .select({ id: invoices.id, paymentStatus: invoices.paymentStatus })
        .from(invoices)
        .where(and(eq(invoices.orgId, orgId), eq(invoices.sageIntacctId, recordNo)))
        .limit(1);

      if (!existing) {
        await db.insert(invoices).values({
          orgId,
          invoiceNumber:         invoiceId,
          customerId:            customer.id,
          invoiceDate,
          dueDate,
          currency,
          amount:                totalEntered,
          taxAmount:             0,
          total:                 totalEntered,
          paid:                  totalEntered - totalDue,
          paymentStatus,
          collectionStage,
          poNumber:              poNumber || null,
          notes:                 description || null,
          sageIntacctId:         recordNo,
          sageIntacctBalance:    totalDue,
          sageIntacctCustomerId: customerId,
          sageIntacctSyncedAt:   now,
          source:                "sage" as const,
        });
        invoicesCreated++;
      } else {
        const wasOpen = existing.paymentStatus !== "Paid";
        await db.update(invoices)
          .set({
            paymentStatus,
            collectionStage,
            paid:                  totalEntered - totalDue,
            sageIntacctBalance:    totalDue,
            sageIntacctSyncedAt:   now,
            updatedAt:             now,
            invoiceDate,
            dueDate,
            source:                "sage" as const,
          })
          .where(eq(invoices.id, existing.id));
        if (wasOpen && paymentStatus === "Paid") invoicesClosed++;
        invoicesUpdated++;
      }
    }

    // ── STEP 3: Credit memos ──────────────────────────────────────────────
    const cmFields = [
      "RECORDNO", "INVOICEID", "CUSTOMERID", "WHENCREATED",
      "TOTALENTERED", "TOTALDUE", "STATE", "CURRENCY", "DESCRIPTION",
    ];
    const sageCMs = await sageFetchAll(sageCreds, "ARCREDITMEMO", cmFields, dateFilter);

    for (const cm of sageCMs) {
      const recordNo     = xmlVal(cm, "RECORDNO");
      const invoiceId    = xmlVal(cm, "INVOICEID") || `CM-${recordNo}`;
      const customerId   = xmlVal(cm, "CUSTOMERID");
      const whenCreated  = xmlVal(cm, "WHENCREATED");
      const totalEntered = parseFloat(xmlVal(cm, "TOTALENTERED") || "0");
      const totalDue     = parseFloat(xmlVal(cm, "TOTALDUE") || "0");
      const state        = xmlVal(cm, "STATE");
      const currency     = xmlVal(cm, "CURRENCY") || "USD";
      const description  = xmlVal(cm, "DESCRIPTION");

      if (!recordNo || state === "Voided" || state === "Reversed") continue;

      const [customer] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.orgId, orgId), eq(customers.sageIntacctId, customerId)))
        .limit(1);
      if (!customer) {
        console.warn(`Sage AR sync: skipping credit memo ${recordNo} — customer ${customerId} not found in org ${orgId}`);
        continue;
      }

      const sageKey     = `CM-${recordNo}`;
      const invoiceDate = parseSageDate(whenCreated);
      const now = new Date();

      const [existing] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.orgId, orgId), eq(invoices.sageIntacctId, sageKey)))
        .limit(1);

      if (!existing) {
        await db.insert(invoices).values({
          orgId,
          invoiceNumber:         invoiceId,
          customerId:            customer.id,
          invoiceDate,
          dueDate:               invoiceDate,
          currency,
          amount:                -totalEntered,
          taxAmount:             0,
          total:                 -totalEntered,
          paid:                  0,
          paymentStatus:         totalDue <= 0 ? "Paid" : "Unpaid",
          collectionStage:       "Closed",
          txnType:               "CreditMemo",
          notes:                 description || null,
          sageIntacctId:         sageKey,
          sageIntacctBalance:    -totalDue,
          sageIntacctCustomerId: customerId,
          sageIntacctSyncedAt:   now,
        });
        creditsCreated++;
      } else {
        await db.update(invoices)
          .set({ sageIntacctBalance: -totalDue, sageIntacctSyncedAt: now, updatedAt: now })
          .where(eq(invoices.id, existing.id));
      }
    }

    const durationMs = Date.now() - t0;
    await db.insert(sageSyncLog).values({
      orgId, userId,
      status: "success",
      customersCreated, invoicesCreated, invoicesUpdated, invoicesClosed, creditsCreated,
      durationMs,
    });

    return { customersCreated, invoicesCreated, invoicesUpdated, invoicesClosed, creditsCreated, durationMs };
  } catch (e: any) {
    await db.insert(sageSyncLog).values({
      orgId, userId,
      status: "error",
      errorMessage: e.message,
      durationMs: Date.now() - t0,
    }).catch(() => {});
    throw e;
  }
}
