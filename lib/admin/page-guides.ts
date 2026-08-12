/**
 * Per-page contextual help for the admin portal. Keyed by route; the header
 * "Guide" button shows the entry for the current page. Adding a page's guide is
 * one entry here — no other change. Longest matching prefix wins (so detail
 * pages like /admin/leads/[id] can have their own, else fall back to the list).
 */
export interface PageGuide {
  title: string;
  intro: string;
  steps?: string[];   // "how to use it", in order
  tips?: string[];
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  "/admin": {
    title: "Overview",
    intro: "Your admin home — a health snapshot of the whole business: subscriptions, past-due billing, new leads, failed payments and open alerts.",
    steps: [
      "Scan the KPI cards for anything red — failed payments and past-due subscriptions need action first.",
      "Use the alerts list to jump straight to the record that needs attention.",
      "Move into <b>Today</b> for your task queue, or <b>Pipeline</b> to work deals.",
    ],
    tips: ["Numbers here reflect the latest sync — if something looks stale, open the record to see live detail."],
  },
  "/admin/queue": {
    title: "Today",
    intro: "Your single work queue across every lead and account — the tasks due now, so nothing slips.",
    steps: [
      "Toggle <b>All / Me</b> to focus on your own tasks.",
      "Work top-down: overdue first, then due today.",
      "Complete a task to log it to the record's timeline and auto-surface the next follow-up.",
    ],
    tips: ["Tasks are created from dispositions on the Pipeline, from sequences, and manually on any record."],
  },
  "/admin/accounts": {
    title: "Billing actions",
    intro: "Accounts that need a billing step — typically Won deals ready to be invoiced, or accounts to move to a subscription.",
    steps: [
      "Open an account to see its 360° view — timeline, contacts, notes, tasks and deals.",
      "Create the invoice / attach billing when the account is ready to pay.",
      "Log a touch or schedule the next action so the account keeps moving.",
    ],
  },
  "/admin/accounts/duplicates": {
    title: "Duplicates",
    intro: "Suspected duplicate accounts detected by matching domain, name and email — merge them so one company = one record.",
    steps: [
      "Review each suggested pair; confirm they're truly the same company.",
      "Choose the record to keep, then <b>Merge</b> — contacts, deals and history move onto the survivor.",
    ],
    tips: ["Merging is not automatic — you always confirm which record survives."],
  },
  "/admin/leads": {
    title: "Pipeline",
    intro: "Your sales pipeline — every lead and deal on one board. Records start as leads and become deals once they carry a value.",
    steps: [
      "Drag a card across stages (New → Contacted → Qualified → Proposal → Negotiation → Won) as it progresses.",
      "Log a call/email disposition on a card to record the outcome and auto-schedule the next task.",
      "Set a deal <b>value</b> and expected close so the weighted forecast in Reports is accurate.",
      "Use <b>Import</b> for CSV lead lists, or select several cards to batch-email them.",
      "Click a card to open the full record — timeline, contacts, tasks and sequences.",
    ],
    tips: [
      "Switch between board and list views with the toggle.",
      "To onboard a company that was never a lead, create it directly in Customers/Organisations — you don't have to run it through the pipeline.",
    ],
  },
  "/admin/leads/spam": {
    title: "Spam cleanup",
    intro: "Landing-page leads flagged as likely bot spam. New spam is already blocked at the form; this clears what got through before.",
    steps: [
      "Review the flagged leads — score ≥ 4 is high-confidence, 3 is borderline.",
      "<b>Reject selected</b> to move them off the board (safe, reversible), or <b>Delete selected</b> to remove them and purge their empty accounts.",
    ],
  },
  "/admin/leads/": {
    title: "Lead / deal record",
    intro: "The full cockpit for one lead or deal — everything that's happened and what to do next.",
    steps: [
      "Read the <b>timeline</b> — emails (threaded), calls, notes and stage changes in one stream.",
      "Log a note or send an email from the composer; add or edit <b>contacts</b> for the company.",
      "Add <b>tasks</b> with due dates, or <b>enroll</b> the lead in an email sequence.",
      "Move the stage or set the deal value as things progress.",
    ],
  },
  "/admin/workflows": {
    title: "Workflows",
    intro: "Email sequences (cadences) — automated multi-step drips that send on a schedule until a lead replies.",
    steps: [
      "Create a sequence and add steps (delay in days + subject + body).",
      "Activate it, then enroll leads from the Pipeline or a lead record.",
      "A reply stops the sequence automatically.",
    ],
    tips: ["Personalise subjects/bodies — sequences send from your connected mailbox, not a generic address."],
  },
  "/admin/reports": {
    title: "Reports",
    intro: "Sales analytics — funnel, win rate, pipeline by stage, sources, by-owner, activity and a weighted forecast, with a trend line from daily snapshots.",
    steps: [
      "Start with the <b>funnel</b> and <b>win rate</b> to see conversion health.",
      "Use <b>weighted forecast</b> (value × stage probability) for the expected number.",
      "Check <b>by owner</b> for rep performance and <b>activity</b> for effort.",
    ],
    tips: ["Forecast accuracy depends on deals having a value + expected close date set on the Pipeline."],
  },
  "/admin/campaigns": {
    title: "Campaigns",
    intro: "Marketing campaigns with UTM attribution — see which sources and campaigns generate leads and deals.",
    steps: [
      "Create a campaign and note its UTM key.",
      "Leads captured with matching UTMs attribute back here automatically.",
    ],
  },
  "/admin/inbox": {
    title: "Mail",
    intro: "A full mail client on your connected mailbox — read, reply and compose without leaving the CRM. Emails thread onto the matching lead's timeline.",
    steps: [
      "Pick a folder (Inbox / Sent), open a message to read it.",
      "Reply inline, or compose a new email; attachments are supported.",
    ],
    tips: ["Connect or change the mailbox under Settings → Email Integration."],
  },
  "/admin/customers": {
    title: "Customers",
    intro: "Your billing customer directory — every organisation on the platform and its subscription state.",
    steps: [
      "Open a customer to see subscription, invoices and org detail.",
      "Create a new organisation directly here to onboard a company manually (no lead pipeline required).",
    ],
    tips: ["New org didn't get its welcome email? Open it → Edit organisation → Resend welcome email (sends a fresh set-password link)."],
  },
  "/admin/settings/custom-fields": {
    title: "Custom Fields",
    intro: "Add your own properties to accounts, leads/deals and contacts — no code, no deploy. They appear on records and (soon) in filters.",
    steps: [
      "Pick the entity tab — Accounts, Leads/Deals or Contacts.",
      "Name the field, choose a type (text, number, money, date, select, …), add options for selects, mark required if needed.",
      "The field is available immediately on every record of that type.",
    ],
  },
  "/admin/settings/email": {
    title: "Email Integration",
    intro: "Connect the mailbox the CRM sends and receives from — Gmail, Microsoft, or IMAP/SMTP.",
    steps: [
      "Choose your provider and authorise (OAuth) or enter IMAP/SMTP credentials.",
      "Once connected, the Mail client and sequences use this mailbox; replies thread onto leads.",
    ],
    tips: ["Credentials are encrypted at rest. Each admin sends from their own connected mailbox."],
  },
  "/admin/team": {
    title: "Admin Team",
    intro: "Manage who has admin access and their role (platform_admin / super_admin).",
    steps: [
      "Add or edit admins and set their role.",
      "Super-admins can create/delete organisations; platform-admins run the CRM.",
    ],
    tips: ["Enrolled super-admins are protected by MFA (TOTP)."],
  },
};

export function guideForPath(path: string): PageGuide | null {
  if (PAGE_GUIDES[path]) return PAGE_GUIDES[path];
  const keys = Object.keys(PAGE_GUIDES)
    .filter((k) => k !== "/admin" && (path === k || path.startsWith(k.endsWith("/") ? k : k + "/")))
    .sort((a, b) => b.length - a.length);
  if (keys.length) return PAGE_GUIDES[keys[0]];
  return path === "/admin" ? PAGE_GUIDES["/admin"] : null;
}
