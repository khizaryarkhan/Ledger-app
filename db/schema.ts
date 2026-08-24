import { pgTable, text, varchar, integer, real, numeric, timestamp, boolean, jsonb, uuid, uniqueIndex, index, serial, date } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// =========================================================================
// ORGANISATIONS
// =========================================================================
export const organisations = pgTable("organisations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  accountId: uuid("account_id").notNull(), // → crm_accounts.id (Phase 4: required; backfilled)
  groupId: uuid("group_id"), // → org_groups.id; NULL = standalone (not part of a Head Office group)
  classificationLevel: varchar("classification_level", { length: 32 }).notNull().default("customer"), // 'customer' | 'project'
  colRefSeq: integer("col_ref_seq").notNull().default(0),
  dateFormat: varchar("date_format", { length: 32 }).notNull().default("DD MMM YYYY"), // date format preference
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"), // HOME/reporting currency
  multicurrencyEnabled: boolean("multicurrency_enabled").notNull().default(false), // allow foreign-currency entry
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1), // 1-12; e.g. 7 = July (Pakistan FY)
  bookCloseDate: varchar("book_close_date", { length: 16 }), // lock date — entries on/before are locked (except closing)
  logoUrl: text("logo_url"), // org logo URL
  displayName: varchar("display_name", { length: 255 }), // optional display name override
  stages: jsonb("stages"), // customisable collection stages array
  disabledRules: jsonb("disabled_rules").notNull().default([]), // automation rule IDs that are paused
  showPaymentHistory: boolean("show_payment_history").notNull().default(false), // show payment history tab on customer portal
  reportingEnabled: boolean("reporting_enabled").notNull().default(false), // enables the Reporting module in the sidebar
  // Cron run tracking — updated at the end of every cron execution
  lastCronRun:   timestamp("last_cron_run"),
  lastCronStats: jsonb("last_cron_stats"), // { escalated, emailsSent, skipped, errors[] }
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Organisation = typeof organisations.$inferSelect;

// Group Accounts — a Head Office / group spine that branch organisations map into.
// A group is a first-class entity (name, branding, joint-account view). Membership
// lives on organisations.group_id. head_office_org_id optionally designates which
// member acts as the operating Head Office (NULL = pure container group).
export const orgGroups = pgTable("org_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  headOfficeOrgId: uuid("head_office_org_id"), // → organisations.id; NULL = pure container
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type OrgGroup = typeof orgGroups.$inferSelect;

// Group-level access — which users may see a Group Account's consolidated view.
// role: 'ho_manager' (full across the group) | 'ho_finance' (receivables across
// the group). Independent of a user's per-org membership in user_organisations,
// so a person can be a branch user AND hold Head-Office access here.
export const orgGroupUsers = pgTable("org_group_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").notNull(), // → org_groups.id
  userId: uuid("user_id").notNull(),   // → users.id
  role: varchar("role", { length: 32 }).notNull().default("ho_finance"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type OrgGroupUser = typeof orgGroupUsers.$inferSelect;

// =========================================================================
// REPS — defined before users so users can FK to reps
// =========================================================================
export const reps = pgTable("reps", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  tier: varchar("tier", { length: 16 }).notNull().default("rep"), // 'rep' | 'rd' | 'ed'
  managerId: uuid("manager_id").references((): any => reps.id, { onDelete: "set null" }), // ED/RD this rep reports to
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Rep = typeof reps.$inferSelect;

// =========================================================================
// REGIONS — defined before customers/projects
// =========================================================================
export const regions = pgTable("regions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Region = typeof regions.$inferSelect;

// =========================================================================
// USER → ORGANISATION membership (many-to-many)
// =========================================================================
export const userOrganisations = pgTable("user_organisations", {
  id:     uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId:  uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  role:   varchar("role", { length: 32 }).notNull().default("company_user"),
});
export type UserOrganisation = typeof userOrganisations.$inferSelect;

// =========================================================================
// USERS
// =========================================================================
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("company_user"),
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  repId: uuid("rep_id").references(() => reps.id, { onDelete: "set null" }),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  schedulingUrl: text("scheduling_url"), // rep's Calendly (or similar) booking link
  // TOTP multi-factor auth (currently enforced for super_admins who enrol).
  // mfaSecret is encrypted at rest (lib/crypto); recovery codes are bcrypt-hashed.
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecret: text("mfa_secret"),
  mfaRecoveryCodes: jsonb("mfa_recovery_codes").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// PENDING REGISTRATIONS — self-service signup before payment
// =========================================================================
export const pendingRegistrations = pgTable("pending_registrations", {
  id:               uuid("id").defaultRandom().primaryKey(),
  companyName:      varchar("company_name",  { length: 255 }).notNull(),
  adminName:        varchar("admin_name",    { length: 255 }).notNull(),
  adminEmail:       varchar("admin_email",   { length: 255 }).notNull(),
  otp:              varchar("otp",           { length: 6 }).notNull(),
  otpExpiry:        timestamp("otp_expiry").notNull(),
  emailVerified:    boolean("email_verified").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSessionId:  text("stripe_session_id"),
  // 'pending' | 'email_verified' | 'paid' | 'completed'
  status:           varchar("status", { length: 32 }).notNull().default("pending"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
});
export type PendingRegistration = typeof pendingRegistrations.$inferSelect;

// =========================================================================
// SUBSCRIPTIONS — Stripe billing per org
// =========================================================================
export const subscriptions = pgTable("subscriptions", {
  id:                     uuid("id").defaultRandom().primaryKey(),
  orgId:                  uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  stripeCustomerId:       text("stripe_customer_id"),
  stripeSubscriptionId:   text("stripe_subscription_id"),
  stripePriceId:          text("stripe_price_id"),
  status:                 varchar("status", { length: 32 }).notNull().default("active"),
  // 'active' | 'trialing' | 'past_due' | 'cancelled' | 'unpaid' | 'incomplete' | 'incomplete_expired'
  currentPeriodStart:     timestamp("current_period_start"),
  currentPeriodEnd:       timestamp("current_period_end"),
  cancelAt:               timestamp("cancel_at"),
  cancelAtPeriodEnd:      boolean("cancel_at_period_end").notNull().default(false),
  trialEnd:               timestamp("trial_end"),
  billingEmail:           varchar("billing_email", { length: 255 }),
  planName:               varchar("plan_name", { length: 128 }),
  planAmount:             integer("plan_amount"),         // amount in pence/cents
  planInterval:           varchar("plan_interval", { length: 16 }), // 'month' | 'year'
  planCurrency:           varchar("plan_currency", { length: 8 }),
  lastPaymentStatus:      varchar("last_payment_status", { length: 32 }), // 'paid' | 'failed' | null
  lastPaymentAmount:      integer("last_payment_amount"),
  lastPaymentDate:        timestamp("last_payment_date"),
  paymentMethodBrand:     varchar("payment_method_brand", { length: 32 }), // 'visa' | 'mastercard' etc
  paymentMethodLast4:     varchar("payment_method_last4", { length: 4 }),
  stripeUpdatedAt:        timestamp("stripe_updated_at"), // last time Stripe data was synced
  createdAt:              timestamp("created_at").notNull().defaultNow(),
  // ── Hybrid billing ─────────────────────────────────────────────────────
  // 'stripe' = auto-managed by Stripe webhooks
  // 'manual' = Super Admin controlled (bank transfer, offline payment, etc.)
  source:              varchar("source", { length: 16 }).notNull().default("stripe"),
  manualExpiresAt:     timestamp("manual_expires_at"),
  manualPaymentStatus: varchar("manual_payment_status", { length: 32 }),
  manualInvoiceRef:    varchar("manual_invoice_ref", { length: 128 }),
  manualNotes:         text("manual_notes"),
  managedByAdminId:    uuid("managed_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  managedAt:           timestamp("managed_at"),
}, (t) => ({
  idx_subscriptions_org_id: index("idx_subscriptions_org_id").on(t.orgId),
}));
export type Subscription = typeof subscriptions.$inferSelect;

// =========================================================================
// CANCELLATION REQUESTS
// =========================================================================
export const cancellationRequests = pgTable("cancellation_requests", {
  id:                       uuid("id").defaultRandom().primaryKey(),
  organizationId:           uuid("organization_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  stripeCustomerId:         text("stripe_customer_id"),
  stripeSubscriptionId:     text("stripe_subscription_id"),
  requestedByUserId:        uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  requestedByEmail:         varchar("requested_by_email", { length: 255 }),
  reason:                   text("reason"),
  // 'pending' | 'approved' | 'rejected' | 'cancelled'
  status:                   varchar("status", { length: 32 }).notNull().default("pending"),
  requestedAt:              timestamp("requested_at").notNull().defaultNow(),
  reviewedAt:               timestamp("reviewed_at"),
  reviewedByAdminId:        uuid("reviewed_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  // 'immediate' | '30_days' | '60_days' | '90_days' | 'period_end' | 'rejected'
  adminDecision:            varchar("admin_decision", { length: 32 }),
  cancellationEffectiveDate: timestamp("cancellation_effective_date"),
  internalNotes:            text("internal_notes"),
  stripeActionStatus:       varchar("stripe_action_status", { length: 32 }), // 'pending' | 'applied' | 'failed'
  createdAt:                timestamp("created_at").notNull().defaultNow(),
  updatedAt:                timestamp("updated_at").notNull().defaultNow(),
});
export type CancellationRequest = typeof cancellationRequests.$inferSelect;

// =========================================================================
// LANDING PAGE REQUESTS / LEADS
// =========================================================================
export const landingPageRequests = pgTable("landing_page_requests", {
  id:               uuid("id").defaultRandom().primaryKey(),
  fullName:         varchar("full_name", { length: 255 }).notNull(),
  companyName:      varchar("company_name", { length: 255 }),
  email:            varchar("email", { length: 255 }).notNull(),
  phone:            varchar("phone", { length: 64 }),
  country:          varchar("country", { length: 100 }),
  companySize:      varchar("company_size", { length: 64 }),
  interestedService: varchar("interested_service", { length: 128 }),
  message:          text("message"),
  source:           varchar("source", { length: 64 }).notNull().default("landing_page"),
  // 'new' | 'contacted' | 'qualified' | 'converted' | 'rejected' | 'archived'
  status:           varchar("status", { length: 32 }).notNull().default("new"),
  accountId:        uuid("account_id").notNull(), // → crm_accounts.id (Phase 4: required; backfilled)
  assignedToAdminId: uuid("assigned_to_admin_id").references(() => users.id, { onDelete: "set null" }),
  adminNotes:       text("admin_notes"),
  utmSource:        varchar("utm_source", { length: 128 }),
  utmMedium:        varchar("utm_medium", { length: 128 }),
  utmCampaign:      varchar("utm_campaign", { length: 128 }),
  campaignId:       uuid("campaign_id"), // → crm_campaigns.id (attribution; soft link)
  // Unified pipeline: a lead carries its own deal value once it reaches a deal
  // stage (proposal+). Replaces the separate opportunities object. Major units.
  value:            integer("value"),
  dealCurrency:     varchar("deal_currency", { length: 3 }),
  expectedCloseDate: timestamp("expected_close_date"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});
export type LandingPageRequest = typeof landingPageRequests.$inferSelect;

// =========================================================================
// LEAD NOTES (threaded chat per lead — platform admin only)
// =========================================================================
export const leadNotes = pgTable("lead_notes", {
  id:        uuid("id").defaultRandom().primaryKey(),
  leadId:    uuid("lead_id").notNull().references(() => landingPageRequests.id, { onDelete: "cascade" }),
  authorId:  uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  authorName: varchar("author_name", { length: 255 }).notNull(),
  body:      text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type LeadNote = typeof leadNotes.$inferSelect;

// =========================================================================
// LEAD EMAIL TEMPLATES (platform admin — reusable lead outreach templates)
// =========================================================================
export const leadEmailTemplates = pgTable("lead_email_templates", {
  id:        uuid("id").defaultRandom().primaryKey(),
  name:      varchar("name", { length: 255 }).notNull(),
  subject:   varchar("subject", { length: 500 }).notNull(),
  body:      text("body").notNull(),
  stage:     varchar("stage", { length: 32 }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type LeadEmailTemplate = typeof leadEmailTemplates.$inferSelect;

// =========================================================================
// LEAD TASKS (follow-up tasks per lead — platform admin only)
// =========================================================================
export const leadTasks = pgTable("lead_tasks", {
  id:          uuid("id").defaultRandom().primaryKey(),
  // Account-scoped: a task belongs to a company. leadId is optional (kept for the
  // lead cockpit + back-compat); accountId is the durable owner so tasks work for
  // any company — including customers with no lead record.
  leadId:      uuid("lead_id").references(() => landingPageRequests.id, { onDelete: "cascade" }),
  accountId:   uuid("account_id"),
  title:       varchar("title", { length: 500 }).notNull(),
  dueDate:     timestamp("due_date"),
  assignedTo:  uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  createdBy:   uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  // Richer tasks (P2): priority drives queue ordering; type drives the icon.
  priority:    varchar("priority", { length: 12 }).notNull().default("normal"), // low | normal | high
  type:        varchar("type", { length: 16 }).notNull().default("todo"),       // todo | call | email | follow_up
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
export type LeadTask = typeof leadTasks.$inferSelect;

// =========================================================================
// EMAIL SEQUENCES (drip campaigns for leads — platform admin only)
// =========================================================================
export const leadSequences = pgTable("lead_sequences", {
  id:          uuid("id").defaultRandom().primaryKey(),
  name:        varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isActive:    boolean("is_active").notNull().default(true),
  createdBy:   uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});
export type LeadSequence = typeof leadSequences.$inferSelect;

export const leadSequenceSteps = pgTable("lead_sequence_steps", {
  id:         uuid("id").defaultRandom().primaryKey(),
  sequenceId: uuid("sequence_id").notNull().references(() => leadSequences.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  delayDays:  integer("delay_days").notNull().default(1),
  subject:    varchar("subject", { length: 500 }).notNull(),
  body:       text("body").notNull(),
});
export type LeadSequenceStep = typeof leadSequenceSteps.$inferSelect;

export const leadSequenceEnrollments = pgTable("lead_sequence_enrollments", {
  id:          uuid("id").defaultRandom().primaryKey(),
  leadId:      uuid("lead_id").notNull().references(() => landingPageRequests.id, { onDelete: "cascade" }),
  sequenceId:  uuid("sequence_id").notNull().references(() => leadSequences.id, { onDelete: "cascade" }),
  status:      varchar("status", { length: 50 }).notNull().default("active"),
  enrolledAt:  timestamp("enrolled_at").notNull().defaultNow(),
  enrolledBy:  uuid("enrolled_by").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
});
export type LeadSequenceEnrollment = typeof leadSequenceEnrollments.$inferSelect;

export const leadSequenceSends = pgTable("lead_sequence_sends", {
  id:           uuid("id").defaultRandom().primaryKey(),
  enrollmentId: uuid("enrollment_id").notNull().references(() => leadSequenceEnrollments.id, { onDelete: "cascade" }),
  stepId:       uuid("step_id").notNull().references(() => leadSequenceSteps.id, { onDelete: "cascade" }),
  scheduledAt:  timestamp("scheduled_at").notNull(),
  sentAt:       timestamp("sent_at"),
  status:       varchar("status", { length: 50 }).notNull().default("pending"),
  errorMessage: text("error_message"),
});
export type LeadSequenceSend = typeof leadSequenceSends.$inferSelect;

// =========================================================================
// GUIDE PAGES (editable in-app help — one row per guide: 'customer' | 'admin')
// =========================================================================
export const guidePages = pgTable("guide_pages", {
  id:        uuid("id").defaultRandom().primaryKey(),
  key:       varchar("key", { length: 32 }).notNull().unique(), // 'customer' | 'admin'
  title:     varchar("title", { length: 255 }).notNull(),
  subtitle:  text("subtitle"),
  sections:  jsonb("sections").notNull().default([]), // GuideSection[] (icon stored as name)
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});
export type GuidePage = typeof guidePages.$inferSelect;

// =========================================================================
// OPPORTUNITIES / DEALS (admin sales pipeline — admin.primeaccountax.com)
// A deal sits on a Lead (landing_page_requests) and, once won, can link to the
// billing organisation. Value is stored in MAJOR currency units (e.g. 5000 = €5,000).
// =========================================================================
export const opportunities = pgTable("opportunities", {
  id:               uuid("id").defaultRandom().primaryKey(),
  leadId:           uuid("lead_id").references(() => landingPageRequests.id, { onDelete: "set null" }),
  orgId:            uuid("org_id").references(() => organisations.id, { onDelete: "set null" }),
  accountId:        uuid("account_id").notNull(), // → crm_accounts.id (Phase 4: required; backfilled)
  title:            varchar("title", { length: 255 }).notNull(),
  value:            integer("value").notNull().default(0),
  currency:         varchar("currency", { length: 3 }).notNull().default("USD"),
  confidence:       integer("confidence").notNull().default(50), // 0-100
  stage:            varchar("stage", { length: 40 }).notNull().default("discovery"),
  status:           varchar("status", { length: 20 }).notNull().default("open"), // open | won | lost
  expectedCloseDate: timestamp("expected_close_date"),
  wonAt:            timestamp("won_at"),
  lostAt:           timestamp("lost_at"),
  lostReason:       text("lost_reason"),
  ownerId:          uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdBy:        uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  // Billing link — the deal's own record of what was invoiced (single source of
  // truth on the deal; Stripe remains the source of truth for the money itself).
  stripeInvoiceId:  varchar("stripe_invoice_id", { length: 255 }),
  invoiceUrl:       text("invoice_url"),
  invoiceTotal:     integer("invoice_total"),   // smallest unit (cents)
  invoiceCurrency:  varchar("invoice_currency", { length: 3 }),
  invoiceStatus:    varchar("invoice_status", { length: 20 }), // open | paid | void | ...
  invoicedAt:       timestamp("invoiced_at"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});
export type Opportunity = typeof opportunities.$inferSelect;

// =========================================================================
// LEAD CONTACTS (people belonging to a Lead/company — the CRM relational spine)
// =========================================================================
export const leadContacts = pgTable("lead_contacts", {
  id:        uuid("id").defaultRandom().primaryKey(),
  leadId:    uuid("lead_id").notNull().references(() => landingPageRequests.id, { onDelete: "cascade" }),
  name:      varchar("name", { length: 255 }).notNull(),
  email:     varchar("email", { length: 255 }),
  phone:     varchar("phone", { length: 64 }),
  title:     varchar("title", { length: 255 }),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type LeadContact = typeof leadContacts.$inferSelect;

// =========================================================================
// CRM ACCOUNTS (the company spine — one row per real company, whole lifecycle)
// Everything (leads, contacts, opportunities, the billing org, subscription)
// links to this. matchKey enforces dedup (domain → normalized name → email).
// =========================================================================
export const crmAccounts = pgTable("crm_accounts", {
  id:              uuid("id").defaultRandom().primaryKey(),
  // Human-friendly sequential reference (display: PA-00001). Auto-assigned by the
  // DB sequence on insert; the canonical, patterned Organisation/Account ID.
  refSeq:          serial("ref_seq"),
  name:            varchar("name", { length: 255 }).notNull(),
  matchKey:        varchar("match_key", { length: 255 }).notNull().unique(),
  domain:          varchar("domain", { length: 255 }),
  billingEmail:    varchar("billing_email", { length: 255 }),
  phone:           varchar("phone", { length: 64 }),
  country:         varchar("country", { length: 100 }),
  industry:        varchar("industry", { length: 128 }),
  // lead | prospect | qualified | customer | churned | archived
  lifecycleStage:  varchar("lifecycle_stage", { length: 32 }).notNull().default("lead"),
  organisationId:  uuid("organisation_id").references(() => organisations.id, { onDelete: "set null" }),
  stripeCustomerId: text("stripe_customer_id"),
  ownerAdminId:    uuid("owner_admin_id").references(() => users.id, { onDelete: "set null" }),
  status:          varchar("status", { length: 20 }).notNull().default("active"),
  // Set when the first invoice/subscription is created — flips a Won deal out of
  // the Accounts action-queue and into the Customers book (the "billed" trigger).
  firstInvoicedAt: timestamp("first_invoiced_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});
export type CrmAccount = typeof crmAccounts.$inferSelect;

// =========================================================================
// CRM ACTIVITIES — the durable, typed activity timeline (admin portal).
// One row per event on an account: email sent/received, call logged, note,
// task created/completed, status/stage change, sequence enrolled/sent, deal
// created/moved, invoice issued, payment received, account created, owner set.
// This is the single source of truth for "what happened" on a company — the
// Account 360 timeline reads from here. Write via lib/admin/activities.logActivity.
// =========================================================================
export const crmActivities = pgTable("crm_activities", {
  id:            uuid("id").defaultRandom().primaryKey(),
  accountId:     uuid("account_id").references(() => crmAccounts.id, { onDelete: "cascade" }),
  leadId:        uuid("lead_id"),         // soft link (no FK — leads may be pruned)
  orgId:         uuid("org_id"),          // soft link
  opportunityId: uuid("opportunity_id"),  // soft link
  // email_sent | email_received | call_logged | note_added | task_created |
  // task_completed | status_changed | sequence_enrolled | sequence_sent |
  // deal_created | deal_moved | invoice_issued | payment_received |
  // account_created | owner_assigned | customer_activated
  type:          varchar("type", { length: 40 }).notNull(),
  title:         varchar("title", { length: 300 }).notNull(),
  body:          text("body"),
  meta:          jsonb("meta"),           // type-specific extras (amounts, ids, links)
  actorId:       uuid("actor_id"),        // admin who did it (null = system/automation)
  actorName:     varchar("actor_name", { length: 255 }),
  occurredAt:    timestamp("occurred_at").notNull().defaultNow(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});
export type CrmActivity = typeof crmActivities.$inferSelect;

// =========================================================================
// CRM EMAILS — durable, threaded email store (admin portal). Every outbound
// 1:1 / sequence email and every captured inbound reply is persisted here and
// linked to its account, so the conversation lives in the CRM (not just the
// mailbox). Threaded by a normalized-subject key + RFC Message-ID / In-Reply-To.
// =========================================================================
export const crmEmails = pgTable("crm_emails", {
  id:            uuid("id").defaultRandom().primaryKey(),
  accountId:     uuid("account_id").references(() => crmAccounts.id, { onDelete: "cascade" }),
  leadId:        uuid("lead_id"),   // soft link
  orgId:         uuid("org_id"),    // soft link
  direction:     varchar("direction", { length: 8 }).notNull(),   // outbound | inbound
  threadKey:     varchar("thread_key", { length: 255 }).notNull(), // normalized subject (groups a conversation)
  messageId:     varchar("message_id", { length: 998 }),           // RFC Message-ID (dedup)
  inReplyTo:     varchar("in_reply_to", { length: 998 }),
  fromAddr:      varchar("from_addr", { length: 320 }).notNull(),
  toAddr:        text("to_addr").notNull(),
  cc:            text("cc"),
  subject:       varchar("subject", { length: 500 }),
  snippet:       varchar("snippet", { length: 500 }),
  bodyHtml:      text("body_html"),
  bodyText:      text("body_text"),
  mailboxUserId: uuid("mailbox_user_id"), // the admin mailbox involved
  occurredAt:    timestamp("occurred_at").notNull().defaultNow(), // sent/received time
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});
export type CrmEmail = typeof crmEmails.$inferSelect;

// =========================================================================
// CRM CAMPAIGNS — first-class marketing campaigns + attribution. A lead is
// attributed to a campaign when its utm_campaign / utm_source / source matches
// the campaign's utmKey (or by manual assignment). Powers source/campaign ROI.
// =========================================================================
export const crmCampaigns = pgTable("crm_campaigns", {
  id:        uuid("id").defaultRandom().primaryKey(),
  name:      varchar("name", { length: 200 }).notNull(),
  channel:   varchar("channel", { length: 32 }).notNull().default("other"), // email | ads | social | event | referral | content | other
  utmKey:    varchar("utm_key", { length: 120 }),  // matched against utm_campaign / utm_source / source
  status:    varchar("status", { length: 16 }).notNull().default("active"),  // active | ended
  startDate: varchar("start_date", { length: 16 }),
  endDate:   varchar("end_date", { length: 16 }),
  budget:    integer("budget"),       // minor units (optional)
  notes:     text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type CrmCampaign = typeof crmCampaigns.$inferSelect;

// =========================================================================
// FORECAST SNAPSHOTS — a daily point-in-time capture of pipeline & funnel
// metrics, so leaders can see TRENDS (is pipeline growing? win rate moving?).
// One row per day (idempotent re-capture). Written by the forecast cron.
// =========================================================================
export const forecastSnapshots = pgTable("forecast_snapshots", {
  id:               uuid("id").defaultRandom().primaryKey(),
  snapshotDate:     varchar("snapshot_date", { length: 16 }).notNull(), // YYYY-MM-DD
  openPipeline:     integer("open_pipeline").notNull().default(0),       // major units
  weightedPipeline: integer("weighted_pipeline").notNull().default(0),
  wonValue:         integer("won_value").notNull().default(0),
  openDeals:        integer("open_deals").notNull().default(0),
  customers:        integer("customers").notNull().default(0),
  activeLeads:      integer("active_leads").notNull().default(0),
  mrr:              integer("mrr").notNull().default(0),                 // minor units
  byStage:          jsonb("by_stage"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
});
export type ForecastSnapshot = typeof forecastSnapshots.$inferSelect;

// =========================================================================
// CRM QUOTES (CPQ) — a priced proposal for an account/deal with line items.
// Lives in the CRM; an accepted quote can be converted into a Stripe invoice
// via the existing billing flow. Amounts in MINOR units (cents).
// =========================================================================
export const crmQuotes = pgTable("crm_quotes", {
  id:            uuid("id").defaultRandom().primaryKey(),
  refSeq:        serial("ref_seq"), // display: Q-00001
  accountId:     uuid("account_id").references(() => crmAccounts.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id"), // soft link
  orgId:         uuid("org_id"),         // soft link
  status:        varchar("status", { length: 16 }).notNull().default("draft"), // draft|sent|accepted|declined|expired
  currency:      varchar("currency", { length: 3 }).notNull().default("USD"),
  lineItems:     jsonb("line_items").notNull().default([]), // [{description, qty, unitPrice}]
  subtotal:      integer("subtotal").notNull().default(0),
  total:         integer("total").notNull().default(0),
  validUntil:    varchar("valid_until", { length: 16 }),
  notes:         text("notes"),
  invoiceId:     varchar("invoice_id", { length: 255 }), // set when converted to a Stripe invoice
  createdBy:     uuid("created_by"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
});
export type CrmQuote = typeof crmQuotes.$inferSelect;

// =========================================================================
// CATALOG ITEMS (reusable products/services for invoices — admin portal)
// =========================================================================
export const catalogItems = pgTable("catalog_items", {
  id:          uuid("id").defaultRandom().primaryKey(),
  name:        varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  unitAmount:  integer("unit_amount").notNull().default(0), // smallest unit (cents)
  currency:    varchar("currency", { length: 3 }).notNull().default("eur"),
  taxRate:     integer("tax_rate"), // optional %, basis points not needed yet
  active:      boolean("active").notNull().default(true),
  createdBy:   uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});
export type CatalogItem = typeof catalogItems.$inferSelect;

// =========================================================================
// STRIPE WEBHOOK EVENTS (idempotency guard + audit/replay of webhooks)
// =========================================================================
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id:            uuid("id").defaultRandom().primaryKey(),
  stripeEventId: varchar("stripe_event_id", { length: 255 }).notNull().unique(),
  eventType:     varchar("event_type", { length: 100 }).notNull(),
  status:        varchar("status", { length: 20 }).notNull().default("processing"), // processing | processed | error
  error:         text("error"),
  payload:       jsonb("payload"),
  receivedAt:    timestamp("received_at").notNull().defaultNow(),
  processedAt:   timestamp("processed_at"),
});
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;

// =========================================================================
// ADMIN EMAIL ACCOUNTS (per platform-admin mailbox — IMAP/SMTP, admin portal)
// Each admin connects their own @primeaccountax.com mailbox to send/receive
// inside the portal. The password is encrypted at rest via lib/crypto.
// =========================================================================
export const adminEmailAccounts = pgTable("admin_email_accounts", {
  id:           uuid("id").defaultRandom().primaryKey(),
  userId:       uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  emailAddress: varchar("email_address", { length: 255 }).notNull(),
  fromName:     varchar("from_name", { length: 255 }),
  imapHost:     varchar("imap_host", { length: 255 }).notNull(),
  imapPort:     integer("imap_port").notNull().default(993),
  smtpHost:     varchar("smtp_host", { length: 255 }).notNull(),
  smtpPort:     integer("smtp_port").notNull().default(465),
  username:     varchar("username", { length: 255 }).notNull(),
  passwordEnc:  text("password_enc").notNull(), // AES-256-GCM via lib/crypto
  status:       varchar("status", { length: 20 }).notNull().default("connected"), // connected | error
  lastError:    text("last_error"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});
export type AdminEmailAccount = typeof adminEmailAccounts.$inferSelect;

// =========================================================================
// BILLING AUDIT LOG
// =========================================================================
export const billingAuditLogs = pgTable("billing_audit_logs", {
  id:                     uuid("id").defaultRandom().primaryKey(),
  organizationId:         uuid("organization_id").references(() => organisations.id, { onDelete: "set null" }),
  cancellationRequestId:  uuid("cancellation_request_id").references(() => cancellationRequests.id, { onDelete: "set null" }),
  actorUserId:            uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorRole:              varchar("actor_role", { length: 32 }),
  action:                 varchar("action", { length: 64 }).notNull(), // e.g. 'cancellation_requested' | 'cancellation_approved' | 'subscription_reactivated'
  previousStatus:         varchar("previous_status", { length: 32 }),
  newStatus:              varchar("new_status", { length: 32 }),
  stripeEventId:          varchar("stripe_event_id", { length: 128 }),
  stripeActionStatus:     varchar("stripe_action_status", { length: 32 }),
  metadata:               jsonb("metadata"),
  createdAt:              timestamp("created_at").notNull().defaultNow(),
});
export type BillingAuditLog = typeof billingAuditLogs.$inferSelect;

// =========================================================================
// TEMPORARY ACCESS REQUESTS
// =========================================================================
export const tempAccessRequests = pgTable("temp_access_requests", {
  id:                  uuid("id").defaultRandom().primaryKey(),
  orgId:               uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  requestedByUserId:   uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  requestedByEmail:    varchar("requested_by_email", { length: 255 }),
  reason:              text("reason"),
  // 'pending' | 'approved' | 'rejected'
  status:              varchar("status", { length: 32 }).notNull().default("pending"),
  reviewedByAdminId:   uuid("reviewed_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt:          timestamp("reviewed_at"),
  expiresAt:           timestamp("expires_at"),   // set by admin on approval
  adminNotes:          text("admin_notes"),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idx_temp_access_org_id: index("idx_temp_access_org_id").on(t.orgId),
}));
export type TempAccessRequest = typeof tempAccessRequests.$inferSelect;

// =========================================================================
// CUSTOMERS
// =========================================================================
export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  country: varchar("country", { length: 64 }),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  paymentTerms: integer("payment_terms").notNull().default(30),
  taxNumber: varchar("tax_number", { length: 64 }),
  riskRating: varchar("risk_rating", { length: 16 }).notNull().default("Low"),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  creditLimit: real("credit_limit"),
  accountOwnerId: uuid("account_owner_id").references(() => users.id),
  collectionOwnerId: uuid("collection_owner_id").references(() => users.id),
  repId: uuid("rep_id").references(() => reps.id, { onDelete: "set null" }),
  regionId: uuid("region_id").references(() => regions.id, { onDelete: "set null" }),
  notes: text("notes"),
  phone: varchar("phone", { length: 64 }),
  mobile: varchar("mobile", { length: 64 }),
  email: varchar("email", { length: 255 }),
  website: varchar("website", { length: 255 }),
  firstName: varchar("first_name", { length: 128 }),
  lastName: varchar("last_name", { length: 128 }),
  companyName: varchar("company_name", { length: 255 }),
  addressStreet: varchar("address_street", { length: 255 }),
  addressLine2: varchar("address_line2", { length: 255 }),
  addressCity: varchar("address_city", { length: 128 }),
  addressState: varchar("address_state", { length: 128 }),
  addressPostcode: varchar("address_postcode", { length: 32 }),
  qboId: varchar("qbo_id", { length: 64 }),
  xeroId: varchar("xero_id", { length: 64 }),   // Xero ContactID
  sageIntacctId: varchar("sage_intacct_id", { length: 64 }), // Sage Intacct CUSTOMERID
  chaseByProject: boolean("chase_by_project").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // code is unique within an org — two orgs can share the same QBO customer code
  orgCodeUnique: uniqueIndex("customers_org_code_unique").on(t.orgId, t.code),
}));

// =========================================================================
// CONTACTS
// =========================================================================
export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 64 }),
  type: varchar("type", { length: 32 }).notNull().default("Billing"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isEscalation: boolean("is_escalation").notNull().default(false),
  receivesAuto: boolean("receives_auto").notNull().default(true),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  // When to next send an automated email to this contact. NULL = send on next cron run.
  nextSendAt: timestamp("next_send_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// PROJECTS
// =========================================================================
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  repId: uuid("rep_id").references(() => reps.id, { onDelete: "set null" }),
  regionId: uuid("region_id").references(() => regions.id, { onDelete: "set null" }),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  qboId: varchar("qbo_id", { length: 64 }), // QBO sub-customer Id
  xeroId: varchar("xero_id", { length: 64 }), // Xero tracking category / job Id (future)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// INVOICES
// =========================================================================
export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invoiceNumber: varchar("invoice_number", { length: 64 }).notNull(), // display only — not unique
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceDate: varchar("invoice_date", { length: 16 }).notNull(),
  dueDate: varchar("due_date", { length: 16 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").notNull().default(0),
  total: real("total").notNull(),
  paid: real("paid").notNull().default(0),
  paymentTerms: integer("payment_terms").notNull().default(30),
  paymentStatus: varchar("payment_status", { length: 32 }).notNull().default("Unpaid"),
  collectionStage:   varchar("collection_stage",   { length: 64 }).notNull().default("New"),
  collectionOwnerId: uuid("collection_owner_id").references(() => users.id),
  escalatedToUserId: uuid("escalated_to_user_id").references(() => users.id),
  escalatedToName:   varchar("escalated_to_name",  { length: 255 }),
  escalatedToEmail:  varchar("escalated_to_email", { length: 255 }),
  escalationType:    varchar("escalation_type", { length: 64 }),  // label from lib/escalation-types.ts — the "why"
  escalationNote:    text("escalation_note"),                     // optional context from the rep for the assignee
  escalatedAt:       timestamp("escalated_at"),                   // when the invoice entered Escalated
  poNumber: varchar("po_number", { length: 64 }),
  notes: text("notes"),
  disputeReason: text("dispute_reason"),
  disputeDate: varchar("dispute_date", { length: 16 }),
  promiseDate: varchar("promise_date", { length: 16 }),
  lastFollowupDate: varchar("last_followup_date", { length: 16 }),
  nextActionDate: varchar("next_action_date", { length: 16 }), // board "chase again on" queue date
  billingEmail: text("billing_email"), // QBO BillEmail — may contain multiple comma-separated addresses
  qboId: varchar("qbo_id", { length: 64 }), // QBO internal transaction ID — unique source of truth
  qboBalance: real("qbo_balance"),
  qboCustomerId: varchar("qbo_customer_id", { length: 64 }),
  qboSyncedAt: timestamp("qbo_synced_at"),
  xeroId: varchar("xero_id", { length: 64 }), // Xero InvoiceID / CreditNoteID
  xeroBalance: real("xero_balance"),            // AmountDue from Xero
  xeroCustomerId: varchar("xero_customer_id", { length: 64 }), // Xero ContactID
  xeroSyncedAt: timestamp("xero_synced_at"),
  xeroTenantId: varchar("xero_tenant_id", { length: 64 }), // which Xero org this came from
  sageIntacctId: varchar("sage_intacct_id", { length: 64 }), // Sage Intacct RECORDNO (prefix CM- for credit memos)
  sageIntacctBalance: real("sage_intacct_balance"),
  sageIntacctCustomerId: varchar("sage_intacct_customer_id", { length: 64 }),
  sageIntacctSyncedAt: timestamp("sage_intacct_synced_at"),
  txnType: varchar("txn_type", { length: 32 }).default("Invoice"),
  journalEntryId: uuid("journal_entry_id"), // native invoices: the GL entry this row bridges
  paidAt: varchar("paid_at", { length: 16 }), // Date payment was received (YYYY-MM-DD) — NULL if unpaid
  // ── Customer Response Portal derived/cached state ──────────────────────
  promiseAmount:     real("promise_amount"),                              // current promise amount (null = full)
  promiseSource:     varchar("promise_source", { length: 24 }),           // Customer Portal | Rep | Accountant
  hasOpenDispute:    boolean("has_open_dispute").notNull().default(false),
  automationsPaused: boolean("automations_paused").notNull().default(false), // true while a dispute is open
  lineItems: jsonb("line_items").default([]), // [{description, qty, unitPrice, amount}] cached from source system
  source:    varchar("source", { length: 16 }).notNull().default("native"), // 'native' | 'qbo' | 'xero' | 'sage'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // qboId is unique per org — prevents duplicate QBO invoices on re-sync
  orgQboIdUnique: uniqueIndex("invoices_org_qbo_id_unique")
    .on(t.orgId, t.qboId)
    .where(sql`${t.qboId} IS NOT NULL`),
  orgSageIdUnique: uniqueIndex("invoices_org_sage_id_unique")
    .on(t.orgId, t.sageIntacctId)
    .where(sql`${t.sageIntacctId} IS NOT NULL`),
}));

// =========================================================================
// CUSTOMER RESPONSE PORTAL
// A tokenised, no-login portal sent to customers by email. Lets them set
// promise-to-pay dates and/or raise disputes on their open invoices.
//
// Promises and disputes are modelled as first-class EVENTS (one row each)
// rather than single fields on the invoice, so we keep a full audit timeline
// and can capture multiple sources (Customer Portal / Rep / Accountant).
// The invoices table caches the current derived state for fast filtering.
// =========================================================================

// One token = one "request" covering a snapshot of the customer's open
// invoices. The customer responds once; submitting marks it Completed and the
// link dies. A new request issues a fresh token.
export const customerPortalTokens = pgTable("customer_portal_tokens", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId:  uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  token:       varchar("token", { length: 80 }).notNull().unique(), // url-safe random string
  // Snapshot of which invoice IDs this request covers (jsonb array of uuids)
  invoiceIds:  jsonb("invoice_ids").notNull().default([]),
  status:      varchar("status", { length: 16 }).notNull().default("Active"), // Active | Completed | Expired
  createdBy:   uuid("created_by").references(() => users.id, { onDelete: "set null" }), // staff who issued it (null = automation)
  expiresAt:   timestamp("expires_at").notNull(),
  lastViewedAt:timestamp("last_viewed_at"),
  completedAt: timestamp("completed_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
export type CustomerPortalToken = typeof customerPortalTokens.$inferSelect;

// Owner escalation portal — a tokenised, no-login page sent to the internal
// owner of escalated invoices. Unlike the customer portal, the link stays
// alive until expiry (owners comment repeatedly as they work their list).
export const ownerPortalTokens = pgTable("owner_portal_tokens", {
  id:           uuid("id").defaultRandom().primaryKey(),
  orgId:        uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  ownerUserId:  uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  ownerName:    varchar("owner_name",  { length: 255 }).notNull(),
  ownerEmail:   varchar("owner_email", { length: 255 }).notNull(),
  token:        varchar("token", { length: 80 }).notNull().unique(),
  invoiceIds:   jsonb("invoice_ids").notNull().default([]),
  status:       varchar("status", { length: 16 }).notNull().default("Active"), // Active | Expired
  createdBy:    uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt:    timestamp("expires_at").notNull(),
  lastViewedAt: timestamp("last_viewed_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});
export type OwnerPortalToken = typeof ownerPortalTokens.$inferSelect;

// A promise-to-pay event. `amount` supports partial promises.
export const invoicePromises = pgTable("invoice_promises", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invoiceId:   uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  customerId:  uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  promiseDate: varchar("promise_date", { length: 16 }).notNull(),       // YYYY-MM-DD
  amount:      real("amount"),                                          // null = full balance
  source:      varchar("source", { length: 24 }).notNull(),            // Customer Portal | Rep | Accountant
  enteredBy:   uuid("entered_by").references(() => users.id, { onDelete: "set null" }), // null when from portal
  note:        text("note"),
  status:      varchar("status", { length: 16 }).notNull().default("Active"), // Active | Met | Broken | Superseded
  tokenId:     uuid("token_id").references(() => customerPortalTokens.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
export type InvoicePromise = typeof invoicePromises.$inferSelect;

// A dispute event.
export const invoiceDisputes = pgTable("invoice_disputes", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invoiceId:   uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  customerId:  uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  category:    varchar("category", { length: 32 }).notNull(), // Wrong Amount | Already Paid | Goods/Service | Duplicate | Other
  reason:      text("reason"),
  source:      varchar("source", { length: 24 }).notNull(),  // Customer Portal | Rep | Accountant
  raisedBy:    uuid("raised_by").references(() => users.id, { onDelete: "set null" }), // null when from portal
  assignedTo:  uuid("assigned_to").references(() => users.id, { onDelete: "set null" }), // owner accountable for actioning
  status:      varchar("status", { length: 16 }).notNull().default("Open"), // Open | Under Review | Resolved | Rejected
  outcome:     varchar("outcome", { length: 32 }), // Invoice corrected | Credit issued | Customer agreed to pay | Written off | Rejected
  resolution:  text("resolution"),
  resolvedBy:  uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolvedAt:  timestamp("resolved_at"),
  tokenId:     uuid("token_id").references(() => customerPortalTokens.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
export type InvoiceDispute = typeof invoiceDisputes.$inferSelect;

// =========================================================================
// PAYMENTS (QBO Receive Payment)
// One row per QBO Payment. The payment may apply to one or more invoices
// or credit memos via payment_applications. Used to:
//   - reconcile AR at any historical point in time
//   - compute true DSO (days from invoice to payment receipt)
//   - drive the Cash Collections report
// =========================================================================
export const payments = pgTable("payments", {
  id:                uuid("id").defaultRandom().primaryKey(),
  orgId:             uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  qboId:             varchar("qbo_id", { length: 64 }),
  customerId:        uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  qboCustomerId:     varchar("qbo_customer_id", { length: 64 }),

  // Payment header
  txnDate:           varchar("txn_date", { length: 16 }).notNull(), // YYYY-MM-DD — QBO Payment.TxnDate
  totalAmount:       real("total_amount").notNull(),
  unappliedAmount:   real("unapplied_amount").notNull().default(0),
  currency:          varchar("currency", { length: 8 }).notNull().default("EUR"),
  exchangeRate:      real("exchange_rate"), // for non-base currency; null = 1.0

  // QBO descriptive fields
  paymentMethod:     varchar("payment_method", { length: 64 }),  // e.g. "Cash", "Cheque", "EFT"
  paymentRef:        varchar("payment_ref", { length: 128 }),    // QBO PaymentRefNum (cheque number etc)
  depositAccountId:  varchar("deposit_account_id", { length: 64 }), // QBO bank account it landed in
  depositAccountName:varchar("deposit_account_name", { length: 255 }),
  privateNote:       text("private_note"),

  // Sync metadata
  qboSyncedAt:       timestamp("qbo_synced_at"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // qboId is unique per org — prevents duplicate QBO payments on re-sync.
  // NOTE: orgCustomerIdx (unique on orgId+customerId+txnDate) was removed
  // because it caused silent data loss when the same customer makes two
  // separate payments on the same day (a legitimate, common scenario).
  orgQboIdUnique: uniqueIndex("payments_org_qbo_id_unique")
    .on(t.orgId, t.qboId)
    .where(sql`${t.qboId} IS NOT NULL`),
}));
export type Payment = typeof payments.$inferSelect;

// =========================================================================
// PAYMENT_APPLICATIONS — how each payment was applied
// One row per (payment, target) where target is an invoice or credit memo.
// targetType discriminates which table the targetQboId points to.
// =========================================================================
export const paymentApplications = pgTable("payment_applications", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  paymentId:     uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  // Linked transaction — Invoice, CreditMemo, or JournalEntry. CMs live in
  // the invoices table with txn_type='CreditMemo'; JEs live in journal_entry_ar_lines.
  invoiceId:     uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  targetQboId:   varchar("target_qbo_id", { length: 64 }).notNull(), // raw QBO id of the linked txn
  targetType:    varchar("target_type", { length: 32 }).notNull(),   // "Invoice" | "CreditMemo" | "JournalEntry"
  // Sub-line identifier on the target transaction. Critical for Journal
  // Entries: a single JE can have multiple AR lines (potentially to different
  // customers). The application targets a specific line, identified by
  // Payment.Line.LinkedTxn.TxnLineId. May be null if the QBO payload omits it
  // (in which case the aging engine falls back to customer+account matching).
  targetLineId:  varchar("target_line_id", { length: 64 }),
  amountApplied: real("amount_applied").notNull(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // Include targetLineId so multi-line JEs can have one application per line.
  paymentTargetUnique: uniqueIndex("payment_applications_payment_target_line_unique")
    .on(t.paymentId, t.targetQboId, t.targetType, t.targetLineId),
}));
export type PaymentApplication = typeof paymentApplications.$inferSelect;

// =========================================================================
// REFUND RECEIPTS (QBO RefundReceipt — money paid out to a customer)
// Reduces a customer's AR or unapplied credits. Less common than Payments
// but needed for accurate historical AR.
// =========================================================================
export const refundReceipts = pgTable("refund_receipts", {
  id:                uuid("id").defaultRandom().primaryKey(),
  orgId:             uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  qboId:             varchar("qbo_id", { length: 64 }),
  customerId:        uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  qboCustomerId:     varchar("qbo_customer_id", { length: 64 }),

  txnDate:           varchar("txn_date", { length: 16 }).notNull(),
  totalAmount:       real("total_amount").notNull(),
  currency:          varchar("currency", { length: 8 }).notNull().default("EUR"),

  paymentMethod:     varchar("payment_method", { length: 64 }),
  refundFromAccountId:  varchar("refund_from_account_id", { length: 64 }),
  refundFromAccountName:varchar("refund_from_account_name", { length: 255 }),
  privateNote:       text("private_note"),

  qboSyncedAt:       timestamp("qbo_synced_at"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  orgQboIdUnique: uniqueIndex("refund_receipts_org_qbo_id_unique")
    .on(t.orgId, t.qboId)
    .where(sql`${t.qboId} IS NOT NULL`),
}));
export type RefundReceipt = typeof refundReceipts.$inferSelect;

// =========================================================================
// DEPOSITS — AR-affecting deposit lines.
// In QBO a Deposit transaction can include lines that post to the AR account
// for a specific customer (typical for recording funds received outside of a
// regular Payment, or recording an overpayment as a customer credit). One row
// per AR-affecting line. The `amount` is signed: negative reduces customer
// AR (customer credit on account), positive increases it.
// =========================================================================
export const deposits = pgTable("deposits", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  qboId:           varchar("qbo_id", { length: 64 }).notNull(),       // QBO Deposit.Id
  qboLineId:       varchar("qbo_line_id", { length: 64 }),            // QBO Line.Id within the Deposit

  customerId:      uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  qboCustomerId:   varchar("qbo_customer_id", { length: 64 }),

  accountId:       varchar("account_id", { length: 64 }),             // QBO AR Account.Id
  accountName:     varchar("account_name", { length: 255 }),

  txnDate:         varchar("txn_date", { length: 16 }).notNull(),     // YYYY-MM-DD
  amount:          real("amount").notNull(),                          // SIGNED — negative = AR credit
  currency:        varchar("currency", { length: 8 }).notNull().default("EUR"),

  // 'Deposit' (QBO Deposit entity) | 'Purchase' (QBO Purchase / Cheque Expense with AR line)
  txnSource:       varchar("txn_source", { length: 32 }).notNull().default("Deposit"),

  description:     text("description"),
  privateNote:     text("private_note"),

  qboSyncedAt:     timestamp("qbo_synced_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  orgQboLineUnique: uniqueIndex("deposits_org_qbo_line_unique")
    .on(t.orgId, t.qboId, t.qboLineId)
    .where(sql`${t.qboLineId} IS NOT NULL`),
}));
export type Deposit = typeof deposits.$inferSelect;

// =========================================================================
// JOURNAL ENTRY AR LINES
// One row per Journal Entry LINE that posts to the Accounts Receivable account.
// JEs are the QBO mechanism for AR write-offs, audit adjustments, inter-company
// transfers, etc. Without capturing these, customer AR balances can be wildly
// overstated (e.g. a customer with €1.5M of invoices and a -€1.5M JE
// adjustment should show ~€0 AR, not €1.5M).
//
// We store only the AR-affecting lines — full JE structure isn't needed for
// AR Aging. `amount` is signed:
//   positive = debit to AR (increases what the customer owes)
//   negative = credit to AR (decreases / writes off)
// =========================================================================
export const journalEntryArLines = pgTable("journal_entry_ar_lines", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  qboJournalId:    varchar("qbo_journal_id", { length: 64 }).notNull(),  // QBO JournalEntry.Id
  qboLineId:       varchar("qbo_line_id", { length: 64 }),               // QBO Line.Id (unique per line)
  docNumber:       varchar("doc_number", { length: 64 }),                // user-facing JE number

  customerId:      uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  qboCustomerId:   varchar("qbo_customer_id", { length: 64 }),

  accountId:       varchar("account_id", { length: 64 }),      // QBO Account.Id (AR account)
  accountName:     varchar("account_name", { length: 255 }),

  txnDate:         varchar("txn_date", { length: 16 }).notNull(), // YYYY-MM-DD
  amount:          real("amount").notNull(),                     // SIGNED: + = debit AR, - = credit AR
  currency:        varchar("currency", { length: 8 }).notNull().default("EUR"),
  exchangeRate:    real("exchange_rate"),

  description:     text("description"),
  voided:          boolean("voided").notNull().default(false),

  qboSyncedAt:     timestamp("qbo_synced_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // Uniqueness is (orgId, qboJournalId, qboLineId) — the JE line is the
  // idempotency key for re-sync. orgCustomerDateIdx (unique on orgId+customerId
  // +txnDate) was removed because a single JE date can have multiple AR lines
  // for the same customer (e.g. reversal pairs), and the constraint caused
  // silent data loss on conflict.
  orgJournalLineUnique: uniqueIndex("je_ar_lines_org_journal_line_unique")
    .on(t.orgId, t.qboJournalId, t.qboLineId),
}));
export type JournalEntryArLine = typeof journalEntryArLines.$inferSelect;

// =========================================================================
// COMMUNICATIONS (emails + notes)
// =========================================================================
export const communications = pgTable("communications", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  direction: varchar("direction", { length: 16 }).notNull(),
  channel: varchar("channel", { length: 16 }).notNull(),
  subject: varchar("subject", { length: 512 }),
  sender: varchar("sender", { length: 255 }),
  recipients: text("recipients"),
  body: text("body"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  matchedBy: varchar("matched_by", { length: 64 }),
  isDraft: boolean("is_draft").notNull().default(false),
  authorId: uuid("author_id").references(() => users.id),
  refNumber: varchar("ref_number", { length: 32 }),
  stageAtSend: varchar("stage_at_send", { length: 64 }),
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
});

// =========================================================================
// TASKS
// =========================================================================
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 512 }).notNull(),
  description: text("description"),
  assigneeId: uuid("assignee_id").references(() => users.id),
  dueDate: varchar("due_date", { length: 16 }),
  priority: varchar("priority", { length: 16 }).notNull().default("Medium"),
  completed: boolean("completed").notNull().default(false),
  labels: jsonb("labels").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// EMAIL TEMPLATES
// One template per collection stage per org.
// subject / body support placeholders: {name} {invoiceLines} {ref}
// =========================================================================
export const emailTemplates = pgTable("email_templates", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name:            varchar("name", { length: 255 }).notNull(),
  subject:         varchar("subject", { length: 512 }).notNull(),
  body:            text("body").notNull(),
  collectionStage: varchar("collection_stage", { length: 64 }),  // null = unassigned draft
  isActive:        boolean("is_active").notNull().default(true),
  isDefault:       boolean("is_default").notNull().default(false),
  // How often (in days) the cron should send this template to each contact.
  // e.g. 7 = weekly, 14 = fortnightly, 30 = monthly.
  // The cron checks the communications table to see when this contact was last auto-emailed.
  sendIntervalDays: integer("send_interval_days").notNull().default(7),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// ESTIMATES (QBO Estimates / quotes)
// =========================================================================
export const estimates = pgTable("estimates", {
  id:             uuid("id").defaultRandom().primaryKey(),
  orgId:          uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId:     uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  projectId:      uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  estimateNumber: varchar("estimate_number", { length: 64 }).notNull(),
  estimateDate:   varchar("estimate_date", { length: 16 }).notNull(),
  expiryDate:     varchar("expiry_date", { length: 16 }),
  currency:       varchar("currency", { length: 8 }).notNull().default("GBP"),
  amount:         real("amount").notNull().default(0),    // subtotal ex tax
  taxAmount:      real("tax_amount").notNull().default(0),
  total:          real("total").notNull().default(0),
  // QBO TxnStatus: Pending | Accepted | Closed | Rejected
  status:         varchar("status", { length: 32 }).notNull().default("Pending"),
  billingEmail:   text("billing_email"),
  notes:          text("notes"),
  lineItems:      jsonb("line_items").default([]),
  qboId:          varchar("qbo_id", { length: 64 }),
  qboCustomerId:  varchar("qbo_customer_id", { length: 64 }),
  qboSyncedAt:    timestamp("qbo_synced_at"),
  source:         varchar("source", { length: 16 }).notNull().default("qbo"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// BATCH FUNCTIONS — QBO bulk upload / download / delete / modify job log
// =========================================================================
export const batchJobs = pgTable("batch_jobs", {
  id:         uuid("id").defaultRandom().primaryKey(),
  orgId:      uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId:     uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  // upload | download | delete | modify
  operation:  varchar("operation", { length: 16 }).notNull(),
  entityId:   varchar("entity_id", { length: 48 }).notNull(),   // registry id, e.g. "invoice"
  entityLabel: varchar("entity_label", { length: 64 }).notNull(),
  fileName:   text("file_name"),
  status:     varchar("status", { length: 16 }).notNull().default("running"), // queued | running | done | failed
  totalRows:  integer("total_rows").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  // Per-row results: [{ row, ok, qboId?, error? }] — also stores created IDs for undo.
  results:    jsonb("results").default([]),
  // Staged input for the background worker: { operation, mapping, overrides, rawRows }.
  // Cleared once the job finishes so finished rows don't bloat the table.
  input:      jsonb("input"),
  // Whether this job's created records have been reversed (undo).
  undoneAt:   timestamp("undone_at"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

// Saved column mappings for recurring imports (per org + entity).
export const batchImportMappings = pgTable("batch_import_mappings", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  entityId:  varchar("entity_id", { length: 48 }).notNull(),
  name:      varchar("name", { length: 120 }).notNull(),
  // { canonicalColumn: fileHeader }
  mapping:   jsonb("mapping").notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// REMINDER SCHEDULES
// =========================================================================
export const reminderSchedules = pgTable("reminder_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  scheduledFor: varchar("scheduled_for", { length: 16 }).notNull(),
  templateId: uuid("template_id").references(() => emailTemplates.id),
  status: varchar("status", { length: 32 }).notNull().default("Pending"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// AUDIT EVENTS — append-only track & trace log
// =========================================================================
export const auditEvents = pgTable("audit_events", {
  id:         uuid("id").defaultRandom().primaryKey(),
  orgId:      uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  projectId:  uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceId:  uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  eventType:  varchar("event_type", { length: 32 }).notNull(),
  actorId:    uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorName:  varchar("actor_name", { length: 255 }),
  meta:       jsonb("meta").notNull().default({}),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});
export type AuditEvent = typeof auditEvents.$inferSelect;

// =========================================================================
// QBO SYNC LOG
// =========================================================================
export const qboSyncLog = pgTable("qbo_sync_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Org-scoped so every user in the org sees the same sync history. userId
  // remains for audit (which user triggered the sync) but is not the
  // visibility key.
  orgId:  uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  status: varchar("status", { length: 16 }).notNull().default("success"),
  qboTotalAR: real("qbo_total_ar"),
  ledgerTotalAR: real("ledger_total_ar"),
  difference: real("difference"),
  customersCreated: integer("customers_created").default(0),
  invoicesCreated: integer("invoices_created").default(0),
  invoicesUpdated: integer("invoices_updated").default(0),
  invoicesClosed: integer("invoices_closed").default(0),
  creditsCreated: integer("credits_created").default(0),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
});
export type QboSyncLog = typeof qboSyncLog.$inferSelect;

// =========================================================================
// QBO WEBHOOK EVENTS — every webhook delivery is logged here
// Used to detect missed events and visualise webhook health per org
// =========================================================================
export const qboWebhookEvents = pgTable("qbo_webhook_events", {
  id:               uuid("id").defaultRandom().primaryKey(),
  receivedAt:       timestamp("received_at").notNull().defaultNow(),
  realmId:          varchar("realm_id", { length: 64 }).notNull(),
  orgId:            uuid("org_id").references(() => organisations.id, { onDelete: "set null" }),
  // 'received' = signature valid, processed
  // 'invalid_signature' = HMAC mismatch, rejected
  // 'unknown_realm' = no org with that realmId
  // 'error' = sync threw an exception
  status:           varchar("status", { length: 32 }).notNull().default("received"),
  entityCount:      integer("entity_count").notNull().default(0),
  entities:         jsonb("entities"), // [{ name, id, operation }]
  errorMessage:     text("error_message"),
  processingMs:     integer("processing_ms"),
});
export type QboWebhookEvent = typeof qboWebhookEvents.$inferSelect;

// =========================================================================
// ORG SMTP SETTINGS
// =========================================================================
export const orgSmtpSettings = pgTable("org_smtp_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().unique().references(() => organisations.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(2525),
  user: varchar("user", { length: 255 }).notNull(),
  pass: text("pass").notNull(),
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  // ccEmail / ccEnabled kept for migration compat; new code reads from orgEmailSettings
  ccEmail: varchar("cc_email", { length: 255 }),
  ccEnabled: boolean("cc_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// ORG EMAIL DEFAULTS (transport-agnostic — applies to Gmail, MS, and SMTP)
// =========================================================================
export const orgEmailSettings = pgTable("org_email_settings", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().unique().references(() => organisations.id, { onDelete: "cascade" }),
  ccEmail:   varchar("cc_email", { length: 500 }),
  ccEnabled: boolean("cc_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// QBO TOKENS
// =========================================================================
export const qboTokens = pgTable("qbo_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  realmId: varchar("realm_id", { length: 64 }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  companyName: varchar("company_name", { length: 255 }),
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type QboToken = typeof qboTokens.$inferSelect;

// =========================================================================
// XERO SYNC LOG
// =========================================================================
export const xeroSyncLog = pgTable("xero_sync_log", {
  id:               uuid("id").defaultRandom().primaryKey(),
  orgId:            uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId:           uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncedAt:         timestamp("synced_at").notNull().defaultNow(),
  status:           varchar("status", { length: 16 }).notNull().default("success"),
  customersCreated: integer("customers_created").default(0),
  invoicesCreated:  integer("invoices_created").default(0),
  invoicesUpdated:  integer("invoices_updated").default(0),
  invoicesClosed:   integer("invoices_closed").default(0),
  creditsCreated:   integer("credits_created").default(0),
  errorMessage:     text("error_message"),
  durationMs:       integer("duration_ms"),
});
export type XeroSyncLog = typeof xeroSyncLog.$inferSelect;

// =========================================================================
// XERO WEBHOOK EVENTS
// =========================================================================
export const xeroWebhookEvents = pgTable("xero_webhook_events", {
  id:           uuid("id").defaultRandom().primaryKey(),
  receivedAt:   timestamp("received_at").notNull().defaultNow(),
  tenantId:     varchar("tenant_id", { length: 64 }).notNull(),
  orgId:        uuid("org_id").references(() => organisations.id, { onDelete: "set null" }),
  status:       varchar("status", { length: 32 }).notNull().default("received"),
  entityCount:  integer("entity_count").notNull().default(0),
  entities:     jsonb("entities"),
  errorMessage: text("error_message"),
  processingMs: integer("processing_ms"),
});
export type XeroWebhookEvent = typeof xeroWebhookEvents.$inferSelect;

// =========================================================================
// XERO TOKENS
// =========================================================================
export const xeroTokens = pgTable("xero_tokens", {
  id:                    uuid("id").defaultRandom().primaryKey(),
  userId:                uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId:                 uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  tenantId:              varchar("tenant_id", { length: 64 }).notNull(), // Xero organisation tenant ID
  tenantName:            varchar("tenant_name", { length: 255 }),
  accessToken:           text("access_token").notNull(),
  refreshToken:          text("refresh_token").notNull(),
  accessTokenExpiresAt:  timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(), // 60-day rolling window
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
});
export type XeroToken = typeof xeroTokens.$inferSelect;

// =========================================================================
// GMAIL TOKENS
// =========================================================================
export const gmailTokens = pgTable("gmail_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Org-scoped: one Gmail connection per org. Every user in the org can
  // see whether Gmail is connected (and use it for outbound mail).
  // userId records the human who authorised it (needed for OAuth refresh).
  orgId:  uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type GmailToken = typeof gmailTokens.$inferSelect;

// Google Sheets connection (separate scope from Gmail: spreadsheets.readonly),
// used by Data Studio scheduled imports.
export const googleSheetsTokens = pgTable("google_sheets_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId:  uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Data Studio scheduled imports — re-import a Google Sheet on a cadence.
export const scheduledImports = pgTable("scheduled_imports", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  entityId:      varchar("entity_id", { length: 48 }).notNull(),
  name:          varchar("name", { length: 120 }).notNull(),
  spreadsheetId: text("spreadsheet_id").notNull(),   // the Google Sheet id
  sheetRange:    text("sheet_range").notNull().default("Sheet1"), // tab or A1 range
  mapping:       jsonb("mapping").notNull().default({}),
  cadence:       varchar("cadence", { length: 16 }).notNull().default("daily"), // hourly | daily | weekly
  active:        boolean("active").notNull().default(true),
  lastRunAt:     timestamp("last_run_at"),
  lastJobId:     uuid("last_job_id"),
  createdBy:     uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// MICROSOFT TOKENS
// =========================================================================
export const microsoftTokens = pgTable("microsoft_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Org-scoped: one Microsoft connection per org. Every user in the org can
  // see whether Microsoft is connected (and use it for outbound mail).
  // userId records the human who authorised it (needed for OAuth refresh).
  orgId:  uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type MicrosoftToken = typeof microsoftTokens.$inferSelect;

// =========================================================================
// SAGE INTACCT CREDENTIALS
// =========================================================================
export const sageIntacctCredentials = pgTable("sage_intacct_credentials", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId:      uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId:   varchar("company_id", { length: 128 }).notNull(),  // Sage company ID
  sageUserId:  varchar("sage_user_id", { length: 128 }).notNull(), // Sage web services user
  password:    text("password").notNull(),                          // encrypted user password
  entityId:    varchar("entity_id", { length: 64 }),               // optional multi-entity location ID
  companyName: varchar("company_name", { length: 255 }),           // fetched from Sage on connect
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  sage_intacct_credentials_org_unique: uniqueIndex("sage_intacct_credentials_org_unique").on(t.orgId),
}));
export type SageIntacctCredential = typeof sageIntacctCredentials.$inferSelect;

// =========================================================================
// SAGE SYNC LOG
// =========================================================================
export const sageSyncLog = pgTable("sage_sync_log", {
  id:               uuid("id").defaultRandom().primaryKey(),
  orgId:            uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId:           uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncedAt:         timestamp("synced_at").notNull().defaultNow(),
  status:           varchar("status", { length: 16 }).notNull().default("success"),
  customersCreated: integer("customers_created").default(0),
  invoicesCreated:  integer("invoices_created").default(0),
  invoicesUpdated:  integer("invoices_updated").default(0),
  invoicesClosed:   integer("invoices_closed").default(0),
  creditsCreated:   integer("credits_created").default(0),
  suppliersCreated: integer("suppliers_created").default(0),
  billsCreated:     integer("bills_created").default(0),
  billsUpdated:     integer("bills_updated").default(0),
  errorMessage:     text("error_message"),
  durationMs:       integer("duration_ms"),
});
export type SageSyncLog = typeof sageSyncLog.$inferSelect;

// =========================================================================
// RELATIONS
// =========================================================================
export const customersRelations = relations(customers, ({ many, one }) => ({
  contacts: many(contacts),
  projects: many(projects),
  invoices: many(invoices),
  communications: many(communications),
  accountOwner: one(users, { fields: [customers.accountOwnerId], references: [users.id], relationName: "accountOwner" }),
  collectionOwner: one(users, { fields: [customers.collectionOwnerId], references: [users.id], relationName: "collectionOwner" }),
  rep: one(reps, { fields: [customers.repId], references: [reps.id] }),
  region: one(regions, { fields: [customers.regionId], references: [regions.id] }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  customer: one(customers, { fields: [contacts.customerId], references: [customers.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  customer: one(customers, { fields: [projects.customerId], references: [customers.id] }),
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  invoices: many(invoices),
  rep: one(reps, { fields: [projects.repId], references: [reps.id] }),
  region: one(regions, { fields: [projects.regionId], references: [regions.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  project: one(projects, { fields: [invoices.projectId], references: [projects.id] }),
  collectionOwner: one(users, { fields: [invoices.collectionOwnerId], references: [users.id] }),
  communications: many(communications),
  tasks: many(tasks),
}));

export const communicationsRelations = relations(communications, ({ one }) => ({
  customer: one(customers, { fields: [communications.customerId], references: [customers.id] }),
  invoice: one(invoices, { fields: [communications.invoiceId], references: [invoices.id] }),
  contact: one(contacts, { fields: [communications.contactId], references: [contacts.id] }),
  author: one(users, { fields: [communications.authorId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  customer: one(customers, { fields: [tasks.customerId], references: [customers.id] }),
  invoice: one(invoices, { fields: [tasks.invoiceId], references: [invoices.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
}));

// =========================================================================
// RATE LIMITS — fixed-window limiter backed by Postgres (see lib/rate-limit.ts)
// =========================================================================
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});


// =========================================================================
// AP — SUPPLIERS
// =========================================================================
export const apSuppliers = pgTable("ap_suppliers", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name:          varchar("name", { length: 255 }).notNull(),
  displayName:   varchar("display_name", { length: 255 }),
  code:          varchar("code", { length: 64 }),
  email:         varchar("email", { length: 255 }),
  phone:         varchar("phone", { length: 64 }),
  mobile:        varchar("mobile", { length: 64 }),
  website:       varchar("website", { length: 255 }),
  firstName:     varchar("first_name", { length: 128 }),
  lastName:      varchar("last_name", { length: 128 }),
  address:       text("address"),
  addressStreet: varchar("address_street", { length: 255 }),
  addressLine2:  varchar("address_line2", { length: 255 }),
  addressCity:   varchar("address_city", { length: 128 }),
  addressState:  varchar("address_state", { length: 128 }),
  addressPostcode: varchar("address_postcode", { length: 32 }),
  country:       varchar("country", { length: 64 }),
  currency:      varchar("currency", { length: 8 }).notNull().default("EUR"),
  paymentTerms:  integer("payment_terms").notNull().default(30),
  taxNumber:     varchar("tax_number", { length: 64 }),
  status:        varchar("status", { length: 32 }).notNull().default("Active"),
  riskRating:    varchar("risk_rating", { length: 16 }).notNull().default("Low"),
  notes:         text("notes"),
  qboId:          varchar("qbo_id", { length: 64 }),
  xeroId:         varchar("xero_id", { length: 64 }),
  sageIntacctId:  varchar("sage_intacct_id", { length: 64 }),
  source:         varchar("source", { length: 16 }).notNull().default("native"), // 'native' | 'qbo' | 'xero' | 'sage'
  lastSyncedAt:   timestamp("last_synced_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idx_ap_suppliers_org_id: index("idx_ap_suppliers_org_id").on(t.orgId),
}));
export type ApSupplier = typeof apSuppliers.$inferSelect;

// =========================================================================
// AP — SUPPLIER CONTACTS
// =========================================================================
export const apSupplierContacts = pgTable("ap_supplier_contacts", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  supplierId:  uuid("supplier_id").notNull().references(() => apSuppliers.id, { onDelete: "cascade" }),
  name:        varchar("name", { length: 255 }).notNull(),
  title:       varchar("title", { length: 255 }),
  email:       varchar("email", { length: 255 }),
  phone:       varchar("phone", { length: 64 }),
  type:        varchar("type", { length: 32 }).notNull().default("Primary"),
  isPrimary:   boolean("is_primary").notNull().default(false),
  status:      varchar("status", { length: 32 }).notNull().default("Active"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});
export type ApSupplierContact = typeof apSupplierContacts.$inferSelect;

// =========================================================================
// AP — CHART OF ACCOUNTS (synced from QBO/Xero)
// =========================================================================
// Chart of Accounts — the canonical account list the GL posts to (QBO shape).
// Formerly `ap_accounts`; renamed in migration 0037. `type`/`subtype` mirror
// QBO's AccountType/AccountSubType; `classification` is the 5-way grouping
// (Asset/Liability/Equity/Revenue/Expense) that P&L vs Balance Sheet reports
// key on; `parent_id` supports sub-accounts; `code` is the account number.
export const accounts = pgTable("accounts", {
  id:             uuid("id").defaultRandom().primaryKey(),
  orgId:          uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  externalId:     varchar("external_id", { length: 64 }),        // null for native records
  source:         varchar("source", { length: 16 }).notNull().default("native"), // 'native' | 'qbo' | 'xero' | 'sage'
  code:           varchar("code", { length: 64 }),               // account number
  name:           varchar("name", { length: 255 }).notNull(),
  classification: varchar("classification", { length: 32 }),     // Asset | Liability | Equity | Revenue | Expense
  type:           varchar("type", { length: 64 }),               // QBO AccountType
  subtype:        varchar("subtype", { length: 64 }),            // QBO AccountSubType
  parentId:       uuid("parent_id"),                             // → accounts.id (sub-account)
  currency:       varchar("currency", { length: 8 }),
  status:         varchar("status", { length: 32 }).notNull().default("Active"),
  isSystem:       boolean("is_system").notNull().default(false), // QBO-style protected account — cannot be deleted
  syncToken:      varchar("sync_token", { length: 32 }),         // provider optimistic-concurrency version
  raw:            jsonb("raw"),
  lastSyncedAt:   timestamp("last_synced_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  ap_accounts_org_ext_unique: uniqueIndex("ap_accounts_org_ext_unique").on(t.orgId, t.externalId, t.source),
}));
export type Account = typeof accounts.$inferSelect;

/** @deprecated use `accounts` — kept so un-migrated references keep compiling. */
export const apAccounts = accounts;
/** @deprecated use `Account`. */
export type ApAccount = Account;

// =========================================================================
// AP — ITEMS / PRODUCTS / SERVICES (synced from QBO/Xero)
// =========================================================================
export const apItems = pgTable("ap_items", {
  id:                uuid("id").defaultRandom().primaryKey(),
  orgId:             uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  externalId:        varchar("external_id", { length: 64 }),   // null for native records
  source:            varchar("source", { length: 16 }).notNull().default("native"), // 'native' | 'qbo' | 'xero' | 'sage'
  code:              varchar("code", { length: 64 }),
  name:              varchar("name", { length: 255 }).notNull(),
  description:       text("description"),
  purchaseAccountId: varchar("purchase_account_id", { length: 64 }),
  expenseAccountId:  varchar("expense_account_id", { length: 64 }),
  unitCost:          real("unit_cost"),
  taxRateId:         varchar("tax_rate_id", { length: 64 }),
  // Sales side (QBO items carry both directions) — used by native records.
  itemType:          varchar("item_type", { length: 32 }).default("Service"), // Service | Non-Inventory | Inventory
  // Inventory kind — the single source of truth for accounting behaviour:
  // FinishedProduct | StockItem | RawMaterial | WorkInProgress | NonInventory | Service
  productType:       varchar("product_type", { length: 24 }).notNull().default("FinishedProduct"),
  baseUom:           varchar("base_uom", { length: 16 }),
  category:          varchar("category", { length: 128 }),
  minOhQty:          numeric("min_oh_qty", { precision: 14, scale: 4 }).notNull().default("0"),
  unitPrice:         real("unit_price"),
  incomeAccountId:   varchar("income_account_id", { length: 64 }),
  // Perpetual-inventory accounting. Inventory-tracked kinds capitalise purchases
  // to assetAccountId and relieve cogsAccountId on sale/consumption (FIFO by lot).
  assetAccountId:    varchar("asset_account_id", { length: 64 }),   // Inventory asset (balance sheet)
  cogsAccountId:     varchar("cogs_account_id", { length: 64 }),    // Cost of Goods Sold (P&L)
  lotTracked:        boolean("lot_tracked").notNull().default(false),
  onHandQty:         numeric("on_hand_qty", { precision: 18, scale: 4 }).notNull().default("0"),   // cached sum of open lots
  invValue:          numeric("inv_value", { precision: 18, scale: 4 }).notNull().default("0"),     // cached total FIFO value on hand
  status:            varchar("status", { length: 32 }).notNull().default("Active"),
  raw:               jsonb("raw"),
  lastSyncedAt:      timestamp("last_synced_at"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  ap_items_org_ext_unique: uniqueIndex("ap_items_org_ext_unique").on(t.orgId, t.externalId, t.source),
}));
export type ApItem = typeof apItems.$inferSelect;

// =========================================================================
// INVENTORY — SKUs (finished-product packaging) & supplier SKUs (raw material)
// =========================================================================
export const itemSkus = pgTable("item_skus", {
  id:                 uuid("id").defaultRandom().primaryKey(),
  orgId:              uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  itemId:             uuid("item_id").notNull().references(() => apItems.id, { onDelete: "cascade" }),
  skuName:            varchar("sku_name", { length: 255 }),
  skuCode:            varchar("sku_code", { length: 64 }),
  innerUnitPackSize:  numeric("inner_unit_pack_size", { precision: 14, scale: 4 }),
  innerPackType:      varchar("inner_pack_type", { length: 32 }),
  unitsInAddlInnerPack: numeric("units_in_addl_inner_pack", { precision: 14, scale: 4 }),
  addlInnerPackType:  varchar("addl_inner_pack_type", { length: 32 }),
  unitsInOuterPack:   numeric("units_in_outer_pack", { precision: 14, scale: 4 }),
  outerPackType:      varchar("outer_pack_type", { length: 32 }),
  upc:                varchar("upc", { length: 64 }),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ item_skus_item_idx: index("item_skus_item_idx").on(t.itemId) }));
export type ItemSku = typeof itemSkus.$inferSelect;

export const itemSupplierSkus = pgTable("item_supplier_skus", {
  id:                 uuid("id").defaultRandom().primaryKey(),
  orgId:              uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  itemId:             uuid("item_id").notNull().references(() => apItems.id, { onDelete: "cascade" }),
  supplierId:         uuid("supplier_id"),
  supplierUom:        varchar("supplier_uom", { length: 16 }),
  skuName:            varchar("sku_name", { length: 255 }),
  supplierSku:        varchar("supplier_sku", { length: 64 }),
  itemCodeBySupplier: varchar("item_code_by_supplier", { length: 64 }),
  innerUnitPackSize:  numeric("inner_unit_pack_size", { precision: 14, scale: 4 }),
  innerPackType:      varchar("inner_pack_type", { length: 32 }),
  unitsInOuterPack:   numeric("units_in_outer_pack", { precision: 14, scale: 4 }),
  outerPackType:      varchar("outer_pack_type", { length: 32 }),
  conversionFactor:   numeric("conversion_factor", { precision: 18, scale: 8 }), // base UoM per 1 supplier UoM
  createdAt:          timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ item_supplier_skus_item_idx: index("item_supplier_skus_item_idx").on(t.itemId) }));
export type ItemSupplierSku = typeof itemSupplierSkus.$inferSelect;

// =========================================================================
// INVENTORY — FIFO COST LOTS & MOVEMENT LEDGER
// A "lot" is a dated FIFO cost layer created when stock is received (purchase),
// produced (BOM build) or opened. Sales/consumption relieve lots (FIFO or by
// explicit pick), so every unit carries the exact cost it was received at.
// =========================================================================
export const inventoryLots = pgTable("inventory_lots", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  itemId:        uuid("item_id").notNull().references(() => apItems.id, { onDelete: "cascade" }),
  skuId:         uuid("sku_id"),                                  // stock SKU (item_skus) for SI/FP; null = base-UoM stock (RM)
  lotNo:         varchar("lot_no", { length: 64 }),               // supplier lot / batch no; auto if blank
  sourceType:    varchar("source_type", { length: 16 }).notNull().default("purchase"), // purchase | production | opening | adjustment
  sourceId:      uuid("source_id"),                               // journal entry / production run id
  supplierId:    uuid("supplier_id"),
  receivedDate:  date("received_date"),
  expiryDate:    date("expiry_date"),
  origQty:       numeric("orig_qty", { precision: 18, scale: 4 }).notNull(),        // base UoM
  remainingQty:  numeric("remaining_qty", { precision: 18, scale: 4 }).notNull(),
  unitCost:      numeric("unit_cost", { precision: 18, scale: 6 }).notNull(),        // cost per base UoM
  status:        varchar("status", { length: 16 }).notNull().default("Open"),        // Open | Depleted
  note:          text("note"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  inventory_lots_item_idx: index("inventory_lots_item_idx").on(t.orgId, t.itemId, t.status),
}));
export type InventoryLot = typeof inventoryLots.$inferSelect;

export const inventoryMovements = pgTable("inventory_movements", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  itemId:        uuid("item_id").notNull().references(() => apItems.id, { onDelete: "cascade" }),
  skuId:         uuid("sku_id"),
  lotId:         uuid("lot_id"),
  movementType:  varchar("movement_type", { length: 24 }).notNull(), // receipt | issue_sale | issue_production | produce | adjustment
  qty:           numeric("qty", { precision: 18, scale: 4 }).notNull(),   // signed: + into stock, - out
  unitCost:      numeric("unit_cost", { precision: 18, scale: 6 }),
  totalCost:     numeric("total_cost", { precision: 18, scale: 4 }),
  refType:       varchar("ref_type", { length: 32 }),   // Bill | Invoice | SalesReceipt | ProductionRun | Adjustment
  refId:         uuid("ref_id"),
  entryId:       uuid("entry_id"),                       // linked journal entry
  movementDate:  date("movement_date"),
  note:          text("note"),
  createdBy:     uuid("created_by"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  inventory_movements_item_idx: index("inventory_movements_item_idx").on(t.orgId, t.itemId),
  inventory_movements_ref_idx:  index("inventory_movements_ref_idx").on(t.refType, t.refId),
}));
export type InventoryMovement = typeof inventoryMovements.$inferSelect;

// =========================================================================
// BILL OF MATERIALS (BOM) — recipe defining what inputs produce which outputs
// =========================================================================
export const boms = pgTable("boms", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  code:            varchar("code", { length: 64 }),          // BOM ID e.g. SBOM_Dough...
  name:            varchar("name", { length: 255 }).notNull(),
  outputItemId:    uuid("output_item_id"),                    // primary produced item (FK ap_items)
  outputSkuId:     uuid("output_sku_id"),                     // which packaging SKU (item_skus) this BOM produces
  status:          varchar("status", { length: 16 }).notNull().default("Active"), // Active | Draft | Archived
  batchType:       varchar("batch_type", { length: 16 }).notNull().default("Output"), // Output | Input
  batchSize:       numeric("batch_size", { precision: 14, scale: 4 }).notNull().default("1"),
  expYield:        numeric("exp_yield", { precision: 9, scale: 4 }),   // expected yield %
  processingStep:  varchar("processing_step", { length: 64 }),
  notes:           text("notes"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  boms_org_idx: index("boms_org_idx").on(t.orgId, t.status),
}));
export type Bom = typeof boms.$inferSelect;

export const bomLines = pgTable("bom_lines", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  bomId:           uuid("bom_id").notNull().references(() => boms.id, { onDelete: "cascade" }),
  role:            varchar("role", { length: 12 }).notNull(),  // output | input | pack
  itemId:          uuid("item_id").notNull(),
  skuId:           uuid("sku_id"),                            // output stock SKU (item_skus)
  qty:             numeric("qty", { precision: 18, scale: 4 }).notNull().default("0"),
  // input: qty per batch. output: base FP content per 1 pack unit (e.g. 12 lb/case).
  // pack: packaging material qty per 1 unit of `packagingForSkuId`.
  uom:             varchar("uom", { length: 16 }),
  packagingConfig: varchar("packaging_config", { length: 128 }),  // outputs: e.g. "4 oz/bag"
  outputPackQty:   numeric("output_pack_qty", { precision: 14, scale: 4 }),   // outputs: pack count
  packagingForSkuId: uuid("packaging_for_sku_id"),            // pack lines: the output SKU this packaging is for
  supplierSkuId:   uuid("supplier_sku_id"),                    // inputs: From [SKU]
  sortOrder:       integer("sort_order").notNull().default(0),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  bom_lines_bom_idx: index("bom_lines_bom_idx").on(t.bomId, t.role),
}));
export type BomLine = typeof bomLines.$inferSelect;

// =========================================================================
// PRODUCTION RUNS (BOM builds) — consume input lots at exact cost, produce an
// output lot whose unit cost = total cost consumed / qty produced.
// =========================================================================
export const productionRuns = pgTable("production_runs", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  bomId:           uuid("bom_id"),
  runNo:           varchar("run_no", { length: 32 }),
  outputItemId:    uuid("output_item_id").notNull(),
  qtyToProduce:    numeric("qty_to_produce", { precision: 18, scale: 4 }).notNull(),
  totalInputCost:  numeric("total_input_cost", { precision: 18, scale: 4 }).notNull().default("0"),
  status:          varchar("status", { length: 16 }).notNull().default("Draft"), // Draft | Completed
  entryId:         uuid("entry_id"),         // linked journal entry (Dr FP inv / Cr components)
  producedLotId:   uuid("produced_lot_id"),  // output lot created
  producedDate:    date("produced_date"),
  notes:           text("notes"),
  createdBy:       uuid("created_by"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  production_runs_org_idx: index("production_runs_org_idx").on(t.orgId, t.status),
}));
export type ProductionRun = typeof productionRuns.$inferSelect;

export const productionConsumptions = pgTable("production_consumptions", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  runId:         uuid("run_id").notNull().references(() => productionRuns.id, { onDelete: "cascade" }),
  itemId:        uuid("item_id").notNull(),
  lotId:         uuid("lot_id").notNull(),
  qty:           numeric("qty", { precision: 18, scale: 4 }).notNull(),
  unitCost:      numeric("unit_cost", { precision: 18, scale: 6 }).notNull(),
  totalCost:     numeric("total_cost", { precision: 18, scale: 4 }).notNull(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  production_consumptions_run_idx: index("production_consumptions_run_idx").on(t.runId),
}));
export type ProductionConsumption = typeof productionConsumptions.$inferSelect;

// =========================================================================
// MANUFACTURING ORDERS — planned/scheduled production jobs (the Production
// module). An MO is planned & monitored through its lifecycle; completing it
// runs a production build (production_runs) that posts the GL & moves stock.
// =========================================================================
export const manufacturingOrders = pgTable("manufacturing_orders", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  moNo:            varchar("mo_no", { length: 32 }),
  bomId:           uuid("bom_id"),
  outputItemId:    uuid("output_item_id").notNull(),
  outputSkuId:     uuid("output_sku_id"),
  qty:             numeric("qty", { precision: 18, scale: 4 }).notNull(),   // in output SKU packs when outputSkuId set, else base UoM
  scheduledDate:   date("scheduled_date"),
  dueDate:         date("due_date"),
  priority:        varchar("priority", { length: 8 }).notNull().default("Normal"), // Low | Normal | High
  status:          varchar("status", { length: 16 }).notNull().default("Draft"),   // Draft|Scheduled|Released|InProgress|Completed|Cancelled
  notes:           text("notes"),
  productionRunId: uuid("production_run_id"),   // the build that fulfilled it
  createdBy:       uuid("created_by"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  manufacturing_orders_org_idx: index("manufacturing_orders_org_idx").on(t.orgId, t.status),
}));
export type ManufacturingOrder = typeof manufacturingOrders.$inferSelect;

// Per-SKU output quantities of an MO (a build can produce several packs).
export const moOutputs = pgTable("mo_outputs", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  moId:      uuid("mo_id").notNull().references(() => manufacturingOrders.id, { onDelete: "cascade" }),
  itemId:    uuid("item_id").notNull(),
  skuId:     uuid("sku_id"),
  qty:       numeric("qty", { precision: 18, scale: 4 }).notNull().default("0"),  // in SKU packs
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ mo_outputs_mo_idx: index("mo_outputs_mo_idx").on(t.moId) }));
export type MoOutput = typeof moOutputs.$inferSelect;

// Per-SKU produced outputs of a build (co-products with allocated cost).
export const productionOutputs = pgTable("production_outputs", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  runId:     uuid("run_id").notNull().references(() => productionRuns.id, { onDelete: "cascade" }),
  itemId:    uuid("item_id").notNull(),
  skuId:     uuid("sku_id"),
  qtyPacks:  numeric("qty_packs", { precision: 18, scale: 4 }).notNull().default("0"),
  qtyBase:   numeric("qty_base", { precision: 18, scale: 4 }).notNull().default("0"),
  unitCost:  numeric("unit_cost", { precision: 18, scale: 6 }).notNull().default("0"),
  amount:    numeric("amount", { precision: 18, scale: 4 }).notNull().default("0"),
  lotId:     uuid("lot_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ production_outputs_run_idx: index("production_outputs_run_idx").on(t.runId) }));
export type ProductionOutput = typeof productionOutputs.$inferSelect;

// =========================================================================
// AP — TAX RATES (synced from QBO/Xero)
// =========================================================================
export const apTaxRates = pgTable("ap_tax_rates", {
  id:           uuid("id").defaultRandom().primaryKey(),
  orgId:        uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  externalId:   varchar("external_id", { length: 64 }),        // null for native records
  source:       varchar("source", { length: 16 }).notNull().default("native"), // 'native' | 'qbo' | 'xero' | 'sage'
  name:         varchar("name", { length: 255 }).notNull(),
  rate:         real("rate"),
  taxType:      varchar("tax_type", { length: 64 }),
  status:       varchar("status", { length: 32 }).notNull().default("Active"),
  raw:          jsonb("raw"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  ap_tax_rates_org_ext_unique: uniqueIndex("ap_tax_rates_org_ext_unique").on(t.orgId, t.externalId, t.source),
}));
export type ApTaxRate = typeof apTaxRates.$inferSelect;

// =========================================================================
// AP — DIMENSIONS (projects, customers, classes, depts, tracking categories…)
// =========================================================================
export const apDimensions = pgTable("ap_dimensions", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  externalId:    varchar("external_id", { length: 64 }).notNull(),
  source:        varchar("source", { length: 16 }).notNull(),
  dimensionType: varchar("dimension_type", { length: 64 }).notNull(),
  // e.g. 'Project' | 'Customer' | 'Class' | 'Department' | 'Location' | 'TrackingCategory' | 'CostCentre'
  name:          varchar("name", { length: 255 }).notNull(),
  code:          varchar("code", { length: 64 }),
  parentId:      varchar("parent_id", { length: 64 }),
  status:        varchar("status", { length: 32 }).notNull().default("Active"),
  raw:           jsonb("raw"),
  lastSyncedAt:  timestamp("last_synced_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  ap_dimensions_org_ext_type_unique: uniqueIndex("ap_dimensions_org_ext_type_unique").on(t.orgId, t.externalId, t.source, t.dimensionType),
}));
export type ApDimension = typeof apDimensions.$inferSelect;

// =========================================================================
// GENERAL LEDGER — the posting engine (native accounting core).
// Every entry MUST balance (Σ debits = Σ credits) — enforced in lib/ledger.
// Entries are never deleted; corrections are posted as reversals.
// =========================================================================
export const journalEntries = pgTable("journal_entries", {
  id:                uuid("id").defaultRandom().primaryKey(),
  orgId:             uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  entryNumber:       integer("entry_number").notNull(),                    // internal gap-free counter per org (audit)
  txnNo:             integer("txn_no"),                                    // backend Transaction ID (system, immutable): TXN-000123
  docNumber:         varchar("doc_number", { length: 64 }),                // user-facing, editable number (e.g. JE-0001)
  dueDate:           varchar("due_date", { length: 16 }),                  // when payable (Invoice/Bill) — basis for aging
  reference:         varchar("reference", { length: 64 }),                 // supplier bill no. / customer PO / free ref
  externalId:        varchar("external_id", { length: 64 }),               // QBO/Xero transaction id when synced/mirrored
  externalSource:    varchar("external_source", { length: 16 }),           // qbo | xero
  externalSyncToken: varchar("external_sync_token", { length: 64 }),       // QBO SyncToken / Xero UpdatedDateUTC guard
  entryDate:         varchar("entry_date", { length: 16 }).notNull(),      // YYYY-MM-DD
  memo:              text("memo"),
  sourceType:        varchar("source_type", { length: 32 }).notNull().default("Manual"), // Manual | Invoice | Payment | Bill | CreditNote | Reversal
  sourceId:          uuid("source_id"),                                    // document id when sourceType != Manual
  status:            varchar("status", { length: 16 }).notNull().default("Posted"), // Posted | Reversed
  reversedByEntryId: uuid("reversed_by_entry_id"),                         // set on the original when a reversal is posted
  reversesEntryId:   uuid("reverses_entry_id"),                            // set on the reversal, points at the original
  sourcePayload:     jsonb("source_payload"),                              // the document form input, for reopen-to-edit
  createdBy:         uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  journal_entries_org_number_unique: uniqueIndex("journal_entries_org_number_unique").on(t.orgId, t.entryNumber),
  journal_entries_org_txn_no_unique: uniqueIndex("journal_entries_org_txn_no_unique").on(t.orgId, t.txnNo),
}));
export type JournalEntry = typeof journalEntries.$inferSelect;

// =========================================================================
// DOCUMENT SEQUENCES — our own per-type transaction number series (QBO model).
// One row per (org, docType). See db/migrations/0042 + lib/accounting/numbering.
// =========================================================================
export const documentSequences = pgTable("document_sequences", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  docType:   varchar("doc_type", { length: 24 }).notNull(),   // Journal | Invoice | Bill | Payment | CreditNote | ...
  prefix:    varchar("prefix", { length: 16 }).notNull().default(""),
  nextNo:    integer("next_no").notNull().default(1),         // the number to assign NEXT
  padding:   integer("padding").notNull().default(4),          // zero-pad width of the numeric part
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  document_sequences_org_type_unique: uniqueIndex("document_sequences_org_type_unique").on(t.orgId, t.docType),
}));
export type DocumentSequence = typeof documentSequences.$inferSelect;

// =========================================================================
// PERIOD CLOSES — year-end close audit trail. Each row records a fiscal
// period whose net profit was moved to Retained Earnings by a closing entry.
// =========================================================================
export const periodCloses = pgTable("period_closes", {
  id:                        uuid("id").defaultRandom().primaryKey(),
  orgId:                     uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  periodStart:               varchar("period_start", { length: 16 }).notNull(),
  periodEnd:                 varchar("period_end", { length: 16 }).notNull(),
  netProfit:                 numeric("net_profit", { precision: 14, scale: 2 }).notNull().default("0"),
  retainedEarningsAccountId: uuid("retained_earnings_account_id"),
  closingEntryId:            uuid("closing_entry_id"),
  status:                    varchar("status", { length: 16 }).notNull().default("Closed"), // Closed | Reopened
  closedBy:                  uuid("closed_by"),
  closedAt:                  timestamp("closed_at").notNull().defaultNow(),
  reopenedAt:                timestamp("reopened_at"),
}, (t) => ({
  period_closes_org_idx: index("period_closes_org_idx").on(t.orgId),
}));
export type PeriodClose = typeof periodCloses.$inferSelect;

// =========================================================================
// TRADE DOCUMENTS — Estimates (quotes) & Purchase Orders. NON-posting until
// converted to an Invoice / Bill (see lib/accounting/trade-documents).
// =========================================================================
export const tradeDocuments = pgTable("trade_documents", {
  id:               uuid("id").defaultRandom().primaryKey(),
  orgId:            uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  kind:             varchar("kind", { length: 16 }).notNull(),          // Estimate | PurchaseOrder
  docNumber:        varchar("doc_number", { length: 64 }),
  partyType:        varchar("party_type", { length: 16 }),             // Customer | Vendor
  partyId:          uuid("party_id"),
  partyLabel:       varchar("party_label", { length: 255 }),
  issueDate:        varchar("issue_date", { length: 16 }).notNull(),
  expiryDate:       varchar("expiry_date", { length: 16 }),
  currency:         varchar("currency", { length: 8 }),
  exchangeRate:     numeric("exchange_rate", { precision: 18, scale: 6 }),
  status:           varchar("status", { length: 16 }).notNull().default("Open"), // Open | Accepted | Converted | Closed
  memo:             text("memo"),
  subtotal:         numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  taxTotal:         numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
  total:            numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  convertedEntryId: uuid("converted_entry_id"),
  createdBy:        uuid("created_by"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  trade_documents_org_kind_idx: index("trade_documents_org_kind_idx").on(t.orgId, t.kind),
}));
export type TradeDocument = typeof tradeDocuments.$inferSelect;

export const tradeDocumentLines = pgTable("trade_document_lines", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  documentId:  uuid("document_id").notNull().references(() => tradeDocuments.id, { onDelete: "cascade" }),
  lineNo:      integer("line_no").notNull(),
  accountId:   uuid("account_id"),
  itemId:      uuid("item_id"),
  description: text("description"),
  qty:         numeric("qty", { precision: 14, scale: 4 }),
  rate:        numeric("rate", { precision: 14, scale: 4 }),
  amount:         numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRateId:      uuid("tax_rate_id"),
  taxAmount:      numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  invoicedAmount: numeric("invoiced_amount", { precision: 14, scale: 2 }).notNull().default("0"), // net already invoiced/billed
  // Ordering unit: qty/rate are entered at this pack level; unitsPerOrderUnit
  // converts one order unit into the item's base UoM for stock/receiving.
  orderUom:          varchar("order_uom", { length: 16 }),            // label of the order unit (case/bottle/kg…)
  packLevel:         varchar("pack_level", { length: 8 }),            // base | inner | outer
  unitsPerOrderUnit: numeric("units_per_order_unit", { precision: 18, scale: 6 }).notNull().default("1"),
  supplierSkuId:     uuid("supplier_sku_id"),
  skuId:             uuid("sku_id"),                                  // stock SKU (item_skus) transacted, for SI/FP
  orderedBaseQty:    numeric("ordered_base_qty", { precision: 18, scale: 4 }).notNull().default("0"), // qty × unitsPerOrderUnit
  receivedQty:       numeric("received_qty", { precision: 18, scale: 4 }).notNull().default("0"),     // base UoM received to date
  billedQty:         numeric("billed_qty", { precision: 18, scale: 4 }).notNull().default("0"),       // base UoM billed to date
}, (t) => ({
  trade_document_lines_doc_idx: index("trade_document_lines_doc_idx").on(t.documentId),
}));
export type TradeDocumentLine = typeof tradeDocumentLines.$inferSelect;

// =========================================================================
// GOODS RECEIPTS — the receiving step between a PO and a Bill (three-way match)
// Posts Dr Inventory / Cr GR/IR clearing and creates FIFO cost lots. A Bill
// created from receipts then clears GR/IR to Accounts Payable.
// =========================================================================
export const goodsReceipts = pgTable("goods_receipts", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  receiptNo:     varchar("receipt_no", { length: 32 }),
  supplierId:    uuid("supplier_id"),
  supplierLabel: varchar("supplier_label", { length: 255 }),
  receiptDate:   date("receipt_date").notNull(),
  currency:      varchar("currency", { length: 8 }),
  exchangeRate:  numeric("exchange_rate", { precision: 18, scale: 6 }),
  status:        varchar("status", { length: 16 }).notNull().default("Posted"), // Posted | Reversed
  entryId:       uuid("entry_id"),                                              // GL: Dr Inventory / Cr GR/IR
  grirTotal:     numeric("grir_total", { precision: 18, scale: 4 }).notNull().default("0"),   // home accrued
  billedAmount:  numeric("billed_amount", { precision: 18, scale: 4 }).notNull().default("0"),// home billed to date
  notes:         text("notes"),
  createdBy:     uuid("created_by"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  goods_receipts_org_idx: index("goods_receipts_org_idx").on(t.orgId, t.status),
}));
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  receiptId:   uuid("receipt_id").notNull().references(() => goodsReceipts.id, { onDelete: "cascade" }),
  itemId:      uuid("item_id").notNull(),
  skuId:       uuid("sku_id"),       // stock SKU received into (SI/FP); null = base UoM (RM)
  poId:        uuid("po_id"),        // trade_documents id (nullable — receive without a PO)
  poLineId:    uuid("po_line_id"),   // trade_document_lines id
  description: text("description"),
  qtyBase:     numeric("qty_base", { precision: 18, scale: 4 }).notNull(),        // received, item base UoM
  unitCost:    numeric("unit_cost", { precision: 18, scale: 6 }).notNull(),        // home, per base UoM
  amount:      numeric("amount", { precision: 18, scale: 4 }).notNull().default("0"), // home = qtyBase × unitCost
  lotId:       uuid("lot_id"),
  lotNo:       varchar("lot_no", { length: 64 }),
  expiryDate:  date("expiry_date"),
  billedQty:   numeric("billed_qty", { precision: 18, scale: 4 }).notNull().default("0"), // base billed to date
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  goods_receipt_lines_receipt_idx: index("goods_receipt_lines_receipt_idx").on(t.receiptId),
  goods_receipt_lines_po_idx: index("goods_receipt_lines_po_idx").on(t.poId),
}));
export type GoodsReceiptLine = typeof goodsReceiptLines.$inferSelect;

// =========================================================================
// SALES SHIPMENTS — the fulfilment step between a Sales Order and an Invoice
// (order-to-cash mirror of goods receipts). Posts Dr COGS / Cr Inventory at
// FIFO cost when goods leave; the Invoice created from the shipment posts
// revenue only (Dr A/R / Cr Revenue) and does not relieve stock again.
// =========================================================================
export const salesShipments = pgTable("sales_shipments", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  shipmentNo:    varchar("shipment_no", { length: 32 }),
  customerId:    uuid("customer_id"),
  customerLabel: varchar("customer_label", { length: 255 }),
  shipmentDate:  date("shipment_date").notNull(),
  currency:      varchar("currency", { length: 8 }),
  exchangeRate:  numeric("exchange_rate", { precision: 18, scale: 6 }),
  status:        varchar("status", { length: 16 }).notNull().default("Posted"), // Posted | Reversed
  entryId:       uuid("entry_id"),                                              // GL: Dr COGS / Cr Inventory
  cogsTotal:     numeric("cogs_total", { precision: 18, scale: 4 }).notNull().default("0"),   // home cost relieved
  saleTotal:     numeric("sale_total", { precision: 18, scale: 4 }).notNull().default("0"),   // sale value shipped (for invoicing)
  invoicedAmount: numeric("invoiced_amount", { precision: 18, scale: 4 }).notNull().default("0"), // sale value invoiced to date
  notes:         text("notes"),
  createdBy:     uuid("created_by"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  sales_shipments_org_idx: index("sales_shipments_org_idx").on(t.orgId, t.status),
}));
export type SalesShipment = typeof salesShipments.$inferSelect;

export const shipmentLines = pgTable("shipment_lines", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  shipmentId:      uuid("shipment_id").notNull().references(() => salesShipments.id, { onDelete: "cascade" }),
  itemId:          uuid("item_id").notNull(),
  skuId:           uuid("sku_id"),       // stock SKU shipped (SI/FP)
  soId:            uuid("so_id"),        // trade_documents id (nullable — ship without an SO)
  soLineId:        uuid("so_line_id"),
  description:     text("description"),
  qtyBase:         numeric("qty_base", { precision: 18, scale: 4 }).notNull(),          // shipped, item base UoM
  unitCost:        numeric("unit_cost", { precision: 18, scale: 6 }).notNull().default("0"), // home FIFO cost relieved per base
  cogsAmount:      numeric("cogs_amount", { precision: 18, scale: 4 }).notNull().default("0"),
  saleRate:        numeric("sale_rate", { precision: 18, scale: 6 }),                    // sale price per base (for invoicing)
  incomeAccountId: varchar("income_account_id", { length: 64 }),
  taxRateId:       uuid("tax_rate_id"),
  invoicedQty:     numeric("invoiced_qty", { precision: 18, scale: 4 }).notNull().default("0"), // base invoiced to date
  createdAt:       timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  shipment_lines_shipment_idx: index("shipment_lines_shipment_idx").on(t.shipmentId),
  shipment_lines_so_idx: index("shipment_lines_so_idx").on(t.soId),
}));
export type ShipmentLine = typeof shipmentLines.$inferSelect;

// =========================================================================
// TRANSACTION LINKS — the relationship graph (Estimate→Invoice, Payment→
// Invoice, PO→Bill, …). Queryable in both directions. See lib/accounting/links.
// =========================================================================
export const transactionLinks = pgTable("transaction_links", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  fromType:  varchar("from_type", { length: 24 }).notNull(),
  fromId:    uuid("from_id").notNull(),
  toType:    varchar("to_type", { length: 24 }).notNull(),
  toId:      uuid("to_id").notNull(),
  relation:  varchar("relation", { length: 24 }).notNull(),   // progress_invoice | conversion | po_bill | payment | credit
  amount:    numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  contextEntryId: uuid("context_entry_id"),                   // the transaction that created this link
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  transaction_links_org_from_idx: index("transaction_links_org_from_idx").on(t.orgId, t.fromType, t.fromId),
  transaction_links_org_to_idx:   index("transaction_links_org_to_idx").on(t.orgId, t.toType, t.toId),
}));
export type TransactionLink = typeof transactionLinks.$inferSelect;

export const journalLines = pgTable("journal_lines", {
  id:           uuid("id").defaultRandom().primaryKey(),
  orgId:        uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  entryId:      uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
  lineNo:       integer("line_no").notNull(),
  accountId:    uuid("account_id").notNull().references(() => apAccounts.id),
  description:  text("description"),
  // Exactly one of debit/credit is non-zero per line (enforced in lib/ledger).
  // numeric (not real/float) — ledger money must be exact to the cent.
  debit:        numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
  credit:       numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
  // Dimensions — reference ap_dimensions ids (nullable).
  classId:      uuid("class_id"),
  locationId:   uuid("location_id"),
  costCentreId: uuid("cost_centre_id"),
  // Optional business links for subledger drill-down.
  customerId:   uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  projectId:    uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  // The line's "Name" (QBO Entity) — the party a control-account line ties to.
  // Required on A/R (Customer) and A/P (Vendor) lines; used for Payroll (Employee).
  nameType:     varchar("name_type", { length: 16 }),   // Customer | Vendor | Employee
  nameId:       uuid("name_id"),                          // party id where one exists
  nameLabel:    varchar("name_label", { length: 255 }),   // shown name (only field for free-typed employees)
  // Multi-currency: debit/credit above are HOME currency (the books). These
  // record what was entered in a foreign currency and the rate used to convert.
  currency:     varchar("currency", { length: 8 }),                 // line currency (null/home = home currency)
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }),
  fxDebit:      numeric("fx_debit", { precision: 14, scale: 2 }),   // amount entered, in `currency`
  fxCredit:     numeric("fx_credit", { precision: 14, scale: 2 }),
  // Bank reconciliation: set when this line has been cleared in a reconciliation.
  reconciliationId: uuid("reconciliation_id"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});
export type JournalLine = typeof journalLines.$inferSelect;

// =========================================================================
// BANK RECONCILIATIONS — match GL bank/credit-card lines to a statement.
// =========================================================================
export const bankReconciliations = pgTable("bank_reconciliations", {
  id:               uuid("id").defaultRandom().primaryKey(),
  orgId:            uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  accountId:        uuid("account_id").notNull(),
  statementDate:    date("statement_date").notNull(),
  beginningBalance: numeric("beginning_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  statementBalance: numeric("statement_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  clearedBalance:   numeric("cleared_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  status:           varchar("status", { length: 16 }).notNull().default("Reconciled"),
  reconciledBy:     uuid("reconciled_by"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  bank_recs_acct_idx: index("bank_recs_acct_idx").on(t.orgId, t.accountId),
}));
export type BankReconciliation = typeof bankReconciliations.$inferSelect;

// Employees — a Name list (party). Same envelope as other master lists.
export const employees = pgTable("employees", {
  id:           uuid("id").defaultRandom().primaryKey(),
  orgId:        uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  externalId:   varchar("external_id", { length: 64 }),
  source:       varchar("source", { length: 16 }).notNull().default("native"),
  name:         varchar("name", { length: 255 }).notNull(),
  email:        varchar("email", { length: 255 }),
  phone:        varchar("phone", { length: 64 }),
  currency:     varchar("currency", { length: 8 }),
  status:       varchar("status", { length: 32 }).notNull().default("Active"),
  raw:          jsonb("raw"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});
export type Employee = typeof employees.$inferSelect;

// =========================================================================
// PURCHASE REQUESTS
// =========================================================================
export const purchaseRequests = pgTable("purchase_requests", {
  id:                  uuid("id").defaultRandom().primaryKey(),
  orgId:               uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  requestNumber:       varchar("request_number", { length: 64 }).notNull(),
  requesterId:         uuid("requester_id").references(() => users.id, { onDelete: "set null" }),
  supplierId:          uuid("supplier_id").references(() => apSuppliers.id, { onDelete: "set null" }),
  title:               varchar("title", { length: 500 }).notNull(),
  description:         text("description"),
  businessJustification: text("business_justification"),
  requiredByDate:      varchar("required_by_date", { length: 16 }),
  currency:            varchar("currency", { length: 8 }).notNull().default("EUR"),
  estimatedTotal:      real("estimated_total"),
  status:              varchar("status", { length: 32 }).notNull().default("Draft"),
  // Draft | Submitted | Pending Review | Pending Approval | Approved | Rejected | Cancelled | Converted to PO
  workflowStage:       varchar("workflow_stage", { length: 64 }),
  assignedApproverId:  uuid("assigned_approver_id").references(() => users.id, { onDelete: "set null" }),
  departmentId:        varchar("department_id", { length: 64 }),
  projectId:           varchar("project_id", { length: 64 }),
  customerId:          varchar("customer_id_ref", { length: 64 }),
  costCentreId:        varchar("cost_centre_id", { length: 64 }),
  notes:               text("notes"),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idx_purchase_requests_org_id: index("idx_purchase_requests_org_id").on(t.orgId),
}));
export type PurchaseRequest = typeof purchaseRequests.$inferSelect;

// =========================================================================
// PURCHASE ORDERS
// =========================================================================
export const purchaseOrders = pgTable("purchase_orders", {
  id:                  uuid("id").defaultRandom().primaryKey(),
  orgId:               uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  poNumber:            varchar("po_number", { length: 64 }).notNull(),
  requestId:           uuid("request_id").references(() => purchaseRequests.id, { onDelete: "set null" }),
  supplierId:          uuid("supplier_id").references(() => apSuppliers.id, { onDelete: "set null" }),
  poDate:              varchar("po_date", { length: 16 }),
  expectedDeliveryDate: varchar("expected_delivery_date", { length: 16 }),
  currency:            varchar("currency", { length: 8 }).notNull().default("EUR"),
  subtotal:            real("subtotal").notNull().default(0),
  taxTotal:            real("tax_total").notNull().default(0),
  total:               real("total").notNull().default(0),
  status:              varchar("status", { length: 32 }).notNull().default("Draft"),
  // Draft | Pending Approval | Approved | Pushed to Accounting | Partially Billed | Fully Billed | Closed | Cancelled | Rejected
  approvalStatus:      varchar("approval_status", { length: 32 }).notNull().default("Pending"),
  workflowStage:       varchar("workflow_stage", { length: 64 }),
  assignedApproverId:  uuid("assigned_approver_id").references(() => users.id, { onDelete: "set null" }),
  notes:               text("notes"),
  // QBO/Xero push
  qboId:               varchar("qbo_id", { length: 64 }),
  xeroId:              varchar("xero_id", { length: 64 }),
  externalDocNumber:   varchar("external_doc_number", { length: 64 }),
  pushedAt:            timestamp("pushed_at"),
  pushStatus:          varchar("push_status", { length: 32 }),   // 'pending' | 'success' | 'failed'
  lastPushError:       text("last_push_error"),
  createdByUserId:     uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId:    uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt:          timestamp("approved_at"),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idx_purchase_orders_org_id: index("idx_purchase_orders_org_id").on(t.orgId),
}));
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// =========================================================================
// PURCHASE ORDER LINES
// =========================================================================
export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id:                  uuid("id").defaultRandom().primaryKey(),
  orgId:               uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  purchaseOrderId:     uuid("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  lineNumber:          integer("line_number").notNull().default(1),
  itemId:              varchar("item_id", { length: 64 }),
  description:         text("description"),
  quantity:            real("quantity").notNull().default(1),
  unitPrice:           real("unit_price").notNull().default(0),
  accountId:           varchar("account_id", { length: 64 }),
  taxRateId:           varchar("tax_rate_id", { length: 64 }),
  projectId:           varchar("project_id", { length: 64 }),
  customerId:          varchar("customer_id_ref", { length: 64 }),
  costCentreId:        varchar("cost_centre_id", { length: 64 }),
  trackingCategoryId:  varchar("tracking_category_id", { length: 64 }),
  classId:             varchar("class_id", { length: 64 }),
  departmentId:        varchar("department_id", { length: 64 }),
  lineSubtotal:        real("line_subtotal").notNull().default(0),
  lineTax:             real("line_tax").notNull().default(0),
  lineTotal:           real("line_total").notNull().default(0),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
});
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;

// =========================================================================
// AP BILLS (synced from QBO/Xero)
// =========================================================================
export const apBills = pgTable("ap_bills", {
  id:                     uuid("id").defaultRandom().primaryKey(),
  orgId:                  uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  supplierId:             uuid("supplier_id").references(() => apSuppliers.id, { onDelete: "set null" }),
  billNumber:             varchar("bill_number", { length: 64 }),
  reference:              varchar("reference", { length: 128 }),
  billDate:               varchar("bill_date", { length: 16 }),
  dueDate:                varchar("due_date", { length: 16 }),
  currency:               varchar("currency", { length: 8 }).notNull().default("EUR"),
  subtotal:               real("subtotal").notNull().default(0),
  taxTotal:               real("tax_total").notNull().default(0),
  total:                  real("total").notNull().default(0),
  amountPaid:             real("amount_paid").notNull().default(0),
  balance:                real("balance").notNull().default(0),
  accountingPaymentStatus: varchar("accounting_payment_status", { length: 32 }).notNull().default("Unpaid"),
  // Unpaid | Partially Paid | Paid | Voided
  workflowStatus:         varchar("workflow_status", { length: 64 }).notNull().default("Synced from Accounting"),
  // Synced from Accounting | Pending Review | Pending Approval | Approved | Rejected | On Hold | Ready for Payment | Scheduled | Paid
  approvalStatus:         varchar("approval_status", { length: 32 }),
  purchaseOrderId:        uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
  externalPurchaseOrderRef: varchar("external_purchase_order_ref", { length: 128 }),
  qboPurchaseOrderId:     varchar("qbo_purchase_order_id", { length: 64 }),
  xeroPurchaseOrderId:    varchar("xero_purchase_order_id", { length: 64 }),
  qboId:                  varchar("qbo_id", { length: 64 }),
  xeroId:                 varchar("xero_id", { length: 64 }),
  sageIntacctId:          varchar("sage_intacct_id", { length: 64 }),
  source:                 varchar("source", { length: 16 }).notNull().default("native"), // 'native' | 'qbo' | 'xero' | 'sage'
  assignedApproverId:     uuid("assigned_approver_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId:       uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt:             timestamp("approved_at"),
  approvalNotePushedAt:   timestamp("approval_note_pushed_at"),
  approverEmail:          varchar("approver_email", { length: 256 }),  // cached external approver email
  lastApprovalSentAt:     timestamp("last_approval_sent_at"),
  privateNote:            text("private_note"),
  lastSyncAt:             timestamp("last_sync_at"),
  createdAt:              timestamp("created_at").notNull().defaultNow(),
  updatedAt:              timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idx_ap_bills_org_id: index("idx_ap_bills_org_id").on(t.orgId),
  ap_bills_org_qbo_unique: uniqueIndex("ap_bills_org_qbo_unique").on(t.orgId, t.qboId).where(sql`${t.qboId} IS NOT NULL`),
  ap_bills_org_xero_unique: uniqueIndex("ap_bills_org_xero_unique").on(t.orgId, t.xeroId).where(sql`${t.xeroId} IS NOT NULL`),
  ap_bills_org_sage_unique: uniqueIndex("ap_bills_org_sage_unique").on(t.orgId, t.sageIntacctId).where(sql`${t.sageIntacctId} IS NOT NULL`),
}));
export type ApBill = typeof apBills.$inferSelect;

// =========================================================================
// AP BILL LINES
// =========================================================================
export const apBillLines = pgTable("ap_bill_lines", {
  id:                  uuid("id").defaultRandom().primaryKey(),
  orgId:               uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  billId:              uuid("bill_id").notNull().references(() => apBills.id, { onDelete: "cascade" }),
  lineNumber:          integer("line_number").notNull().default(1),
  itemId:              varchar("item_id", { length: 64 }),
  itemName:            varchar("item_name", { length: 256 }),
  description:         text("description"),
  quantity:            real("quantity").notNull().default(1),
  unitPrice:           real("unit_price").notNull().default(0),
  accountId:           varchar("account_id", { length: 64 }),
  accountName:         varchar("account_name", { length: 256 }),
  taxRateId:           varchar("tax_rate_id", { length: 64 }),
  projectId:           varchar("project_id", { length: 64 }),
  customerId:          varchar("customer_id_ref", { length: 64 }),
  costCentreId:        varchar("cost_centre_id", { length: 64 }),
  trackingCategoryId:  varchar("tracking_category_id", { length: 64 }),
  classId:             varchar("class_id", { length: 64 }),
  departmentId:        varchar("department_id", { length: 64 }),
  lineSubtotal:        real("line_subtotal").notNull().default(0),
  lineTax:             real("line_tax").notNull().default(0),
  lineTotal:           real("line_total").notNull().default(0),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
});
export type ApBillLine = typeof apBillLines.$inferSelect;

// =========================================================================
// AP APPROVALS (generic — covers PRs, POs, Bills, Payment Runs)
// =========================================================================
export const apApprovals = pgTable("ap_approvals", {
  id:                uuid("id").defaultRandom().primaryKey(),
  orgId:             uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  entityType:        varchar("entity_type", { length: 32 }).notNull(),
  // 'purchase_request' | 'purchase_order' | 'bill' | 'payment_run'
  entityId:          uuid("entity_id").notNull(),
  workflowId:        uuid("workflow_id"),
  stepNumber:        integer("step_number").notNull().default(1),
  approverUserId:    uuid("approver_user_id").references(() => users.id, { onDelete: "set null" }),
  approverRole:      varchar("approver_role", { length: 64 }),
  status:            varchar("status", { length: 32 }).notNull().default("Pending"),
  // Pending | Approved | Rejected | Delegated | Skipped | Cancelled
  decision:          varchar("decision", { length: 32 }),
  comments:          text("comments"),
  approvedAt:        timestamp("approved_at"),
  rejectedAt:        timestamp("rejected_at"),
  delegatedToUserId: uuid("delegated_to_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idx_ap_approvals_org_entity: index("idx_ap_approvals_org_entity").on(t.orgId, t.entityType, t.entityId),
}));
export type ApApproval = typeof apApprovals.$inferSelect;

// =========================================================================
// AP WORKFLOW RULES
// =========================================================================
export const apWorkflowRules = pgTable("ap_workflow_rules", {
  id:             uuid("id").defaultRandom().primaryKey(),
  orgId:          uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name:           varchar("name", { length: 255 }).notNull(),
  entityType:     varchar("entity_type", { length: 32 }).notNull(),
  // 'purchase_request' | 'purchase_order' | 'bill' | 'payment_run'
  isActive:       boolean("is_active").notNull().default(true),
  conditionsJson: jsonb("conditions_json").notNull().default({}),
  stepsJson:      jsonb("steps_json").notNull().default([]),
  priority:       integer("priority").notNull().default(0),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});
export type ApWorkflowRule = typeof apWorkflowRules.$inferSelect;

// =========================================================================
// AP SUPPLIER QUERIES (equivalent to AR disputes)
// =========================================================================
export const apSupplierQueries = pgTable("ap_supplier_queries", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  supplierId:      uuid("supplier_id").references(() => apSuppliers.id, { onDelete: "set null" }),
  billId:          uuid("bill_id").references(() => apBills.id, { onDelete: "set null" }),
  purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
  category:        varchar("category", { length: 64 }).notNull(),
  // Missing PO | Incorrect Amount | Duplicate Bill | Wrong Tax | Goods Not Received
  // Supplier Statement Mismatch | Bank Details Verification | Internal Coding Issue
  // Approval Clarification | Other
  reason:          text("reason"),
  source:          varchar("source", { length: 32 }),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  status:          varchar("status", { length: 32 }).notNull().default("Open"),
  // Open | Under Review | Resolved | Rejected | Closed
  resolution:      text("resolution"),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  resolvedAt:      timestamp("resolved_at"),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idx_ap_supplier_queries_org_id: index("idx_ap_supplier_queries_org_id").on(t.orgId),
}));
export type ApSupplierQuery = typeof apSupplierQueries.$inferSelect;

// =========================================================================
// PAYMENT RUNS
// =========================================================================
export const paymentRuns = pgTable("payment_runs", {
  id:                   uuid("id").defaultRandom().primaryKey(),
  orgId:                uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  runNumber:            varchar("run_number", { length: 64 }).notNull(),
  currency:             varchar("currency", { length: 8 }).notNull().default("EUR"),
  scheduledPaymentDate: varchar("scheduled_payment_date", { length: 16 }),
  status:               varchar("status", { length: 32 }).notNull().default("Draft"),
  // Draft | Pending Approval | Approved | Scheduled | Posted | Cancelled
  totalAmount:          real("total_amount").notNull().default(0),
  billCount:            integer("bill_count").notNull().default(0),
  notes:                text("notes"),
  createdByUserId:      uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId:     uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt:           timestamp("approved_at"),
  postedAt:             timestamp("posted_at"),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idx_payment_runs_org_id: index("idx_payment_runs_org_id").on(t.orgId),
}));
export type PaymentRun = typeof paymentRuns.$inferSelect;

// =========================================================================
// PAYMENT RUN ITEMS
// =========================================================================
export const paymentRunItems = pgTable("payment_run_items", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  paymentRunId:  uuid("payment_run_id").notNull().references(() => paymentRuns.id, { onDelete: "cascade" }),
  billId:        uuid("bill_id").notNull().references(() => apBills.id, { onDelete: "cascade" }),
  supplierId:    uuid("supplier_id").references(() => apSuppliers.id, { onDelete: "set null" }),
  amount:        real("amount").notNull(),
  currency:      varchar("currency", { length: 8 }).notNull().default("EUR"),
  dueDate:       varchar("due_date", { length: 16 }),
  status:        varchar("status", { length: 32 }).notNull().default("Pending"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
});
export type PaymentRunItem = typeof paymentRunItems.$inferSelect;

// =========================================================================
// AP APPROVAL TOKENS (external approver portal — like customerPortalTokens)
// =========================================================================
export const apApprovalTokens = pgTable("ap_approval_tokens", {
  id:             uuid("id").defaultRandom().primaryKey(),
  orgId:          uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  billId:         uuid("bill_id").references(() => apBills.id, { onDelete: "set null" }),  // primary/first bill (nullable for multi-bill tokens)
  billIds:        jsonb("bill_ids").$type<string[]>().notNull().default([]),               // all bills in this batch (like invoiceIds in customerPortalTokens)
  token:          text("token").notNull().unique(),
  approverEmail:  text("approver_email").notNull(),
  approverName:   text("approver_name"),
  sentByUserId:   uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status:         varchar("status", { length: 32 }).notNull().default("Pending"),
  // Pending | Approved | Rejected | Expired
  decision:       text("decision"),           // rejection reason or approval note
  submittedAt:    timestamp("submitted_at"),
  expiresAt:      timestamp("expires_at").notNull(),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  idx_ap_approval_tokens_bill: index("idx_ap_approval_tokens_bill").on(t.billId),
}));
export type ApApprovalToken = typeof apApprovalTokens.$inferSelect;

// =========================================================================
// AP BILL COMMENTS (chat log per bill — internal + approver + system)
// =========================================================================
export const apBillComments = pgTable("ap_bill_comments", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  billId:      uuid("bill_id").notNull().references(() => apBills.id, { onDelete: "cascade" }),
  body:        text("body").notNull(),
  authorId:    uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  authorName:  text("author_name").notNull(),
  channel:     varchar("channel", { length: 32 }).notNull().default("internal"),
  // internal | approver | system | email
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  idx_ap_bill_comments_bill: index("idx_ap_bill_comments_bill").on(t.billId),
}));
export type ApBillComment = typeof apBillComments.$inferSelect;

// Type exports
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Communication = typeof communications.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;

// =========================================================================
// ADVANCED REPORTING MODULE
// Configurable management-reporting layer on top of QBO. QBO stays the system
// of record; these tables define a SEPARATE reporting model (dimensions,
// values, classification rules, line-level overrides) that reinterprets QBO
// activity without changing any QBO data. See lib/reporting/.
// =========================================================================

// A reporting dimension — generic, NOT hard-coded to "Profit Center".
// e.g. Profit Center, Region, Business Unit, Division, Cost Centre.
export const reportingDimensions = pgTable("reporting_dimensions", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name:        varchar("name", { length: 120 }).notNull(),
  slug:        varchar("slug", { length: 64 }).notNull(),   // stable machine key, unique per org
  description: text("description"),
  kind:        varchar("kind", { length: 16 }).notNull().default("dimension"),  // "dimension" | "statement"
  sortOrder:   integer("sort_order").notNull().default(0),
  active:      boolean("active").notNull().default(true),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ orgSlug: uniqueIndex("reporting_dimensions_org_slug_idx").on(t.orgId, t.slug) }));

// A member of a dimension, with optional hierarchy (parentId → parent value).
export const reportingDimensionValues = pgTable("reporting_dimension_values", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  dimensionId: uuid("dimension_id").notNull().references(() => reportingDimensions.id, { onDelete: "cascade" }),
  parentId:    uuid("parent_id"),   // self-ref (FK added in SQL); hierarchy independent of QBO
  name:        varchar("name", { length: 120 }).notNull(),
  code:        varchar("code", { length: 64 }),
  // Statement-line metadata (only meaningful when the dimension kind = "statement"):
  lineKind:    varchar("line_kind", { length: 16 }).notNull().default("detail"), // detail | computed | header
  sign:        integer("sign").notNull().default(1),        // P&L contribution sign
  formula:     jsonb("formula"),                            // computed lines: [{ code, op: "+"|"-" }]
  sortOrder:   integer("sort_order").notNull().default(0),
  active:      boolean("active").notNull().default(true),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ dim: index("reporting_dimension_values_dim_idx").on(t.dimensionId) }));

// A classification rule: IF <conditions> THEN dimension = targetValue.
// `conditions` is a data-driven AND/OR/NOT tree (see lib/reporting/types.ts) —
// rules are configuration, never code.
export const reportingRules = pgTable("reporting_rules", {
  id:           uuid("id").defaultRandom().primaryKey(),
  orgId:        uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  dimensionId:  uuid("dimension_id").notNull().references(() => reportingDimensions.id, { onDelete: "cascade" }),
  targetValueId: uuid("target_value_id").references(() => reportingDimensionValues.id, { onDelete: "cascade" }),
  name:         varchar("name", { length: 160 }),
  description:  text("description"),
  priority:     integer("priority").notNull().default(100),   // higher wins; ties broken by specificity
  conditions:   jsonb("conditions").notNull().default({ op: "AND", conditions: [] }),
  active:       boolean("active").notNull().default(true),
  effectiveFrom: date("effective_from"),
  effectiveTo:  date("effective_to"),
  createdBy:    uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy:    uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ orgDim: index("reporting_rules_org_dim_idx").on(t.orgId, t.dimensionId) }));

// A line-level manual override — always beats rules. Keyed to a QBO txn line.
export const reportingOverrides = pgTable("reporting_overrides", {
  id:             uuid("id").defaultRandom().primaryKey(),
  orgId:          uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  dimensionId:    uuid("dimension_id").notNull().references(() => reportingDimensions.id, { onDelete: "cascade" }),
  valueId:        uuid("value_id").references(() => reportingDimensionValues.id, { onDelete: "cascade" }),
  txnType:        varchar("txn_type", { length: 32 }).notNull(),   // Invoice, Bill, JournalEntry, ...
  txnId:          varchar("txn_id", { length: 48 }).notNull(),     // QBO internal transaction Id
  lineId:         varchar("line_id", { length: 48 }).notNull(),    // QBO line Id (or synthetic index)
  originalValueId: uuid("original_value_id").references(() => reportingDimensionValues.id, { onDelete: "set null" }),
  reason:         text("reason"),
  userId:         uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ line: uniqueIndex("reporting_overrides_line_dim_idx").on(t.orgId, t.dimensionId, t.txnType, t.txnId, t.lineId) }));

export type ReportingDimension = typeof reportingDimensions.$inferSelect;
export type ReportingDimensionValue = typeof reportingDimensionValues.$inferSelect;
export type ReportingRule = typeof reportingRules.$inferSelect;
export type ReportingOverride = typeof reportingOverrides.$inferSelect;

// =========================================================================
// CRM CUSTOM FIELDS (admin portal) — admin-defined properties on
// accounts / leads / contacts. Platform-level (admin CRM isn't org-scoped).
// =========================================================================
export const crmFieldDefs = pgTable("crm_field_defs", {
  id:        uuid("id").defaultRandom().primaryKey(),
  entity:    varchar("entity", { length: 16 }).notNull(),      // account | lead | contact
  fieldKey:  varchar("field_key", { length: 64 }).notNull(),
  label:     varchar("label", { length: 120 }).notNull(),
  fieldType: varchar("field_type", { length: 16 }).notNull().default("text"),
  options:   jsonb("options"),                                 // select/multiselect choices
  required:  boolean("required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  active:    boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ entityKey: uniqueIndex("crm_field_defs_entity_key_idx").on(t.entity, t.fieldKey) }));

export const crmFieldValues = pgTable("crm_field_values", {
  id:        uuid("id").defaultRandom().primaryKey(),
  defId:     uuid("def_id").notNull().references(() => crmFieldDefs.id, { onDelete: "cascade" }),
  entity:    varchar("entity", { length: 16 }).notNull(),
  entityId:  varchar("entity_id", { length: 64 }).notNull(),
  value:     jsonb("value"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  defEntity: uniqueIndex("crm_field_values_def_entity_idx").on(t.defId, t.entityId),
  entityIdx: index("crm_field_values_entity_idx").on(t.entity, t.entityId),
}));

export type CrmFieldDef = typeof crmFieldDefs.$inferSelect;
export type CrmFieldValue = typeof crmFieldValues.$inferSelect;
