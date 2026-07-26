/**
 * Shared Xero sync logic.
 * Used by:
 *   - POST /api/xero/sync      — manual sync from Settings
 *   - GET  /api/cron/xero-sync — scheduled full sync (every 30 min)
 *   - POST /api/webhooks/xero  — real-time targeted sync on entity change
 *
 * Xero API reference:
 *   https://developer.xero.com/documentation/api/accounting/overview
 *
 * Entity mapping vs QBO:
 *   Xero Contact  (IsCustomer=true)  → customers
 *   Xero Invoice  (Type=ACCREC)      → invoices
 *   Xero CreditNote (Type=ACCREC)    → credit memos (invoices with txnType=CreditMemo)
 *   Xero Payment                     → updates invoice paid/balance fields
 */

import { db } from "@/db";
import { xeroTokens, xeroSyncLog, customers, projects, invoices, contacts } from "@/db/schema";
import { eq, and, inArray, isNull, desc, ne, lte } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// TOKEN MANAGEMENT (inlined so xero-sync is self-contained)
// ============================================================
async function getValidToken(orgId: string) {
  const [token] = await db.select().from(xeroTokens).where(eq(xeroTokens.orgId, orgId)).limit(1);
  if (!token) return null;

  // Tokens are encrypted at rest — decrypt for use (legacy plaintext passes through).
  const refreshTokenPlain = decryptSecret(token.refreshToken);
  if (!refreshTokenPlain) {
    throw new Error(
      "Xero tokens could not be decrypted (ENCRYPTION_KEY may have been rotated). " +
      "Reconnect Xero under Settings → Integrations to re-authorise."
    );
  }

  const now = Date.now();
  // Refresh if less than 10 minutes remaining
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 10 * 60 * 1000) {
    const clientId = process.env.XERO_CLIENT_ID!;
    const clientSecret = process.env.XERO_CLIENT_SECRET!;

    const res = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshTokenPlain,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Xero refresh token rejected (HTTP ${res.status}). Reconnect Xero under Settings → Integrations. Detail: ${body.slice(0, 200)}`
      );
    }

    const d = await res.json();
    const updated = {
      ...token,
      accessToken: d.access_token,                       // plaintext, for immediate use
      refreshToken: d.refresh_token || refreshTokenPlain, // plaintext, for immediate use
      accessTokenExpiresAt: new Date(now + (d.expires_in || 1800) * 1000),
      refreshTokenExpiresAt: new Date(now + 60 * 24 * 60 * 60 * 1000),
    };
    await db.update(xeroTokens).set({
      accessToken: encryptSecret(updated.accessToken)!,
      refreshToken: encryptSecret(updated.refreshToken)!,
      accessTokenExpiresAt: updated.accessTokenExpiresAt,
      refreshTokenExpiresAt: updated.refreshTokenExpiresAt,
      updatedAt: new Date(),
    }).where(eq(xeroTokens.orgId, orgId));
    return updated;
  }
  return { ...token, accessToken: decryptSecret(token.accessToken)!, refreshToken: refreshTokenPlain };
}

// ============================================================
// XERO API HELPERS
// ============================================================

/** GET a Xero API endpoint with tenant header. Handles pagination via `page`. */
async function xeroGet(accessToken: string, tenantId: string, path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${XERO_API}/${path}${sep}summaryOnly=false`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Xero API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Format a JS Date as a Xero where-clause DateTime literal. */
function xeroDateTimeFilter(d: Date): string {
  return `DateTime(${d.getUTCFullYear()}, ${d.getUTCMonth() + 1}, ${d.getUTCDate()}, ${d.getUTCHours()}, ${d.getUTCMinutes()}, ${d.getUTCSeconds()})`;
}

/** Paginated fetch — Xero returns 100 records per page.
 *  When sinceDate is provided, appends an UpdatedDateUTC filter for incremental sync. */
async function xeroFetchAll(
  accessToken: string,
  tenantId: string,
  entity: string,
  where?: string,
  extraParams?: string,
  sinceDate?: Date
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  let effectiveWhere = where;
  if (sinceDate) {
    const dateFilter = `UpdatedDateUTC >= ${xeroDateTimeFilter(sinceDate)}`;
    effectiveWhere = effectiveWhere ? `${effectiveWhere} AND ${dateFilter}` : dateFilter;
  }

  while (true) {
    let path = `${entity}?page=${page}`;
    if (effectiveWhere) path += `&where=${encodeURIComponent(effectiveWhere)}`;
    if (extraParams)    path += `&${extraParams}`;

    const data = await xeroGet(accessToken, tenantId, path);
    // Xero wraps in the entity name: { Contacts: [...] } or { Invoices: [...] }
    const records: any[] = data[entity] || [];
    all.push(...records);

    if (records.length < 100) break;
    page++;
    await sleep(200); // rate limit courtesy delay
  }
  return all;
}

/** Parse Xero date string "/Date(1234567890000+0000)/" → ISO date string */
function parseXeroDate(d: string | undefined): string | null {
  if (!d) return null;
  const match = d.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
  if (match) {
    return new Date(parseInt(match[1])).toISOString().slice(0, 10);
  }
  // Also handle plain ISO strings Xero sometimes returns
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return null;
}

/** Extract primary email from Xero Contact */
function getContactEmail(contact: any): string | null {
  return contact.EmailAddress || null;
}

/** Extract primary phone from Xero Contact */
function getContactPhone(contact: any): string | null {
  const phones: any[] = contact.Phones || [];
  const defaultPhone = phones.find((p: any) => p.PhoneType === "DEFAULT" && p.PhoneNumber);
  return defaultPhone?.PhoneNumber || phones[0]?.PhoneNumber || null;
}

/** Extract country from Xero Contact addresses */
function getContactCountry(contact: any): string {
  const addrs: any[] = contact.Addresses || [];
  const street = addrs.find((a: any) => a.AddressType === "STREET");
  return street?.Country || addrs[0]?.Country || "Ireland";
}

// ============================================================
// FULL SYNC — manual button + scheduled cron
// ============================================================
export async function runXeroSync(orgId: string, userId: string, opts: { fullSync?: boolean } = {}) {
  const startTime = Date.now();
  const token = await getValidToken(orgId);
  if (!token) throw new Error("Xero not connected");
  const { accessToken, tenantId } = token;

  // Incremental boundary: subtract 10-min buffer from last successful sync.
  // First-ever sync (no log entry) leaves sinceDate undefined → full historical fetch.
  const [lastLog] = await db
    .select({ syncedAt: xeroSyncLog.syncedAt })
    .from(xeroSyncLog)
    .where(and(eq(xeroSyncLog.orgId, orgId), eq(xeroSyncLog.status, "success")))
    .orderBy(desc(xeroSyncLog.syncedAt))
    .limit(1);
  // fullSync forces a complete historical re-fetch (ignores the last-sync log).
  const sinceDate = (!opts.fullSync && lastLog)
    ? new Date(lastLog.syncedAt.getTime() - 10 * 60 * 1000)
    : undefined;
  const isIncremental = sinceDate !== undefined;
  console.log(`Xero AR sync [${orgId}]: ${isIncremental ? `incremental since ${sinceDate!.toISOString()}` : "full historical sync"}`);

  const results = {
    customers: 0,
    contacts: 0,
    invoicesCreated: 0,
    invoicesUpdated: 0,
    invoicesClosed: 0,
    creditsCreated: 0,
    creditsUpdated: 0,
  };

  // STEP 1: Fetch from Xero (sequentially, rate-limit safe).
  // Incremental runs carry an UpdatedDateUTC filter — typically 10-100x fewer pages.
  const allXeroContacts = await xeroFetchAll(
    accessToken, tenantId, "Contacts",
    `IsCustomer=true`,
    undefined,
    sinceDate
  );
  await sleep(300);

  // Full sync: two separate calls — open invoices (AUTHORISED/SUBMITTED) and paid history.
  // Incremental sync: one date-filtered call with all statuses, then split client-side.
  // This preserves the downstream STEP 5 (open) / STEP 6 (paid) processing split.
  let openInvoices: any[];
  let paidInvoices: any[];
  if (isIncremental) {
    const modifiedInvoices = await xeroFetchAll(
      accessToken, tenantId, "Invoices",
      `Type="ACCREC"`,
      "Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID,VOIDED",
      sinceDate
    );
    openInvoices = modifiedInvoices.filter((xi: any) => xi.Status !== "PAID" && xi.Status !== "VOIDED");
    paidInvoices = modifiedInvoices.filter((xi: any) => xi.Status === "PAID");
  } else {
    openInvoices = await xeroFetchAll(
      accessToken, tenantId, "Invoices",
      `Type="ACCREC"`,
      "Statuses=AUTHORISED,SUBMITTED"
    );
    await sleep(300);
    paidInvoices = await xeroFetchAll(
      accessToken, tenantId, "Invoices",
      `Type="ACCREC"`,
      "Statuses=PAID"
    );
  }
  await sleep(300);

  let creditNotes: any[] = [];
  try {
    creditNotes = await xeroFetchAll(
      accessToken, tenantId, "CreditNotes",
      `Type="ACCREC"`,
      undefined,
      sinceDate
    );
  } catch (e: any) {
    console.warn("Xero CreditNotes fetch skipped (scope/permission?):", e?.message || e);
    creditNotes = [];
  }
  await sleep(300);

  // STEP 2: Load current ledger state
  const [allLedgerCustomers, allLedgerInvoices, allLedgerContacts] = await Promise.all([
    db.select().from(customers).where(eq(customers.orgId, orgId)),
    db.select().from(invoices).where(eq(invoices.orgId, orgId)),
    db.select().from(contacts).where(eq(contacts.orgId, orgId)),
  ]);

  const ledgerCustByXeroId = new Map(
    allLedgerCustomers.filter((c) => c.xeroId).map((c) => [c.xeroId!, c])
  );
  const ledgerCustByCode = new Map(allLedgerCustomers.map((c) => [c.code, c]));
  const ledgerInvByXeroId = new Map(
    allLedgerInvoices.filter((i) => i.xeroId).map((i) => [i.xeroId!, i])
  );
  const ledgerContactsByCustId = new Map(allLedgerContacts.map((c) => [c.customerId, c]));

  // STEP 3: Upsert Contacts as Customers
  const custsToInsert: any[] = [];
  const custsToUpdate: { id: string; data: any }[] = [];

  for (const xc of allXeroContacts) {
    if (!xc.ContactID) continue;
    const existing = ledgerCustByXeroId.get(xc.ContactID) || ledgerCustByCode.get(`XERO-${xc.ContactID}`);

    // Resolve payment terms from Xero (days) — default 30
    const paymentTermsDays = xc.PaymentTerms?.Sales?.Day ?? 30;

    const payload = {
      name: xc.Name || xc.ContactID,
      code: `XERO-${xc.ContactID}`,
      xeroId: xc.ContactID,
      country: getContactCountry(xc),
      currency: xc.Balances?.AccountsReceivable?.CurrencyCode || "EUR",
      paymentTerms: paymentTermsDays,
      taxNumber: xc.TaxNumber || "",
      riskRating: "Low" as const,
      status: (xc.IsCustomer && xc.ContactStatus !== "ARCHIVED" ? "Active" : "Inactive") as "Active" | "Inactive",
      creditLimit: xc.CreditLimit ?? null,
      accountOwnerId: userId,
      collectionOwnerId: userId,
      notes: "",
      phone: getContactPhone(xc) || "",
      email: getContactEmail(xc) || "",
      companyName: xc.Name || "",
      addressStreet: "",
      addressCity: "",
      addressPostcode: "",
    };

    if (existing) {
      custsToUpdate.push({ id: existing.id, data: payload });
    } else {
      custsToInsert.push({ ...payload, orgId });
      results.customers++;
    }
  }

  if (custsToInsert.length > 0) {
    for (let i = 0; i < custsToInsert.length; i += 100)
      await db.insert(customers).values(custsToInsert.slice(i, i + 100));
  }
  await Promise.all(
    custsToUpdate.map(({ id, data }) =>
      db.update(customers).set({ ...data, updatedAt: new Date() }).where(eq(customers.id, id))
    )
  );

  // Reload customers for FK resolution
  const freshCustomers = await db.select().from(customers).where(eq(customers.orgId, orgId));
  const freshCustByXeroId = new Map(
    freshCustomers.filter((c) => c.xeroId).map((c) => [c.xeroId!, c])
  );
  const freshCustByCode = new Map(freshCustomers.map((c) => [c.code, c]));

  // STEP 4: Sync primary contacts
  const contactsToInsert: any[] = [];
  const contactEmailUpdates: Array<{ id: string; email: string }> = [];

  for (const xc of allXeroContacts) {
    const email = getContactEmail(xc);
    if (!email) continue;

    const cust = freshCustByXeroId.get(xc.ContactID) || freshCustByCode.get(`XERO-${xc.ContactID}`);
    if (!cust) continue;

    const existing = ledgerContactsByCustId.get(cust.id);
    if (!existing) {
      contactsToInsert.push({
        orgId,
        customerId: cust.id,
        name: xc.FirstName && xc.LastName
          ? `${xc.FirstName} ${xc.LastName}`
          : xc.ContactPersons?.[0]?.FirstName
            ? `${xc.ContactPersons[0].FirstName} ${xc.ContactPersons[0].LastName || ""}`.trim()
            : (xc.Name || "Primary Contact"),
        email,
        phone: getContactPhone(xc) || "",
        type: "Billing" as const,
        isPrimary: true,
        isEscalation: false,
        receivesAuto: true,
      });
      results.contacts++;
    } else if (existing.email !== email) {
      contactEmailUpdates.push({ id: existing.id, email });
    }
  }

  if (contactsToInsert.length > 0) {
    for (let i = 0; i < contactsToInsert.length; i += 100)
      await db.insert(contacts).values(contactsToInsert.slice(i, i + 100));
  }
  for (const { id, email } of contactEmailUpdates) {
    await db.update(contacts).set({ email, updatedAt: new Date() }).where(eq(contacts.id, id));
  }

  // Build a lookup from Xero ContactID → email from the freshly-fetched contacts.
  // Xero's inline Contact object on an Invoice often omits EmailAddress (returns
  // only ContactID + Name), so we fall back to the full contact we already have.
  const xeroContactEmailMap = new Map<string, string>(
    allXeroContacts
      .filter((c: any) => c.ContactID && c.EmailAddress)
      .map((c: any) => [c.ContactID as string, c.EmailAddress as string])
  );

  // STEP 5: Upsert open AR invoices
  const invsToInsert: any[] = [];
  const invsToUpdate: { id: string; data: any }[] = [];

  for (const xi of openInvoices) {
    if (!xi.InvoiceID) continue;
    const xeroId = xi.InvoiceID;
    const contactId = xi.Contact?.ContactID;
    if (!contactId) continue;

    const cust = freshCustByXeroId.get(contactId) || freshCustByCode.get(`XERO-${contactId}`);
    if (!cust) continue;

    const total      = parseFloat(xi.Total) || 0;
    const taxAmount  = parseFloat(xi.TotalTax) || 0;
    const amount     = Math.max(0, total - taxAmount);
    const balance    = parseFloat(xi.AmountDue) || 0;
    const paid       = Math.max(0, total - balance);
    const invoiceDate = parseXeroDate(xi.Date) || new Date().toISOString().slice(0, 10);
    const dueDate    = parseXeroDate(xi.DueDate) || invoiceDate;
    const billingEmail = xi.Contact?.EmailAddress
      || xeroContactEmailMap.get(contactId)
      || null;
    const lineItems = (xi.LineItems || []).map((l: any) => ({
      description: l.Description || "",
      qty: l.Quantity ?? 1,
      unitPrice: l.UnitAmount ?? 0,
      amount: l.LineAmount ?? 0,
    }));

    const wasClosedOrPaid = (() => {
      const ex = ledgerInvByXeroId.get(xeroId);
      return ex && (ex.paymentStatus === "Paid" || ex.collectionStage === "Closed");
    })();

    const syncData = {
      total,
      amount,
      taxAmount,
      paid,
      xeroId,
      xeroBalance: balance,
      xeroCustomerId: contactId,
      xeroSyncedAt: new Date(),
      xeroTenantId: tenantId,
      txnType: "Invoice",
      // Zero balance = fully paid. Must be able to emit "Paid" here — a
      // just-paid invoice can flow through this path, and paid=total-0>0 would
      // otherwise be mislabelled "Partially Paid".
      paymentStatus: (balance <= 0.005 ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid") as any,
      billingEmail,
      updatedAt: new Date(),
      invoiceDate,
      dueDate,
      lineItems,
      source: "xero" as const,
      ...(balance <= 0.005 ? { collectionStage: "Closed" } : {}),
      ...(wasClosedOrPaid && balance > 0.005 ? { collectionStage: "Open", paidAt: null } : {}),
    };

    const existing = ledgerInvByXeroId.get(xeroId);
    if (existing) {
      invsToUpdate.push({ id: existing.id, data: syncData });
      results.invoicesUpdated++;
    } else {
      invsToInsert.push({
        orgId,
        invoiceNumber: xi.InvoiceNumber || `XERO-${xeroId.slice(0, 8)}`,
        customerId: cust.id,
        projectId: null,
        invoiceDate,
        dueDate,
        currency: xi.CurrencyCode || cust.currency || "EUR",
        paymentTerms: cust.paymentTerms || 30,
        collectionStage: "New",
        collectionOwnerId: userId,
        ...syncData,
      });
      results.invoicesCreated++;
    }
  }

  if (invsToInsert.length > 0) {
    for (let i = 0; i < invsToInsert.length; i += 50)
      await db.insert(invoices).values(invsToInsert.slice(i, i + 50));
  }
  await Promise.all(
    invsToUpdate.map(({ id, data }) =>
      db.update(invoices).set(data).where(eq(invoices.id, id))
    )
  );

  // STEP 6: Sync paid invoices for history
  // Reload so we have all IDs including newly inserted
  const freshInvoicesByXeroId = new Map(
    (await db.select({ id: invoices.id, xeroId: invoices.xeroId, paymentStatus: invoices.paymentStatus, paidAt: invoices.paidAt })
      .from(invoices).where(eq(invoices.orgId, orgId)))
      .filter(i => i.xeroId)
      .map(i => [i.xeroId!, i])
  );

  const paidToInsert: any[] = [];
  const paidToUpdate: { id: string; data: any }[] = [];

  for (const xi of paidInvoices) {
    if (!xi.InvoiceID) continue;
    const xeroId = xi.InvoiceID;
    const contactId = xi.Contact?.ContactID;
    if (!contactId) continue;

    const cust = freshCustByXeroId.get(contactId) || freshCustByCode.get(`XERO-${contactId}`);
    if (!cust) continue;

    const total      = parseFloat(xi.Total) || 0;
    const taxAmount  = parseFloat(xi.TotalTax) || 0;
    const amount     = Math.max(0, total - taxAmount);
    const invoiceDate = parseXeroDate(xi.Date) || new Date().toISOString().slice(0, 10);
    const dueDate    = parseXeroDate(xi.DueDate) || invoiceDate;
    // Xero FullyPaidOnDate is the actual payment date
    const paidAt     = parseXeroDate(xi.FullyPaidOnDate) || parseXeroDate(xi.UpdatedDateUTC);
    const paidLineItems = (xi.LineItems || []).map((l: any) => ({
      description: l.Description || "",
      qty: l.Quantity ?? 1,
      unitPrice: l.UnitAmount ?? 0,
      amount: l.LineAmount ?? 0,
    }));

    const paidData = {
      total,
      amount,
      taxAmount,
      paid: total,
      xeroBalance: 0,
      xeroSyncedAt: new Date(),
      xeroTenantId: tenantId,
      paymentStatus: "Paid" as const,
      collectionStage: "Closed",
      billingEmail: xi.Contact?.EmailAddress || xeroContactEmailMap.get(xi.Contact?.ContactID) || null,
      lineItems: paidLineItems,
      source: "xero" as const,
      updatedAt: new Date(),
      ...(paidAt ? { paidAt } : {}),
    };

    const existing = freshInvoicesByXeroId.get(xeroId);
    if (existing) {
      if (existing.paymentStatus !== "Paid" || (!existing.paidAt && paidAt)) {
        paidToUpdate.push({ id: existing.id, data: paidData });
        results.invoicesClosed++;
      }
    } else {
      paidToInsert.push({
        orgId,
        invoiceNumber: xi.InvoiceNumber || `XERO-${xeroId.slice(0, 8)}`,
        customerId: cust.id,
        projectId: null,
        invoiceDate,
        dueDate,
        currency: xi.CurrencyCode || cust.currency || "EUR",
        paymentTerms: cust.paymentTerms || 30,
        collectionOwnerId: userId,
        xeroId,
        xeroCustomerId: contactId,
        txnType: "Invoice",
        ...paidData,
      });
      results.invoicesClosed++;
    }
  }

  if (paidToInsert.length > 0) {
    for (let i = 0; i < paidToInsert.length; i += 50)
      await db.insert(invoices).values(paidToInsert.slice(i, i + 50));
  }
  await Promise.all(
    paidToUpdate.map(({ id, data }) =>
      db.update(invoices).set(data).where(eq(invoices.id, id))
    )
  );

  // STEP 7: Sync Credit Notes as credit memos
  const creditsToInsert: any[] = [];
  const creditsToUpdate: { id: string; data: any }[] = [];

  // Reload invoice map after inserts to get fresh xeroId → id mapping
  const allInvoicesNow = await db.select({ id: invoices.id, xeroId: invoices.xeroId })
    .from(invoices).where(eq(invoices.orgId, orgId));
  const freshInvByXeroId = new Map(
    allInvoicesNow.filter(i => i.xeroId).map(i => [i.xeroId!, i.id])
  );

  for (const cn of creditNotes) {
    if (!cn.CreditNoteID) continue;
    const xeroId = `CN-${cn.CreditNoteID}`;
    const contactId = cn.Contact?.ContactID;
    if (!contactId) continue;

    const cust = freshCustByXeroId.get(contactId) || freshCustByCode.get(`XERO-${contactId}`);
    if (!cust) continue;

    const totalAmt = parseFloat(cn.Total) || 0;
    const taxAmt   = parseFloat(cn.TotalTax) || 0;
    const netAmt   = Math.max(0, totalAmt - taxAmt);
    const remaining = parseFloat(cn.RemainingCredit) || 0;
    const isFullyApplied = remaining < 0.005;

    const cnDate = parseXeroDate(cn.Date) || new Date().toISOString().slice(0, 10);

    const cmFields = {
      amount: -netAmt,
      taxAmount: -taxAmt,
      total: -totalAmt,
      paid: 0,
      xeroBalance: -remaining,
      xeroCustomerId: contactId,
      xeroSyncedAt: new Date(),
      xeroTenantId: tenantId,
      updatedAt: new Date(),
      paymentStatus: (isFullyApplied ? "Paid" : "Unpaid") as "Paid" | "Unpaid",
    };

    const existing = freshInvByXeroId.get(xeroId)
      ? allInvoicesNow.find(i => i.xeroId === xeroId)
      : null;

    // Also check by credit note number
    const existingByXeroId = allLedgerInvoices.find(i => i.xeroId === xeroId);

    if (existing || existingByXeroId) {
      const id = (existing?.id || existingByXeroId?.id)!;
      creditsToUpdate.push({ id, data: cmFields });
    } else {
      creditsToInsert.push({
        orgId,
        invoiceNumber: `CN-${cn.CreditNoteNumber || cn.CreditNoteID.slice(0, 8)}`,
        customerId: cust.id,
        projectId: null,
        invoiceDate: cnDate,
        dueDate: cnDate,
        currency: cn.CurrencyCode || cust.currency || "EUR",
        paymentTerms: 0,
        collectionStage: "Credit Memo",
        collectionOwnerId: userId,
        xeroId,
        txnType: "CreditMemo",
        notes: `Credit note from Xero — ${cn.CreditNoteNumber || cn.CreditNoteID}`,
        ...cmFields,
      });
      results.creditsCreated++;
    }
  }

  if (creditsToInsert.length > 0) await db.insert(invoices).values(creditsToInsert);
  if (creditsToUpdate.length > 0) {
    for (const { id, data } of creditsToUpdate) {
      await db.update(invoices).set(data).where(eq(invoices.id, id));
      results.creditsUpdated++;
    }
  }

  // STEP 7c: Self-heal historical mislabels — DB-only, no Xero calls.
  // Any invoice whose stored open balance is already zero but still isn't marked
  // Paid (e.g. settled by a credit note in the past and never re-fetched on an
  // incremental sync). Balance is the source of truth → mark it Paid/Closed.
  {
    const healed = await db.update(invoices)
      .set({ paymentStatus: "Paid", collectionStage: "Closed", updatedAt: new Date() })
      .where(and(
        eq(invoices.orgId, orgId),
        ne(invoices.txnType, "CreditMemo"),
        ne(invoices.paymentStatus, "Paid"),
        lte(invoices.xeroBalance, 0.005),   // NULL balances excluded
      ))
      .returning({ id: invoices.id });
    (results as any).invoicesHealed = healed.length;
  }

  // STEP 8: Auto-deactivate customers / projects with zero open AR
  {
    const allCurrentInvoices = await db.select({
      customerId: invoices.customerId,
      paymentStatus: invoices.paymentStatus,
      collectionStage: invoices.collectionStage,
      txnType: invoices.txnType,
      xeroBalance: invoices.xeroBalance,
    }).from(invoices).where(eq(invoices.orgId, orgId));

    const activeCustomerIds = new Set<string>();
    for (const inv of allCurrentInvoices) {
      const isOpen = inv.txnType !== "CreditMemo"
        ? inv.paymentStatus !== "Paid" && inv.collectionStage !== "Closed"
        : (inv.xeroBalance ?? 0) < 0;
      if (isOpen && inv.customerId) activeCustomerIds.add(inv.customerId);
    }

    const allActiveCustomers = await db.select({ id: customers.id })
      .from(customers).where(eq(customers.orgId, orgId));
    const toDeactivate = allActiveCustomers.filter(c => !activeCustomerIds.has(c.id));
    if (toDeactivate.length > 0) {
      await db.update(customers)
        .set({ status: "Inactive", updatedAt: new Date() })
        .where(and(
          eq(customers.orgId, orgId),
          inArray(customers.id, toDeactivate.map(c => c.id)),
        ));
    }
  }

  // STEP 9: Write sync log
  await db.insert(xeroSyncLog).values({
    userId,
    orgId,
    status: "success",
    customersCreated: results.customers,
    invoicesCreated: results.invoicesCreated,
    invoicesUpdated: results.invoicesUpdated,
    invoicesClosed: results.invoicesClosed,
    creditsCreated: results.creditsCreated,
    durationMs: Date.now() - startTime,
  });

  return results;
}

// ============================================================
// TARGETED SYNC — webhook only (fetches specific entities)
// ============================================================
export type XeroEntityChange = {
  resourceId: string;          // Xero entity UUID
  eventType: string;           // "CREATE" | "UPDATE" | "DELETE"
  eventCategory: string;       // "INVOICE" | "CONTACT" | "CREDITNOTE" | "PAYMENT"
  tenantId: string;
  xeroEventId?: string;        // per-event UUID from Xero payload — used for idempotency
};

export async function syncXeroTargetedEntities(
  orgId: string,
  userId: string,
  changes: XeroEntityChange[]
): Promise<{ apInvoiceIds: string[] }> {
  const token = await getValidToken(orgId);
  if (!token) return { apInvoiceIds: [] };
  const { accessToken, tenantId } = token;

  const [allLedgerCustomers, allLedgerInvoices] = await Promise.all([
    db.select().from(customers).where(eq(customers.orgId, orgId)),
    db.select().from(invoices).where(eq(invoices.orgId, orgId)),
  ]);

  const freshCustByXeroId = new Map(
    allLedgerCustomers.filter(c => c.xeroId).map(c => [c.xeroId!, c])
  );
  const freshCustByCode = new Map(allLedgerCustomers.map(c => [c.code, c]));
  const ledgerInvByXeroId = new Map(
    allLedgerInvoices.filter(i => i.xeroId).map(i => [i.xeroId!, i])
  );

  // AP invoice IDs discovered during INVOICE processing (non-ACCREC types).
  // Returned to the caller so it can pass them to syncXeroApBills without
  // re-fetching invoices we already know aren't AR.
  const apInvoiceIds: string[] = [];

  // Non-DELETE PAYMENT events are batched after the main loop (GAP-2).
  // Processing them in two parallel phases (fetch payments → fetch linked invoices)
  // instead of 2 sequential API calls per payment in the loop.
  const batchPayments = changes.filter(c => c.eventCategory === "PAYMENT" && c.eventType !== "DELETE");
  const mainChanges   = changes.filter(c => !(c.eventCategory === "PAYMENT" && c.eventType !== "DELETE"));

  for (const change of mainChanges) {
    try {
      const { resourceId, eventType, eventCategory } = change;
      if (eventType === "DELETE") {
        if (eventCategory === "INVOICE" || eventCategory === "CREDITNOTE") {
          // Voided/deleted invoice or credit note — close it locally
          const prefix = eventCategory === "CREDITNOTE" ? `CN-${resourceId}` : resourceId;
          const existing = ledgerInvByXeroId.get(prefix);
          if (existing) {
            await db.update(invoices)
              .set({ collectionStage: "Closed", paymentStatus: "Paid", updatedAt: new Date() })
              .where(eq(invoices.id, existing.id));
          }
        } else if (eventCategory === "CONTACT") {
          // Contact archived/deleted in Xero — mark as Inactive locally
          const existing = freshCustByXeroId.get(resourceId) || freshCustByCode.get(`XERO-${resourceId}`);
          if (existing) {
            await db.update(customers)
              .set({ status: "Inactive", updatedAt: new Date() })
              .where(eq(customers.id, existing.id));
          }
        }
        continue;
      }

      if (eventCategory === "INVOICE") {
        const data = await xeroGet(accessToken, tenantId, `Invoices/${resourceId}`);
        const xi = data.Invoices?.[0];
        if (!xi) continue;
        if (xi.Type !== "ACCREC") {
          // Already fetched — not an AR invoice. Pass to AP sync (GAP-3: no double-fetch).
          apInvoiceIds.push(resourceId);
          continue;
        }

        const contactId = xi.Contact?.ContactID;
        const cust = contactId
          ? (freshCustByXeroId.get(contactId) || freshCustByCode.get(`XERO-${contactId}`))
          : null;

        const total    = parseFloat(xi.Total) || 0;
        const taxAmt   = parseFloat(xi.TotalTax) || 0;
        const amount   = Math.max(0, total - taxAmt);
        const balance  = parseFloat(xi.AmountDue) || 0;
        const paid     = Math.max(0, total - balance);
        // Balance-based check (consistent with QBO) — guards against Xero's Status
        // field lagging behind AmountDue on rapid webhook delivery.
        const isPaid   = xi.Status === "PAID" || balance < 0.005;

        const syncData: any = {
          total,
          amount,
          taxAmount: taxAmt,
          paid,
          xeroId: xi.InvoiceID,
          xeroBalance: balance,
          xeroCustomerId: contactId ?? null,
          xeroSyncedAt: new Date(),
          xeroTenantId: tenantId,
          txnType: "Invoice",
          billingEmail: xi.Contact?.EmailAddress || null,
          updatedAt: new Date(),
        };

        if (isPaid) {
          syncData.paymentStatus = "Paid";
          syncData.collectionStage = "Closed";
          const paidAt = parseXeroDate(xi.FullyPaidOnDate);
          if (paidAt) syncData.paidAt = paidAt;
        } else {
          syncData.paymentStatus = paid > 0 ? "Partially Paid" : "Unpaid";
        }

        const existing = ledgerInvByXeroId.get(xi.InvoiceID);
        if (existing) {
          await db.update(invoices).set(syncData).where(eq(invoices.id, existing.id));
        } else if (cust) {
          const invoiceDate = parseXeroDate(xi.Date) || new Date().toISOString().slice(0, 10);
          await db.insert(invoices).values({
            orgId,
            invoiceNumber: xi.InvoiceNumber || `XERO-${xi.InvoiceID.slice(0, 8)}`,
            customerId: cust.id,
            projectId: null,
            invoiceDate,
            dueDate: parseXeroDate(xi.DueDate) || invoiceDate,
            currency: xi.CurrencyCode || cust.currency || "EUR",
            paymentTerms: cust.paymentTerms || 30,
            collectionStage: isPaid ? "Closed" : "New",
            collectionOwnerId: userId,
            ...syncData,
          });
        }
      }

      if (eventCategory === "CREDITNOTE") {
        const data = await xeroGet(accessToken, tenantId, `CreditNotes/${resourceId}`);
        const cn = data.CreditNotes?.[0];
        if (!cn || cn.Type !== "ACCREC") continue;

        const xeroId = `CN-${cn.CreditNoteID}`;
        const contactId = cn.Contact?.ContactID;
        const cust = contactId
          ? (freshCustByXeroId.get(contactId) || freshCustByCode.get(`XERO-${contactId}`))
          : null;

        const totalAmt  = parseFloat(cn.Total) || 0;
        const taxAmt    = parseFloat(cn.TotalTax) || 0;
        const netAmt    = Math.max(0, totalAmt - taxAmt);
        const remaining = parseFloat(cn.RemainingCredit) || 0;
        const isFullyApplied = remaining < 0.005;

        const cmFields: any = {
          amount: -netAmt,
          taxAmount: -taxAmt,
          total: -totalAmt,
          paid: 0,
          xeroBalance: -remaining,
          xeroCustomerId: contactId ?? null,
          xeroSyncedAt: new Date(),
          xeroTenantId: tenantId,
          updatedAt: new Date(),
          paymentStatus: (isFullyApplied ? "Paid" : "Unpaid") as any,
        };

        const existing = ledgerInvByXeroId.get(xeroId);
        if (existing) {
          await db.update(invoices).set(cmFields).where(eq(invoices.id, existing.id));
        } else if (cust) {
          const cnDate = parseXeroDate(cn.Date) || new Date().toISOString().slice(0, 10);
          await db.insert(invoices).values({
            orgId,
            invoiceNumber: `CN-${cn.CreditNoteNumber || cn.CreditNoteID.slice(0, 8)}`,
            customerId: cust.id,
            projectId: null,
            invoiceDate: cnDate,
            dueDate: cnDate,
            currency: cn.CurrencyCode || cust.currency || "EUR",
            paymentTerms: 0,
            collectionStage: "Credit Memo",
            collectionOwnerId: userId,
            xeroId,
            txnType: "CreditMemo",
            ...cmFields,
          });
        }
      }

      if (eventCategory === "CONTACT") {
        const data = await xeroGet(accessToken, tenantId, `Contacts/${resourceId}`);
        const xc = data.Contacts?.[0];
        if (!xc || !xc.IsCustomer) continue;

        const existing = freshCustByXeroId.get(xc.ContactID) || freshCustByCode.get(`XERO-${xc.ContactID}`);
        const payload = {
          name: xc.Name,
          code: `XERO-${xc.ContactID}`,
          xeroId: xc.ContactID,
          country: getContactCountry(xc),
          status: (xc.ContactStatus !== "ARCHIVED" ? "Active" : "Inactive") as any,
          email: getContactEmail(xc) || "",
          phone: getContactPhone(xc) || "",
          updatedAt: new Date(),
        };

        if (existing) {
          await db.update(customers).set(payload).where(eq(customers.id, existing.id));
        } else {
          await db.insert(customers).values({
            orgId,
            currency: "EUR",
            paymentTerms: 30,
            riskRating: "Low" as const,
            accountOwnerId: userId,
            collectionOwnerId: userId,
            companyName: xc.Name || "",
            addressStreet: "",
            addressCity: "",
            addressPostcode: "",
            creditLimit: null,
            taxNumber: xc.TaxNumber || "",
            notes: "",
            ...payload,
          });
        }
      }

    } catch (e: any) {
      console.error(`Xero targeted sync failed for ${change.eventCategory} ${change.resourceId}:`, e?.message);
    }
  }

  // ── Batch PAYMENT processing (GAP-2) ────────────────────────────────────────
  // Two parallel batches instead of 2 serial API calls per payment:
  //   Phase 1: fetch all payments in parallel → collect unique linked invoice IDs
  //   Phase 2: fetch all linked invoices in parallel → update all in parallel
  // Many payments on the same invoice are deduplicated — only one invoice fetch.
  if (batchPayments.length > 0) {
    const fetchedPayments = (await Promise.all(
      batchPayments.map(c =>
        xeroGet(accessToken, tenantId, `Payments/${c.resourceId}`)
          .then((d: any) => d.Payments?.[0] ?? null)
          .catch(() => null)
      )
    )).filter(Boolean);

    const linkedInvIds = [
      ...new Set(fetchedPayments.map((p: any) => p.Invoice?.InvoiceID).filter(Boolean))
    ];

    if (linkedInvIds.length > 0) {
      const linkedInvoices = (await Promise.all(
        linkedInvIds.map((id: string) =>
          xeroGet(accessToken, tenantId, `Invoices/${id}`)
            .then((d: any) => d.Invoices?.[0] ?? null)
            .catch(() => null)
        )
      )).filter(Boolean);

      const payUpdateOps: Promise<any>[] = [];
      for (const xi of linkedInvoices) {
        const total   = parseFloat(xi.Total) || 0;
        const balance = parseFloat(xi.AmountDue) || 0;
        const paid    = Math.max(0, total - balance);
        const isPaid  = xi.Status === "PAID" || balance < 0.005;

        const updateData: any = {
          paid,
          xeroBalance: balance,
          xeroSyncedAt: new Date(),
          paymentStatus: isPaid ? "Paid" : (paid > 0 ? "Partially Paid" : "Unpaid"),
          updatedAt: new Date(),
        };
        if (isPaid) {
          updateData.collectionStage = "Closed";
          const paidAt = parseXeroDate(xi.FullyPaidOnDate);
          if (paidAt) updateData.paidAt = paidAt;
        }

        const existing = ledgerInvByXeroId.get(xi.InvoiceID);
        if (existing) {
          payUpdateOps.push(db.update(invoices).set(updateData).where(eq(invoices.id, existing.id)));
        }
      }
      if (payUpdateOps.length > 0) await Promise.all(payUpdateOps);
    }
  }

  return { apInvoiceIds };
}
