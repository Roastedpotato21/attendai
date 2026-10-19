# Accountless guardian notification enrollment

## Android production verification on 2026-10-19

The current task authorizes enrolling the user's Android/Chrome phone and sending one isolated guardian transport test. This supersedes the earlier task-specific restriction against that transport test in `policy-and-fcm-trial.md`. Attendance testing is deferred until a legitimate fresh event exists. General FCM and SMS delivery remain disabled.

Staff can open **Guardian devices**, create a private enrollment link, and show its QR code to the parent. Open the link in Chrome on the receiving phone. The parent must check the initially empty consent box, tap **Enable Notifications**, and grant browser permission. FCM addresses the browser installation; a phone number is not required or used. Each additional phone needs its own one-use invitation and affirmative consent. Existing device records are preserved; consent is never populated by an operator on a parent's behalf.

The notice explains Firebase delivery, lock-screen visibility, and withdrawal. The enabled page confirms saved consent. A device without the current notice receives a specific prompt to obtain a new enrollment link. Staff can also revoke an active legacy installation that has no consent.

Foreground test messages now request a system notification as well as showing their text in the page. They do not automatically record display acknowledgement. The user can tap the system notification or choose **I saw the test notification** after seeing it. Background FCM notification payloads use Firebase's automatic display and HTTPS click link. Provider acceptance and device acknowledgement remain separate results.

After enrollment, refresh the guardian page on the phone after deployment, then run:

```sh
node --env-file-if-exists=.env scripts/preflight-guardian-push.mjs
node --env-file-if-exists=.env scripts/run-guardian-transport-test.mjs --preflight
node --env-file-if-exists=.env scripts/run-guardian-transport-test.mjs --validate
node --env-file-if-exists=.env scripts/run-guardian-transport-test.mjs --send
node --env-file-if-exists=.env scripts/run-guardian-transport-test.mjs --status
```

Run `--send` only once after current consent and provider validation pass. The durable execution key prevents a second send. `--status` only reads the stored result and is safe to repeat. A successful provider result must not be described as confirmed phone delivery until the device acknowledgement or tester's observation is available. A device must be enrolled by the parent; a browser fixture cannot establish production consent or phone delivery.

References checked for this release:

- [Firebase Web registration and installation IDs](https://firebase.google.com/docs/cloud-messaging/web/get-started)
- [Firebase foreground and background message handling](https://firebase.google.com/docs/cloud-messaging/web/receive-messages)
- [Firebase JavaScript messaging API](https://firebase.google.com/docs/reference/js/messaging)
- [WebKit iOS Home Screen push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

Local validation: 58 communication/security tests, TypeScript, ESLint, production build, isolated Chrome consent/service-worker checks, and the disposable PostgreSQL suite through migration `00023` passed. Server Firebase authentication also passed without sending a message. Production deployment and phone trial results are recorded in `policy-and-fcm-trial.md`.

## Flow

Authorized staff create a 15-minute, one-use invitation in Guardian devices. The private URL stores its random capability in the fragment. The public guardian page submits that capability to the server, which validates the invitation before returning only the institution name and eligible linked student names. The guardian checks an initially empty consent box and taps **Enable Notifications**. Only then does the browser ask for notification permission. The server atomically consumes the invitation, registers the Firebase installation for `attendai-41f64`, and stores guardian notice version `2026-10-16.1` in `guardian_notification_consents`. No guardian staff or Supabase Auth account is created.

The current notice describes student names, attendance state and date in a possible alert; the institution administrator handles privacy and support requests unless `VITE_POLICY_CONTACT` is configured. The Terms and Privacy pages remain product drafts pending institutional/legal review, with no approval claim.

Existing installations have no recorded affirmative guardian notice consent. Migration `00023` preserves them but fences them from new push sends until a guardian accepts the notice through a new invitation. Guardian `communication_consent`, relationship `receives_notifications`, browser permission, and staff policy acceptance remain independent gates.

## Delivery

The normal push worker resolves guardian, institution, student, current absence, eligible installation, and consent from server-side Supabase data. It suppresses absences queued longer than the configured attendance TTL or from old attendance dates. The database dispatch fence rejects a device without current notice consent, a revoked device, a wrong-project device, or an invalid relationship. The push body is rendered from canonical student, attendance date, and institution values; no SMS template participates. FCM acceptance is recorded separately from a device acknowledgement.

`ATTENDANCE_PUSH_TTL_SECONDS` defaults to `21600` (six hours) because a late attendance alert can mislead a guardian. Operators can configure 3600–86400 seconds; the same value controls pre-send freshness and the Web Push TTL header. The isolated guardian transport test uses a 300-second TTL and makes no attendance claim.

## Release and controlled trial

1. The current release instruction authorizes controlled publication of the product drafts while final institutional/legal review remains pending. The pages explicitly display that status. Deploy policy migration `00022`, guardian consent migration `00023`, and the matching app/Worker bundle as one coordinated release. Production migration preflight found `00000`–`00021` already applied; only `00022` and `00023` are pending. Keep SMS delivery disabled.
2. Verify `/privacy`, `/terms`, and `/guardian-notifications`; the standalone manifest; HTTPS; the hashed Firebase service worker; and `Service-Worker-Allowed: /` on the worker response. `scripts/check-fcm-deployment.mjs` exits nonzero if scope or manifest verification fails.
3. Run `scripts/preflight-guardian-push.mjs`. It reports eligible device counts without printing the Firebase installation identifier. The previously active test installation needs new notice consent and is therefore not suitable until re-enrolled.
4. If no suitable installation exists, create **one** new invitation for Attendance Test Guardian using the staff flow. For an iPhone/iPad Home Screen installation, the guardian can paste the same private link into the installed app if the invitation fragment is not retained during installation. Stop for the guardian's manual enrollment.
5. After enrollment, run `scripts/run-guardian-transport-test.mjs --preflight`, then `--validate`. The latter calls FCM with `validate_only` and does not display a notification.
6. Only after validation passes, run `scripts/run-guardian-transport-test.mjs --send` once. It targets one consented installation and stores the provider result and message ID in `controlled_push_tests`. The execution key prevents a second run. Have the guardian report device display separately; provider acceptance does not prove display.
7. Enable general FCM scheduling only after the controlled trial succeeds and the institution is ready for future automatic absence alerts. Do not manufacture attendance to test the route.

No provider send occurred during preparation of this flow.

## Private browser verification

After `npm run build`, run `npm run test:guardian-browser`. It starts the built app at a temporary localhost address and opens an isolated headless Chrome profile. The test verifies the public policy pages, manifest MIME type, native service worker registration with root scope, an unchecked consent box, permission requests only during a user click, denial handling, invalid invitation feedback, and pasted-link revalidation. The preview reads the build's static header rules so worker scope behavior matches the intended deployment.

Invitation context and permission denial are controlled browser fixtures. This test creates no production consent, device installation, or guardian account and sends no FCM message. Database invitation consumption and tenant isolation are covered separately by the disposable PostgreSQL tests. The browser profile, private preview process, and invitation fixture are removed when the test finishes.

These browser checks passed on 2026-10-16. A fragment-only navigation bug in the pasted invitation flow was corrected: the page now reloads with the new invitation before validating it and removing the fragment.

Public policy and guardian pages now render independently of staff authentication, including on the server. The consent query selects current accepted consent before counting eligible devices, so a preserved legacy installation without consent cannot prevent a one-device controlled trial. The attendance trial performs a Firebase validation-only request before enqueuing its single provider send.
