# Publishing to Google Play (iOS comes after)

Status: **Android-first.** Google Play Console account created (Personal
type). Apple is deferred until Play is live. This doc tracks exactly where
things stand and what's left, in order.

## Where things actually stand

- [x] Google Play Console account created (Personal).
- [ ] Google identity verification (in progress — Google says "a few days").
- [ ] Google phone number verification (blocked on identity verification).
- [ ] Google Android-device verification (install the Play Console app on a
      real Android phone, sign in — independent of the above, do it anytime).
- [ ] Expo (EAS) account — free, expo.dev/signup.
- [ ] `eas login` + `eas init` run locally (needs a browser — can't be done
      from an unattended session) → gives a `projectId` to paste into
      `mobile/app.json` → `expo.extra.eas.projectId` (currently a placeholder).
- [x] App icon, Android adaptive icon layers, splash — real branding, done
      (`mobile/assets/`).
- [x] Play feature graphic (1024×500) — done, `mobile/store-assets/feature-graphic.png`.
- [x] Store listing copy (description, keywords, category, data-safety
      questionnaire answers) — `mobile/STORE_LISTING.md`.
- [x] Demo reviewer account — scripted, `npm run db:seed-mobile-demo` (not yet run
      against production — needs a `DATABASE_URL` only you have).
- [ ] Phone screenshots of the actual running app — can't produce these until
      a build exists to install (see below).
- [ ] Confirm real support email + exact privacy-policy URL for the listing
      (placeholders in STORE_LISTING.md).

## The one Google-specific timeline fact that changes the plan

Because this Play Console account is **Personal** and was created after
Nov 13, 2023, Google requires a **closed test with 12+ testers, opted in
continuously for 14 straight days**, before the app can go to full
production — this is separate from and in addition to the identity
verification above. The 14-day clock starts when the 12th tester opts in,
not when the track is created.

So "achieve the Play Store listing" happens in two stages:
1. **Closed testing release** — achievable soon, once a build exists. Recruit
   12 people (your own team is fine, they don't need to be public) into a
   closed test track.
2. **Production release** — only after the 14 days complete and you submit
   the required post-test questionnaire. This is the actual "live and
   publicly listed" state.

Plan around stage 1 happening well before stage 2 — there's no way to
compress the 14 days once started, so start that track the moment a build
exists rather than waiting for every other checkbox above to be done first.

## Next concrete steps, in order

1. **You**: finish Google identity + phone + device verification (already
   in progress, just waiting).
2. **You**: create an Expo account, run `eas login` && `cd mobile && eas init`,
   send me the `projectId`.
3. **Me**: paste the `projectId` into `app.json`, commit.
4. **You or me**: `eas build --platform android --profile production` —
   cloud build, no Android Studio needed. First run will prompt to generate
   an Android signing keystore — EAS stores it; do not lose access to that
   Expo account, a lost keystore means the app can never be updated again
   under the same listing.
5. **You**: create the app in Play Console, fill the store listing from
   `STORE_LISTING.md`, upload `mobile/assets/icon.png` and
   `mobile/store-assets/feature-graphic.png`.
6. **You**: create a **closed testing** release, upload the `.aab` EAS
   built (download it from the EAS build page, or I run `eas submit
   --platform android` if you've set up a Play service-account key — see
   below), add 12 testers, start the 14-day clock.
7. **You**: once you have a build installed, take phone screenshots of
   Login, Home, and one workflow detail screen for the store listing.
8. **After 14 days**: submit the production-access questionnaire, then
   apply for full production release.

## Credentials — two paths for step 4/6

**Interactive (you run the commands):**
```bash
cd mobile
eas build --platform android --profile production
eas submit --platform android   # uploads the .aab to Play Console directly
```

**Non-interactive (hand me tokens, I run it from here):**
- **Expo access token**: expo.dev → account settings → Access Tokens.
- **Google Play service-account key**: Play Console → Setup → API access →
  create a service account, grant "Release" permission, download the JSON,
  save as `mobile/google-play-service-account.json` (gitignored — never
  commit it).

Either way works; think about how much you want to hand over vs. run
yourself. Manual upload through the Play Console UI for this *first*
release is also fine — it walks you through the listing/content-rating
steps interactively, which you have to do at least once regardless.

## iOS (later)

Deferred per your call. When we pick it back up: Apple Developer Program
enrollment as **Individual** (skips the D-U-N-S business-verification
detour), then `eas build --platform ios` — same EAS project, same
`projectId`, no separate setup needed on the code side.
