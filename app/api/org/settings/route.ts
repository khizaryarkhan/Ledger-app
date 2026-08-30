import { db } from "@/db";
import { organisations, invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { DEFAULT_STAGES, ensureLockedStages, Stage } from "@/lib/stages";
import { CURRENCY_CODES } from "@/lib/accounting/currencies";

/**
 * Company details printed on outbound documents. One list drives the select,
 * the validation and the update, so a field can't be readable but not saveable.
 * Values are max lengths, matching the column widths in migration 0061.
 */
const COMPANY_FIELD_LIMITS = {
  addressStreet: 255, addressLine2: 255, addressCity: 128, addressState: 128,
  addressPostcode: 32, addressCountry: 64,
  phone: 64, email: 255, website: 255,
  taxNumber: 64, registrationNumber: 64,
  bankName: 255, bankAccountName: 255, bankAccountNumber: 64,
  bankIban: 64, bankSwift: 32, bankBranch: 255,
  documentTerms: 4000, documentFooter: 1000,
  documentAccentColor: 16,
} as const;
type CompanyField = keyof typeof COMPANY_FIELD_LIMITS;
const COMPANY_COLUMNS = Object.fromEntries(
  (Object.keys(COMPANY_FIELD_LIMITS) as CompanyField[]).map(k => [k, (organisations as any)[k]]),
) as Record<CompanyField, any>;

function getStages(org: any): Stage[] {
  const raw = (org?.stages as Stage[] | null) ?? DEFAULT_STAGES;
  return ensureLockedStages(raw);
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Try full select including cron-state columns (added in migration 0003).
  // If those columns don't exist yet in the DB, fall back to a select without them
  // so the rest of the app continues to work before the migration is applied.
  let org: any;
  let lastCronRun: string | null = null;
  let lastCronStats: any = null;

  try {
    const [row] = await db
      .select({
        classificationLevel: organisations.classificationLevel,
        dateFormat: organisations.dateFormat,
        currency: organisations.currency,
        logoUrl: organisations.logoUrl,
        displayName: organisations.displayName,
        name: organisations.name,
        stages: organisations.stages,
        disabledRules: organisations.disabledRules,
        lastCronRun: organisations.lastCronRun,
        lastCronStats: organisations.lastCronStats,
        showPaymentHistory: organisations.showPaymentHistory,
        reportingEnabled: organisations.reportingEnabled,
        multicurrencyEnabled: organisations.multicurrencyEnabled,
        fiscalYearStartMonth: organisations.fiscalYearStartMonth,
        enabledModules: organisations.enabledModules,
      })
      .from(organisations)
      .where(eq(organisations.id, orgId!))
      .limit(1);
    org = row;
    lastCronRun = row?.lastCronRun?.toISOString() ?? null;
    lastCronStats = row?.lastCronStats ?? null;
    org = { ...row, showPaymentHistory: (row as any).showPaymentHistory ?? false, reportingEnabled: (row as any).reportingEnabled ?? false };
  } catch {
    // Columns likely missing — run the 0003 migration. Degrade gracefully.
    const [row] = await db
      .select({
        classificationLevel: organisations.classificationLevel,
        dateFormat: organisations.dateFormat,
        currency: organisations.currency,
        logoUrl: organisations.logoUrl,
        displayName: organisations.displayName,
        name: organisations.name,
        stages: organisations.stages,
        disabledRules: organisations.disabledRules,
      })
      .from(organisations)
      .where(eq(organisations.id, orgId!))
      .limit(1);
    org = row;
  }

  // Company details shown on printed documents (migration 0061). Selected
  // separately and guarded so the settings page still loads on a database where
  // that migration hasn't been applied yet — same reason the block above has a
  // fallback select.
  let company: Record<string, any> = {};
  try {
    const [row] = await db.select(COMPANY_COLUMNS).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    company = row ?? {};
  } catch { company = {}; }

  return ok({
    company,
    classificationLevel: org?.classificationLevel ?? "customer",
    dateFormat: org?.dateFormat ?? "DD MMM YYYY",
    currency: org?.currency ?? "EUR",
    logoUrl: org?.logoUrl ?? null,
    displayName: org?.displayName ?? null,
    name: org?.name ?? "",
    stages: getStages(org),
    disabledRules: (org?.disabledRules as string[]) ?? [],
    lastCronRun,
    lastCronStats,
    showPaymentHistory: org?.showPaymentHistory ?? false,
    reportingEnabled: org?.reportingEnabled ?? false,
    multicurrencyEnabled: org?.multicurrencyEnabled ?? false,
    fiscalYearStartMonth: org?.fiscalYearStartMonth ?? 1,
    enabledModules: (org?.enabledModules as string[]) ?? ["receivables", "payables", "studio", "accounting"],
  });
}

const ALLOWED_DATE_FORMATS = ["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "MMM DD, YYYY"];
const ALLOWED_CURRENCIES = Array.from(new Set([...CURRENCY_CODES, "DKK", "NOK", "SEK"]));
const ALLOWED_COLORS = ["stone", "blue", "violet", "rose", "amber", "orange", "emerald", "cyan", "purple", "pink"];

export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const body = await req.json();
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (body.classificationLevel !== undefined) {
    if (!["customer", "project"].includes(body.classificationLevel)) return bad("Invalid classificationLevel");
    updates.classificationLevel = body.classificationLevel;
  }
  if (body.dateFormat !== undefined) {
    if (!ALLOWED_DATE_FORMATS.includes(body.dateFormat)) return bad("Invalid dateFormat");
    updates.dateFormat = body.dateFormat;
  }
  if (body.currency !== undefined) {
    if (!ALLOWED_CURRENCIES.includes(body.currency)) return bad("Invalid currency");
    // Once multi-currency is enabled the home currency is permanent — changing
    // it would invalidate every stored exchange rate (QBO/Xero enforce this).
    const [cur] = await db.select({ mc: organisations.multicurrencyEnabled, currency: organisations.currency })
      .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    if (cur?.mc && body.currency !== cur.currency) {
      return bad("Home currency can't be changed once multi-currency is enabled.");
    }
    updates.currency = body.currency;
  }
  if (body.multicurrencyEnabled !== undefined) {
    updates.multicurrencyEnabled = !!body.multicurrencyEnabled;
  }
  if (body.fiscalYearStartMonth !== undefined) {
    const m = Number(body.fiscalYearStartMonth);
    if (!Number.isInteger(m) || m < 1 || m > 12) return bad("fiscalYearStartMonth must be 1-12");
    updates.fiscalYearStartMonth = m;
  }
  if (body.logoUrl !== undefined) {
    if (body.logoUrl) {
      const url = String(body.logoUrl).trim();
      // Two accepted forms:
      //  - an https:// URL (Vercel Blob / any CDN) — kept short
      //  - an inline data:image/… URL, used when no Blob store is configured;
      //    the client downscales the logo so this stays well under the cap.
      const isData = url.startsWith("data:image/");
      if (isData) {
        if (url.length > 600_000) return bad("Logo is too large — please use a smaller image.");
      } else {
        if (url.length > 2048) return bad("logoUrl must be 2048 characters or fewer");
        if (!url.startsWith("https://")) return bad("logoUrl must start with https:// (or be an uploaded image)");
      }
      updates.logoUrl = url;
    } else {
      updates.logoUrl = null;
    }
  }
  // Company document details — sent as a nested `company` object so they can be
  // saved as one block from the settings form.
  if (body.company !== undefined && body.company !== null) {
    for (const [key, limit] of Object.entries(COMPANY_FIELD_LIMITS) as [CompanyField, number][]) {
      const raw = (body.company as any)[key];
      if (raw === undefined) continue;
      const val = raw === null ? null : String(raw).trim();
      if (val && val.length > limit) return bad(`${key} must be ${limit} characters or fewer`);
      updates[key] = val || null;
    }
  }
  if (body.displayName !== undefined) {
    if (body.displayName) {
      const name = String(body.displayName).trim();
      if (name.length > 100) return bad("displayName must be 100 characters or fewer");
      updates.displayName = name;
    } else {
      updates.displayName = null;
    }
  }
  if (body.disabledRules !== undefined) {
    if (!Array.isArray(body.disabledRules)) return bad("disabledRules must be an array");
    updates.disabledRules = body.disabledRules.filter((r: any) => typeof r === "string");
  }
  if (body.showPaymentHistory !== undefined) {
    updates.showPaymentHistory = Boolean(body.showPaymentHistory);
  }
  if (body.reportingEnabled !== undefined) {
    updates.reportingEnabled = Boolean(body.reportingEnabled);
  }

  // ── Stages update ──────────────────────────────────────────────────────────
  if (body.stages !== undefined) {
    const incoming: Stage[] = body.stages;

    // Validate
    if (!Array.isArray(incoming) || incoming.length === 0) return bad("stages must be a non-empty array");
    if (incoming.filter(s => s.isDefault).length !== 1) return bad("Exactly one stage must be isDefault");
    if (incoming.filter(s => s.isClosed).length !== 1)  return bad("Exactly one stage must be isClosed");
    for (const s of incoming) {
      if (!s.key || !s.label?.trim()) return bad("Each stage must have a key and label");
      if (!ALLOWED_COLORS.includes(s.color)) return bad(`Invalid color: ${s.color}`);
    }

    // Fetch current stages to detect label renames
    const [currentOrg] = await db.select({ stages: organisations.stages })
      .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    const currentStages: Stage[] = getStages(currentOrg);

    // Build rename map: key → { oldLabel, newLabel } where label changed
    const renames: { oldLabel: string; newLabel: string }[] = [];
    for (const incoming_s of incoming) {
      const current_s = currentStages.find(c => c.key === incoming_s.key);
      if (current_s && current_s.label !== incoming_s.label) {
        renames.push({ oldLabel: current_s.label, newLabel: incoming_s.label.trim() });
      }
    }

    // Apply invoice relabeling for any renames
    for (const { oldLabel, newLabel } of renames) {
      await db.update(invoices)
        .set({ collectionStage: newLabel, updatedAt: new Date() })
        .where(and(eq(invoices.orgId, orgId!), eq(invoices.collectionStage, oldLabel)));
    }

    updates.stages = incoming.map(s => ({ ...s, label: s.label.trim() }));
  }

  await db.update(organisations).set(updates).where(eq(organisations.id, orgId!));

  const [updated] = await db
    .select({
      classificationLevel: organisations.classificationLevel,
      dateFormat: organisations.dateFormat,
      currency: organisations.currency,
      logoUrl: organisations.logoUrl,
      displayName: organisations.displayName,
      name: organisations.name,
      stages: organisations.stages,
      disabledRules: organisations.disabledRules,
      showPaymentHistory: organisations.showPaymentHistory,
      reportingEnabled: organisations.reportingEnabled,
      multicurrencyEnabled: organisations.multicurrencyEnabled,
    })
    .from(organisations)
    .where(eq(organisations.id, orgId!))
    .limit(1);

  // Echo the company block back so the client's cached settings don't go stale
  // after saving it (guarded like the GET, for pre-migration databases).
  let companyAfter: Record<string, any> = {};
  try {
    const [row] = await db.select(COMPANY_COLUMNS).from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    companyAfter = row ?? {};
  } catch { companyAfter = {}; }

  return ok({
    company: companyAfter,
    classificationLevel: updated.classificationLevel,
    dateFormat: updated.dateFormat ?? "DD MMM YYYY",
    currency: updated.currency ?? "EUR",
    multicurrencyEnabled: (updated as any).multicurrencyEnabled ?? false,
    logoUrl: updated.logoUrl ?? null,
    displayName: updated.displayName ?? null,
    name: updated.name,
    stages: getStages(updated),
    disabledRules: (updated.disabledRules as string[]) ?? [],
    showPaymentHistory: updated.showPaymentHistory ?? false,
    reportingEnabled: updated.reportingEnabled ?? false,
  });
}
