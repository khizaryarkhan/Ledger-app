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

## Data Studio (bulk import/export, `app/(app)/batch/`)

Spreadsheet-driven bulk operations against QBO/Xero — import, export, update,
delete for ~32 entity types. `lib/batch/entities.ts` is the registry: each
entity declares its `columns`, a `build` (sheet → QBO payload), `toRows`
(QBO record → sheet rows), and the `refs`/`reverseRefs` lists to resolve.

**Three things must agree, or a column is a lie:**

1. `columns` — what the header row promises
2. `toRows` — what the export actually fills in
3. `build` — what the import actually reads back

A column present in (1) but missing from (2) exports blank; missing from (3)
means the user's edit is silently discarded on import. Bank Deposits had NINE
such columns (`Received From` most damagingly — the payer name, without which
an export is useless for reclassifying). When adding or touching an entity,
check all three, and prefer a scripted round-trip check (feed a realistic QBO
payload through `toRows` → write the xlsx → `build` it back) over eyeballing.

**Update (modify) always re-reads the record and uses ITS SyncToken, never
the sheet's.** A downloaded sheet's SyncToken is only as current as the
moment it was downloaded — anything touching the record afterward (another
job, a scheduled sync, or just time passing before the edited sheet is
re-uploaded) makes it stale. QuickBooks rejects a stale SyncToken with
"[name] is working on this at the same time" — its generic wording for
"this token isn't current," which fires whether or not anyone is actually
concurrently editing it. `commitOneDoc` (`lib/batch/commit-one.ts`) already
re-reads the record for the estimate-link check and the CustomField merge
(the two full-update fixes above); it just wasn't using that fresh read's
SyncToken in the outgoing payload — still sending the sheet's stale one,
which is exactly what surfaced this false "multiple users" rejection in a
single-user org. Falls back to the sheet's value only if the re-read itself
fails, so a network hiccup doesn't turn into a hard failure when a
plausible token was already in hand.

**Every write operation (import, delete, bulk-edit, update) must go through
ONE shared per-document commit function — `lib/batch/commit-one.ts`'s
`commitOneDoc`.** Fixing a bug in shared logic doesn't help if a second,
independent copy of that logic exists elsewhere and keeps running unfixed.
That's exactly what happened here: `commitOneDoc`'s sparse-vs-full-update
fix (below) was correct, but `commit-runner.ts` — the whole-job runner
behind the dedicated `/batch/modify` screen (`/api/batch/upload/commit`,
used whenever a job is small enough to run inline, ≤100 docs) — had its
OWN independent inline copy of build+estimate-safety-check+sparse+qboPost,
never updated. A user editing a two-line deposit down to one line and
re-uploading through `/batch/modify` kept hitting the still-broken copy,
appending the edited line on top of the original two. `commit-runner.ts`
now calls `commitOneDoc` like `chunk-runner.ts` already did — one
implementation, not two. **Lesson: after any correctness fix to shared
logic, grep the whole tree for the pattern you just fixed** (`sparse`, in
this case) to confirm there isn't a second copy still doing the old thing.

**Update (modify) on a line-item entity must NOT be a sparse patch —
`lib/batch/commit-one.ts`'s `shapeModifyPayload`.** QuickBooks' documented
sparse-update rule for the `Line` collection: a line without its own
line-level `Id` is a NEW line; anything not mentioned is left alone. Data
Studio never round-trips QBO's per-line ids (only the document-level
`Id`/`SyncToken`), so every line in an update payload is always id-less —
under `sparse:true` that meant every "Update" on a downloaded, edited sheet
APPENDED the sheet's lines instead of replacing the old ones (the actual
bug behind "I edited the lines and QuickBooks shows extra ones now"). Fix:
whenever the built payload carries a `Line` array, do a FULL (non-sparse)
update instead — QBO then treats the submitted lines as the complete new
truth. The cost of going full is that any header field QBO tracks that the
builder doesn't send gets reset; the sales/purchase builders already model
tax fields (`GlobalTaxCalculation`, per-line `TaxCodeRef`) on both create
and update, so that wasn't a new gap — `CustomField` was the one real one,
now merged forward from the existing record. Entities with no `docKey`
(list entities, Transfer, TimeActivity, …) never carry a `Line` array and
are untouched — still a correct, safe sparse patch.

**BUT a full update does NOT remove omitted lines on every entity — Deposit
is the proven exception.** Verified three ways (importer payload, whole record
echoed back, bare minimal payload): a Deposit update returns **200 OK and keeps
every line omitted from the payload**. So "download → delete rows → re-upload"
could never delete a deposit line via update — QBO just ignores the removal.
The fix is the `recreateOnLineRemoval` entity flag (`types.ts`, set on Deposit):
when a Modify drops a line (an existing per-line `Id` on the record is absent
from the sheet), `commitOneDoc` calls `recreateWithNewLines` — **create the
corrected record FIRST, then delete the original** (neon-http/QBO have no
cross-call transaction, so create-first means a failure leaves a visible
duplicate, never a vanished deposit), and **refuse outright** when any line is a
`LinkedTxn` sweeping a payment from Undeposited Funds (delete+recreate would
break the link). Adds and in-place edits keep their line ids → normal update
path → record id + bank reconciliation preserved. Whether Invoice/Bill/etc. share
Deposit's no-drop behaviour is UNVERIFIED — test before assuming full-update
replace works for them; if it doesn't, just set the same flag. Verify any change here
with `shapeModifyPayload` directly (pure, no I/O) rather than a live script
against `qboPost`/`qboReadOne` — tsx's module interop doesn't preserve ESM
live bindings for named function imports, so monkey-patching those from
outside the module silently no-ops and the real functions run instead.

**Every write operation (import, delete, bulk-edit) runs on ONE shared,
resumable engine — `lib/batch/lease.ts`.** It didn't used to: upload had a
lease/cursor design (chunk-runner.ts), delete ran its whole loop synchronously
in the HTTP handler with a single `db.update` at the very end, and bulk-edit
`await`ed its whole job inline before the response returned (its client-side
poll() was dead code — the job was always already "done" by the time the
first poll fired). Both of the non-upload paths meant: past a few hundred
records, or any hiccup, the platform could kill the function mid-loop with
an unknown number of QuickBooks writes already done and **zero record of
which ones**. For delete that's worse than it sounds — there's no source
file left afterward to diff against and see what's missing.

The fix generalized upload's pattern rather than inventing three fixes:
`claimChunk`/`recordItem`/`finishChunkCall`/`runChunkLoop` in `lease.ts` are
the whole primitive (atomic UPDATE-based, since neon-http has no
transactions — see the gotcha below). `chunk-runner.ts` (upload/modify),
`delete-chunk-runner.ts`, and `fieldedit-chunk-runner.ts` are thin adapters:
each just supplies "what is item N" and "how do I process one item."

**Processing is server-driven, not browser-driven.** The client used to
`while(!done)`-loop calling `/api/batch/upload/chunk` itself — so closing the
tab, a laptop sleeping, or a flaky connection outlasting the retry budget
silently stopped the import at whatever cursor it reached. `runBatchChunkLoop`
(`inngest/functions/batch.ts`) now drives every chunked job via Inngest event
self-chaining (`step.sendEvent` back to itself until `done`), independent of
any browser tab. The client still fires one best-effort "nudge" after
starting a job (matching the existing dual-trigger pattern in
`commit-runner.ts`) and then just polls `GET /api/batch/jobs/[id]` for
progress — the same poll() function now works for all four flows, not just
Xero's legacy whole-job path.

**`lib/batch/reap.ts` resumes before it gives up.** The old reaper (in both
`GET /jobs` and `GET /jobs/[id]`, duplicated) only ever flipped a stuck job to
"failed" after 5 minutes, with a vague "stopped part-way" message that never
said how many records were never even attempted — which is the exact shape
of the reported bug (a 300-row import showing 70 success / 1 failed, with the
other 229 unaccounted for anywhere). Now: a stuck CHUNKED job (leaseUntil is
the structural marker — set, already-expired, at job creation by every
chunked start route) gets nudged via the same Inngest event rather than
failed outright, and only gives up after ~20 minutes of failed nudges, with
an honest count (`"71 of 300 attempted — the remaining 229 were never
attempted"`). A `batchJobWatchdog` cron (every 2 minutes) does the same thing
independent of anyone opening Job History, so an interrupted run self-heals
without a human noticing. Legacy whole-job runners (Xero commit, scheduled
QBO imports) never set `leaseUntil` — that's what tells the reaper/watchdog
they're not chunk-resumable, so they still just age out at the original
5-minute cutoff. **This distinction matters**: a watchdog query that also
matched `leaseUntil IS NULL` would treat every *healthy, currently-running*
legacy job as "stale" on every tick and fire a second, concurrent processor
at it — a real duplicate-QBO-writes bug caught during review, not shipped.

**One narrow, pre-existing risk this doesn't close**: if the QBO write for
one item succeeds but the process is killed before `recordItem` commits that
result, a retry reprocesses the same item — a possible duplicate create, and
if it happens the id is also never logged, so Undo can't find it either. This
was already true of the original upload-only design; extracting it to a
shared engine didn't add or remove the exposure. It's rare (the window is one
DB write, not the whole chunk) but real — worth a proper idempotency-key
design if it ever shows up in practice.

**Dropdowns live in `lib/batch/dropdowns.ts`, shared by the template AND the
export.** They were originally only in the template route, which is backwards:
the export is the file people actually edit, so it's the file that most needs
valid picks. `refKindForColumn` (`lib/batch/ref-columns.ts`) maps a column name
to its QBO list; `UNION_COLUMNS` handles columns that legitimately accept more
than one kind (a deposit's "Received From" may be a customer, vendor OR
employee — offering only customers makes a real vendor refund look invalid).
CSV can't carry validations, so xlsx is the format to prefer for round trips.

`RefResolver.preload` is parallel and swallows per-list failures, so adding
kinds costs ~the slowest list, not the sum.

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
