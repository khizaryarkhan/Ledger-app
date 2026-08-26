@AGENTS.md

# Prime Accountax — mobile app

React Native (Expo SDK 57, TypeScript) client for the accounting module's
floor operations. Talks to the same Next.js backend as the web app
(`../app/api/`), via a separate bearer-token auth path — see
`../lib/mobile-auth.ts` and `../app/api/mobile/`.

## Structure: departments

The app is organised by **department**, not by a flat list of screens
(`src/departments.ts` is the single source of truth). Each department
declares the roles that may use it, and `HomeScreen` renders only what the
signed-in role can actually do — a rep sees Receivables, warehouse staff
see Operations, an admin sees both. A section you can't act in is never
offered and then 403'd. Adding an area (Payables, Reports, …) means another
entry there, not another button bolted onto the home screen.

Role gating here is presentation only. The API enforces the same lines
independently: `canPostInventoryTxn()` for floor transactions,
`lib/receivables/rep-scope.ts` for a rep's book.

## Scope

**Operations — Receiving, Production, Shipping.** The three inventory
workflows that make sense on a phone (scan/select a document, enter
quantities, submit).

**Receivables — the whole rep portal.** Overview (total AR, overdue,
aging), the invoice list with server-side filters and search, invoice
detail with the actions a rep takes on a call (log a commitment, raise a
dispute, clear the response, add a note, move stage, share the PDF, call
or email the contact), promise/dispute history, the activity feed, My
Escalations, and customers rolled up by open balance.

Notably NOT ported: everything in the accounting module that's a dense
desktop grid — BOM builder, the 14-type document-entry form, GL/journal,
reports. Those stay web-only.

Extending this app means adding a screen pair (List + Detail) under
`src/screens/<area>/`, API bindings in `src/api/`, and an entry in
`src/departments.ts`.

## Receivables: server-side scope

The web rep portal fetches every invoice/customer/project/rep in the org
and filters the arrays in React, so `/api/invoices` hands a rep the whole
organisation's receivables and the scope is a presentation detail. Mobile
can't work that way (a rep on 3G shouldn't download the org) and
shouldn't: `lib/receivables/rep-scope.ts` recomputes the identical rule on
the server, and `app/api/mobile/receivables/*` returns only the caller's
slice.

The same helper closed a real write hole: the action endpoints take an
invoice id, so a rep could previously act on ANY invoice in the org by
supplying its id. `isInvoiceInScope()` now guards the promise, dispute,
response, PATCH, PDF and communications routes.

Actions go through `/api/invoices/[id]/response` — the canonical
"set the customer response" endpoint the board and portals share — so
promise ⇄ dispute ⇄ clear stay consistent and `recomputeInvoiceState`
syncs the stage. An outcome logged on a phone is indistinguishable from
one logged at a desk. The one mobile-only endpoint is
`/api/mobile/receivables/invoices/[id]/note`, which derives
customer/project/author server-side instead of trusting five fields from
the client the way `/api/communications` does.

Stage labels are fetched, never hard-coded: the summary endpoint returns
the org's own stage list (renames included) as `stageOptions`.

## Auth model

The web app uses NextAuth's httpOnly session cookie, which a React Native
client can't rely on. Mobile gets its own stateless JWT pair instead,
signed with the same `AUTH_SECRET` NextAuth already uses:

- `POST /api/mobile/auth/login` — email+password(+MFA), same verification
  as the web login (`lib/credentials.ts`, shared by both). Returns tokens
  directly if the user has exactly one org; otherwise a short-lived
  `preAuthToken` + the org list.
- `POST /api/mobile/auth/select-org` — exchanges `preAuthToken` + `orgId`
  for an access/refresh pair once the org list has more than one entry.
- `POST /api/mobile/auth/refresh` — rotates the pair; re-validates user
  status and org membership from the DB every time (a deactivated user or
  a removed membership is denied immediately, same guarantee as the web
  session).
- Every other route (`lib/api.ts` `requireOrg()`/`requireAuth()`) accepts
  `Authorization: Bearer <accessToken>` as a fallback when there's no
  cookie session — the bearer token is treated exactly like the
  `active_org_id` cookie for org resolution, then re-validated against the
  DB via the same membership/status checks the web path already uses. No
  new security logic was introduced; the bearer path reuses `requireOrg`'s
  existing DB re-validation end to end.
- No server-side revocation list (same stateless-JWT trust model as the
  web session). Access tokens are short-lived (1h); refresh tokens are
  30 days and re-validated on every use.

Tokens are stored via `expo-secure-store` (`src/api/client.ts`), which
auto-refreshes on a 401 and retries the request once before surfacing an
error.

Because the bearer token lives in SecureStore and not in a cookie, the
system browser can't fetch an authenticated URL. So the invoice PDF is
downloaded with the header attached (`expo-file-system`) into the cache
directory and handed to the OS share sheet (`expo-sharing`) — see
`src/api/pdf.ts`. Opening the URL directly would 401.

## Architecture choices

- **Navigation** — `@react-navigation/native` + `native-stack`, pinned to
  the versions Expo SDK 57 bundles
  (`node_modules/expo/bundledNativeModules.json` is the source of truth —
  `npx expo install` normally resolves these automatically, but its
  compatibility-check network call is blocked in some sandboxed
  environments, so versions here were pinned by hand against that file).
- **No global state library** — auth lives in `src/auth/AuthContext.tsx`;
  screens fetch their own data with `useFocusEffect` so switching tabs/back
  always shows fresh open-PO/SO/BOM lists.
- **`API_BASE_URL`** (`src/config.ts`) comes from `app.json`
  `expo.extra.apiBaseUrl`, overridable via `EXPO_PUBLIC_API_BASE_URL` — a
  phone/simulator can't reach a laptop's `localhost`, so point it at a LAN
  IP or tunnel URL while developing against a local backend.

## Not yet tested on-device

This app was written in a sandboxed environment with no simulator/device
and no Metro bundler run — `npx tsc --noEmit` is clean, but nobody has
actually run `npx expo start` against it yet. Before trusting it: run it
against a real backend, sign in, and walk all three flows end to end.
