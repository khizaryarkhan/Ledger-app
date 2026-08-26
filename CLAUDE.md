# Prime Accountax — project guide for Claude Code

> This file is auto-loaded at the start of every Claude Code session in this repo,
> on any machine. Keep it current: when a hard-won gotcha or architectural
> decision emerges, add it here so no session (or teammate) relearns it.

## What this is

**Prime Accountax** (primeaccountax.com) — a multi-tenant SaaS for **accounts
receivable (AR) management & collections**, integrated with **QuickBooks Online
and Xero**. It syncs invoices/customers, automates branded payment reminders,
tracks promises & disputes, and reduces DSO. There's also an **accounts payable
(AP)** side and an in-progress **native accounting** engine (standalone GL, so an
org can run without QBO/Xero).

- **Stack:** Next.js 14 (App Router), TypeScript, Drizzle ORM, Neon Postgres,
  Tailwind, NextAuth, Stripe, Inngest (background jobs), deployed on Vercel.
- **Repo:** `github.com/khizaryarkhan/ledger-app`. Deploys auto on push to `main`.

## Run it

```bash
npm install
npm run dev            # Next dev server
npm run db:generate    # drizzle-kit: generate a migration from schema.ts
npm run db:migrate     # apply migrations (tsx scripts/migrate.ts) — runs on vercel-build too
```

Needs a `.env.local` (DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY, Stripe keys, QBO/
Xero client ids, etc.). **Local DATABASE_URL ≠ production DB** — don't assume data
parity. Some API routes need real keys, so a local `next build` can fail at
page-data collection for those routes even when the code is fine (e.g. an
accounting route needing an Intuit key) — that's an env gap, not a type error.
Verify changes with `npx tsc --noEmit`, which should be clean.

## Architecture & conventions

- **Multi-tenant:** every query is org-scoped. Helpers in `lib/api.ts` /
  `lib/billing.ts`: `requireOrg()`, `requirePlatformAdmin()`, `requireSuperAdmin()`
  (DB-revalidated, use for destructive/admin routes — never trust JWT alone).
- **Stripe is the source of truth for billing.** Never hand-edit billing state.
  Card data never touches the app (out of PCI scope).
- **Secrets** (mailbox passwords, OAuth tokens) are encrypted at rest via
  `lib/crypto.ts` (AES-256-GCM, keys from ENCRYPTION_KEY/AUTH_SECRET).
- **Real 1:1 collection emails** send from the admin's own connected mailbox
  (Gmail/Microsoft/SMTP). `support@foodready.ai`-style system mail is only for
  transactional/system messages.
- **Money:** `fmt.money()` in `lib/format.ts` deliberately rounds to whole
  numbers for scannability. GL/ledger columns use `numeric(14,2)` (stored as
  `.toFixed(2)` strings for Drizzle).
- **Theming:** app supports Dark/Light/System via CSS variables. The Tailwind
  palette (stone + accent steps) resolves through `rgb(var(--…))` in
  `tailwind.config.js`; token values live in `app/globals.css` (`:root` = dark,
  `[data-theme="light"]` = light). `ThemeProvider` (set on the app shell only)
  stamps `data-theme`. **Never build Tailwind class names at runtime** (string
  concat/`.replace`) — the scanner only sees literal class strings, so dynamic
  ones silently render unstyled. Use explicit literal ternaries.

- **Entry forms compose from `components/form-kit.tsx`** — the single source
  of truth for field styling (dark). Use `<Field>` (label→control→hint/error),
  `<Section>`, `<SelectField>`/`<CellSelect>` (custom chevron — never rely on the
  native OS `<select>` arrow), and the `control` (raised, for stone-950 panels) /
  `controlInset` (for stone-900 drawer panels) / `cell` / `th` tokens. Don't
  hand-roll input class strings in feature components — that's how the forms
  drifted into inconsistency before. The New Document form + all inventory
  drawers (Receiving/Shipping/Products/BOM/MO) are already on it.

## ⚠️ Gotchas that have bitten us

- **neon-http has NO transactions.** `db.transaction()` throws. Use
  pre-validation + a single multi-row statement, or compensating deletes with
  loud error logs. Never assume atomicity across statements.
- **Hand-written migrations** in `db/migrations/` need `--> statement-breakpoint`
  between statements, and the `meta/_journal.json` entry's `when` must be
  GREATER than the previous (drizzle skips entries with an older/equal `when` —
  this silently dropped a table in prod once). Latest is `0025` at `when`
  `1783300000000`; keep incrementing.
- **Tailwind `content` globs must include `lib/**`** — classes defined in shared
  lib files were silently unstyled until it was added.
- Test migrations/backfills on a **Neon branch** before prod. Don't run
  destructive steps (NOT NULL, deletions) until a backfill is verified on prod.

## Key domain concepts

- **Collections Board** (`app/(app)/board/`, `components/board-list.tsx`): the
  daily working screen. Rows = open invoices, grouped Customer→Project.
- **Stage** is the single dynamic state per invoice. The pill shows the richest
  state: Escalated (`→ Owner · Type`), Disputed (`· reason`), **Broken
  commitment** (a promise whose date has passed — shown in red, NOT "Committed"),
  Committed (`· date`), or a plain stage. Escalation/Committed/Disputed each open
  an inline picker. Stage & customer response are unified: `recomputeInvoiceState`
  in `lib/portal.ts` syncs promise→Committed / dispute→Disputed and reverts.
- **Escalation types** (`lib/escalation-types.ts`): stage stays "Escalated"; the
  *type* (Handed Over, Final Account, Retention, Legal, etc.) is the "why".
- **Receivable Composition** (`lib/receivable-composition.ts`): shared classifier
  splitting open AR into workable / blocked / not-yet-due groups. Powers the
  Dashboard widget and the Board's click-to-filter strip. Chart colors are
  validated per theme (3 semantic hues: rose=blocked, sky=workable,
  emerald=current) — don't hand-pick a hue per category.
- **QBO Reports API:** modernized (`testing_migration=true`) is validated and in
  use. `app/api/reporting/[type]` serves native QBO/Xero reports (Reporting
  module, gated by `organisations.reporting_enabled`).
- **Owner escalation portal** (`app/owner-portal/[token]/`): no-login, token-auth,
  30-day expiry, ownership re-checked live on every request.
- **Inventory & manufacturing (perpetual, FIFO by lot):**
  - **Item kinds** (`lib/inventory/item-kinds.ts`) are the single source of truth
    for accounting behaviour. `apItems.productType` ∈ FinishedProduct | StockItem
    | RawMaterial | WorkInProgress | NonInventory | Service. Each declares
    tracked/sellable/buyable/producible/consumable. `kindOf()` normalises;
    `qboItemType()` keeps the legacy `itemType` (Service/Non-Inventory/Inventory)
    in sync for reporting. Tracked items carry `assetAccountId` + `cogsAccountId`
    (default to the **Inventory Asset** / **COGS** system accounts, added to
    `SYSTEM_ACCOUNTS`, resolved by subtype `Inventory` / `SuppliesMaterialsCogs`).
  - **Valuation engine** (`lib/inventory/valuation.ts`): a LOT (`inventory_lots`)
    is a dated FIFO cost layer. `commitReceipt` creates one on purchase/production;
    `planIssue`/`commitIssue` relieve oldest-first (or specific picked lots) at
    exact cost; `reverseInventoryByEntry` unwinds a document's lots/movements
    (refuses if stock was consumed downstream). `recalcItemCache` recomputes the
    cached `on_hand_qty`/`inv_value` from open lots after every change (neon has
    no transactions — plan read-only, then commit, then recalc). Every movement
    is logged in `inventory_movements`.
  - **Posting** (`lib/accounting/documents.ts`): Bill/Expense of a tracked item
    routes the debit to its Inventory Asset (not expense) and creates a receipt
    lot; Invoice/SalesReceipt appends **Dr COGS / Cr Inventory** at FIFO cost
    (home currency, appended after `toHome`) on top of Dr AR/Bank–Cr Revenue.
    Credit notes / vendor credits (returns) don't move stock yet — known TODO.
    The form now carries `itemId` (+ lot no/expiry on purchase lines) to posting.
  - **BOM** (`boms`/`bom_lines`, `/api/inventory/boms*`, `components/bom-register.tsx`,
    `/accounting/bom`): recipe of output←input items. **Production build**
    (`lib/inventory/production.ts`, `/api/inventory/production`,
    `components/production-console.tsx`, `/production/build`) consumes picked
    input lots and produces an output lot at the summed cost — Dr output Inventory
    / Cr each input Inventory, no P&L. `production_runs`/`production_consumptions`
    record it. "Production" is a numbered DocType (BUILD- series).
  - **Procure-to-pay (three-way match):** PO (`trade_documents`, non-accounting)
    → **Goods Receipt** (`goods_receipts`/`_lines`, `lib/inventory/receiving.ts`
    `postGoodsReceipt`: Dr Inventory / Cr **GR/IR** clearing + FIFO lot, lot #
    captured here) → **Bill from receipt** (`billFromReceipts`: reuses
    postDocument with GR/IR-clearing lines → Dr GR/IR / Cr A/P). GR/IR is a
    system account (subtype `GRIRClearing`). PO lines carry pack-level ordering
    (`order_uom`/`pack_level`/`units_per_order_unit`/`ordered_base_qty`) +
    `received_qty`/`billed_qty`. UI: `/accounting/receiving`
    (`receiving-console.tsx`). Reports: Open POs / Expected Bills (open GR/IR) /
    Open Bills + inventory Expected-Qty (`/api/inventory/procurement-reports`,
    `components/procurement-reports.tsx`). Every step is bypassable (receive
    with no PO; a direct Bill with inventory items still posts Dr Inventory /
    Cr A/P and makes lots).
  - **Order-to-cash (sales mirror):** Sales Order (`trade_documents` kind
    `SalesOrder`, non-accounting, pack-level ordering from finished-product SKUs)
    → **Shipment** (`sales_shipments`/`shipment_lines`, `lib/inventory/shipping.ts`
    `postShipment`: **COGS at shipment** — Dr COGS / Cr Inventory at FIFO cost)
    → **Invoice from shipment** (`invoiceFromShipments`: Dr A/R / Cr Revenue;
    invoice lines carry no `itemId` so COGS is NOT re-posted). UI:
    `/accounting/shipping` (`shipping-console.tsx`). SOs are fulfilled via
    Shipping, never converted. Reports: Open SOs / Awaiting Invoicing / Open
    Invoices (`/api/inventory/sales-reports`, `components/sales-reports.tsx`);
    Stock Status shows Committed (on SO) and Available = on-hand+expected−committed.
    Bypassable: ship with no SO; a direct Invoice with inventory items still
    posts revenue + COGS itself. (`receivedQty`/`billedQty` on trade lines are
    reused as shipped/invoiced for SOs.)
  - **Not yet:** UoM conversion on Bill/invoice/BOM lines (qty assumed base UoM
    outside PO/SO/receiving/shipping); sales/purchase-return inventory;
    standard-cost variances; multicurrency GR/IR & AR/AP FX variance.

## Where things live

- `app/(app)/` — the authed app (dashboard, board, invoices, customers, payables,
  reporting, settings, admin, …). `app/(app)/layout.tsx` = shell + ThemeProvider.
- `app/api/` — route handlers. `app/owner-portal/`, `app/register/` — public.
- `components/` — `board-list.tsx`, `sidebar.tsx`, `data-provider.tsx` (client
  data context), `theme-provider.tsx`, UI primitives in `ui.tsx`.
- `db/schema.ts` — the whole schema. `db/migrations/` — SQL + `meta/_journal.json`.
- `lib/` — domain logic: `ledger.ts` (GL engine), `portal.ts` (recompute/tokens),
  `qbo-sync.ts`/`xero-sync.ts`, `mailer.ts`, `escalation-types.ts`,
  `receivable-composition.ts`, `format.ts`, `crypto.ts`, `api.ts`, `billing.ts`.
- `inngest/` — background jobs (scheduled chases). `scripts/` — migrate/seed/backfill.
- `mobile/` — React Native (Expo) mobile app, separate `npm` project (its own
  `package.json`/`node_modules`, not part of the Next.js build). Organised by
  **department** (`mobile/src/departments.ts`, role-gated): **Operations**
  (Receiving / Production / Shipping) and **Receivables** (the rep portal —
  overview, invoice list + detail with promise/dispute/note/stage actions,
  escalations, customers). See `mobile/CLAUDE.md`. Talks
  to the same `app/api/` routes as the web app, but via a bearer-token auth
  path (`app/api/mobile/auth/*`, `lib/mobile-auth.ts`) since RN can't use the
  httpOnly session cookie — `lib/api.ts`'s `requireOrg()`/`requireAuth()`
  accept `Authorization: Bearer <token>` as a fallback, re-validated against
  the DB exactly like the cookie path. Not yet run on a device/simulator.

## Working style

- Commit messages are detailed and explain the *why* — a fresh session should be
  able to reconstruct recent work from `git log`.
- Branch off `main` for anything non-trivial; `main` auto-deploys.
- End commit messages with the Co-Authored-By trailer.
