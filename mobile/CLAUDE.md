@AGENTS.md

# Prime Accountax — mobile app

React Native (Expo SDK 57, TypeScript) client for the accounting module's
floor operations. Talks to the same Next.js backend as the web app
(`../app/api/`), via a separate bearer-token auth path — see
`../lib/mobile-auth.ts` and `../app/api/mobile/`.

## Scope (v1)

Deliberately narrow: **Receiving, Production, Shipping** — the three
inventory workflows that make sense on a phone (scan/select a document,
enter quantities, submit). Everything else in the accounting module (BOM
builder, the 14-type document-entry form, GL/journal, reports) stays
web-only — those are dense desktop grids that don't translate to a phone
screen. Extending this app to more workflows means adding a screen pair
(List + Detail) under `src/screens/`, plus API bindings in `src/api/`
mirroring the existing pattern.

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
