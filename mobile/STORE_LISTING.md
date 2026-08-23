# Store listing copy

Ready to paste into App Store Connect and Play Console. A few fields need a
real value from you before submission — marked **CONFIRM**.

## App identity

- **Name**: Prime Accountax
- **Subtitle** (iOS, ≤30 chars): Warehouse ops, on the go
- **Short description** (Play, ≤80 chars): Post goods receipts, production runs, and shipments from your phone.
- **Bundle ID / package**: `com.primeaccountax.mobile`
- **Category**: Business (primary); Productivity (iOS secondary, optional)
- **Support URL/email**: **CONFIRM** — placeholder `support@primeaccountax.com`.
  (CLAUDE.md mentions `support@foodready.ai` as the existing system-mail
  sender for the web app — confirm which address you actually want customer
  support requests to land on before using either.)
- **Privacy policy URL**: **CONFIRM exact URL** — you said one already
  exists on primeaccountax.com; paste the exact path here and into both
  consoles' listing forms.
- **Marketing URL** (optional): https://primeaccountax.com

## Full description

```
Prime Accountax is the mobile companion to your Prime Accountax
accounts-receivable and inventory platform — built for the warehouse
floor, not the back office.

Sign in with your existing Prime Accountax account and:

• RECEIVING — see every open purchase order with stock still due, post a
  goods receipt against it (with lot numbers and expiry dates), and watch
  it land in your books instantly.

• PRODUCTION — pick a bill of materials, enter how much you're producing,
  and post the production run. Input quantities scale automatically from
  the recipe, and inventory is relieved FIFO.

• SHIPPING — see every open sales order awaiting fulfillment and post a
  shipment against it in a few taps.

Everything you post syncs immediately with the same ledger your office
team sees in the web app — no double entry, no end-of-day reconciliation.

Prime Accountax mobile requires an active Prime Accountax organisation
account. Visit primeaccountax.com to get started.
```

## Keywords (iOS, ≤100 chars comma-separated)

```
inventory,warehouse,receiving,production,shipping,accounting,erp,stock,goods receipt,BOM,3PL
```

## App Privacy (Apple) / Data safety (Play) questionnaire

Answer based on what the app actually does — no ads, no analytics/tracking
SDKs, no third-party data sharing:

| Question | Answer |
|---|---|
| Data collected | Email address, name (account identity); organisation financial/inventory records (purchase orders, goods receipts, production runs, shipments) |
| Linked to identity | Yes — tied to the signed-in user's account |
| Used for tracking (ads, cross-app/cross-site) | No |
| Shared with third parties | No |
| Sold | No |
| Encryption in transit | Yes, HTTPS only |
| Users can request deletion | Via their organisation admin / support — same as the web app's existing account deletion process |
| Data collected from children | No — not directed at children, no age-gate needed (business tool) |

**Apple export compliance**: "Does not use encryption" → answer **exempt**
(uses only HTTPS/standard OS-provided encryption, no proprietary crypto).

## Age rating

No user-generated content visible to others, no violence/gambling/mature
content → **4+** (Apple) / **Everyone** (Play).

## App Review / reviewer access notes

Paste into App Store Connect's "App Review Information" notes and Play
Console's equivalent reviewer-access field:

```
This app requires an existing Prime Accountax account. Demo credentials
for review:

Email: app-review-demo@primeaccountax.com
Password: [run the seed script below to generate one]

The demo org has: one open purchase order (for the Receiving screen), one
active bill of materials with an input line (for Production), and one
open sales order (for Shipping) — otherwise those screens correctly show
an empty state with nothing to review.
```

**Action needed from you**: run this once against production (or a Neon
branch pointed at by a preview build) to actually create that org/user —
it's scripted (`scripts/seed-mobile-demo.ts`), idempotent, and touches
nothing but its own dedicated demo org:

```bash
DATABASE_URL="<production-db-url>" npm run db:seed-mobile-demo
```

It prints the generated password once at the end — copy it into the
Email/Password block above before pasting into App Store Connect / Play
Console. Re-running it is safe (won't duplicate data); pass
`DEMO_PASSWORD=...` to reset the password on a re-run.
