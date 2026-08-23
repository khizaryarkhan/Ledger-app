# Publishing to the App Store & Play Store

Status: **not started** — no Apple/Google/Expo accounts exist yet. This
doc is the exact path from here to a live store listing. Steps are grouped
by who has to do them.

## 1. Accounts only you can create

These involve payment and identity verification — I can't do them for you.

| Account | Cost | URL | What you get |
|---|---|---|---|
| Apple Developer Program | $99/yr | developer.apple.com/programs | Ability to sign & submit iOS builds, App Store Connect access |
| Google Play Console | $25 once | play.google.com/console/signup | Ability to submit Android builds |
| Expo (EAS) | Free tier works | expo.dev/signup | Cloud build/submit service — no Mac needed for iOS builds |

Do these first. Nothing below works without them.

## 2. One-time project setup (needs a person at a keyboard once)

```bash
cd mobile
npm install -g eas-cli      # or use `npx eas-cli` throughout, no global install needed
eas login                   # opens a browser — this step can't be done from an unattended session
eas init                    # creates the EAS project, prints a projectId
```

Paste the printed `projectId` into `mobile/app.json` → `expo.extra.eas.projectId`
(currently a placeholder).

## 3. Credentials — two paths

**Interactive (simplest, needs your Apple ID + Play Console login each time):**
```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```
EAS will prompt for Apple ID login (handles 2FA) the first time and manage
certificates/provisioning automatically. For Android it generates and
stores a signing keystore for you — do NOT lose access to the EAS account
holding it; a lost Android signing key means you can never update the app
again under the same listing.

**Non-interactive (lets me run builds/submits from this session without a
browser)** — if you'd rather hand me tokens than run commands yourself:
- **Expo access token**: expo.dev → account settings → Access Tokens →
  create one, then `export EXPO_TOKEN=<token>` before any `eas` command.
- **Apple**: App Store Connect → Users and Access → Integrations → App
  Store Connect API → generate a key (downloads a `.p8` + Key ID + Issuer
  ID). Let EAS use it via `eas credentials` (non-interactive mode) instead
  of your Apple ID/password.
- **Google Play**: Play Console → Setup → API access → create a service
  account, grant it "Release to production, exclude devices, and use Play
  App Signing" permission, download its JSON key, save as
  `mobile/google-play-service-account.json` (already gitignored — never
  commit it). This is what `eas.json`'s `submit.production.android` points
  at.

Think about which of these you're comfortable handing to an AI session —
they carry real billing/publishing power. At minimum, create the accounts
yourself; decide per-credential whether I run the command or you do.

## 4. Build & submit

```bash
eas build --platform all --profile production      # builds both, cloud-hosted, no Mac/Android Studio needed
eas submit --platform ios                            # uploads to App Store Connect (TestFlight first)
eas submit --platform android                        # uploads to Play Console (internal track first, per eas.json)
```

Start both platforms on an internal/TestFlight track before hitting "submit
for review" publicly — that's where you and reviewers actually run the app
against production data before the world can install it.

## 5. Store listing content (blocks review, not builds)

Both stores require, before they'll accept a submission:
- **App icon**: 1024×1024 PNG, no alpha channel, no rounded corners (stores
  add the mask). The current `mobile/assets/icon.png` is the generic Expo
  placeholder — swap for real Prime Accountax branding before submitting.
- **Screenshots**: iOS needs at least one 6.7" and one 5.5" display set;
  Android needs phone screenshots + a 1024×500 feature graphic. Easiest
  source: `eas build --profile preview` → install on a real device/
  simulator → screenshot the Login, Home, and one workflow detail screen.
- **Privacy policy URL** — you said this already exists on
  primeaccountax.com; get me (or put directly into App Store Connect / Play
  Console) the exact URL.
- **Support URL or support email**.
- **App Store "App Privacy" / Play "Data safety" questionnaire** — answer
  based on what this app actually does: collects account credentials
  (email, hashed server-side) and organisation financial/inventory data,
  linked to the signed-in identity, transmitted over HTTPS, not shared with
  third parties, not used for advertising/tracking.
- **Export compliance (Apple)** — HTTPS-only, no custom encryption →
  answer "exempt" (uses only standard OS-provided encryption).
- **Review notes / demo account** — since the app requires login, both
  reviewers need a working set of credentials for an org with at least one
  open PO, one active BOM, and one open SO (so Receiving/Production/
  Shipping aren't empty screens during review). Put this in App Store
  Connect's "App Review Information" notes and Play Console's equivalent
  reviewer-access field. Do NOT use a real customer's org for this —
  create a dedicated demo org/user.

## Where things stand right now

- `mobile/eas.json` — build profiles (development/preview/production) and a
  submit profile with placeholder Apple/Google fields to fill in once
  those accounts exist.
- `mobile/app.json` — bundle id `com.primeaccountax.mobile` (iOS) /
  package `com.primeaccountax.mobile` (Android) already set; swap if you'd
  rather use a different identifier (must be globally unique per store,
  can't be changed after first submission).
- Icons/splash are Expo's generic placeholders — fine for internal builds,
  need real branding before public submission.
