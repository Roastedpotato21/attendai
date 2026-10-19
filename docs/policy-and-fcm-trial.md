# AttendAI policy and FCM rollout

## Production consent release on 2026-10-19

- The current task authorizes Android/Chrome guardian enrollment and one isolated guardian transport test. The previous task's restrictions on transport tests below are historical. Attendance testing is deferred; no attendance event is created or reused.
- Deployed the mobile consent, staff enrollment QR, foreground system notification, and explicit test receipt confirmation changes to the existing production Worker. Cloudflare version: `3d3dcb19-ce74-4207-8dfa-fbd77dbcb6a0`.
- Both automatic delivery modes were explicitly set to `disabled` before deployment. Production settings and secrets were preserved by deploying with `--keep-vars`.
- Production checks passed for `/privacy`, `/terms`, guardian page, standalone manifest, root service-worker scope, JavaScript content type, and `Service-Worker-Allowed: /`. The isolated Chrome consent/worker test also passed against production with fixture invitation responses.
- Local checks passed: 58 communication/security tests, TypeScript, ESLint, production build, isolated Chrome, and the disposable PostgreSQL suite through migration `00023`. Firebase server authentication passed without a notification send.
- A one-use invitation was created for the user to open on their Android phone and personally accept notification consent. The latest device preflight still reports zero suitable consented devices. The controlled transport test is not reserved and no notification has been sent. Actual phone enrollment and receipt remain pending human action; provider acceptance and display are not claimed.
- See `guardian-fcm-consent.md` for the enrollment and one-test verification procedure, including the new read-only `--status` command. Invitation capabilities and device identifiers must not be committed.

## Verification on 2026-10-16

### Later verification on 2026-10-16

- The production policy check now passes: both active policy rows are version `2026-10-15.1`, and `/privacy` and `/terms` return HTTP 200 with the expected content. The earlier 404 and missing-migration observations below describe an earlier deployment state.
- The production FCM deployment check now passes: the guardian page and manifest return HTTP 200, the client requests root service-worker scope, and the worker returns HTTP 200 with `Service-Worker-Allowed: /` and a JavaScript content type. The earlier missing-manifest and worker-header observations below describe an earlier deployment state.
- Local verification passed again: 53 communication tests, 5 auth error tests, the disposable PostgreSQL suite through migration `00023`, TypeScript, ESLint, the production build, and `git diff --check`.
- The live guardian device and attendance preflight could not be completed in this session because automatic approval review rejected the network command as potentially able to dispatch a sensitive attendance alert. The command's source was inspected and contains no send path without `--invite`, but the rejection was honored. No invitation or FCM send was attempted. Production guardian consent records and suitable device count therefore remain unverified here.
- This task authorizes at most one attendance push and one offline/reconnect test push. The guardian transport test and online test scripts are alternatives for other separately authorized trials; do not run their `--send` modes during this task.

- Local validation passed: 53 communication tests, 5 auth error tests, the disposable PostgreSQL suite through migration `00023`, TypeScript, ESLint, and the production build. The policy migration gates interventions and escalations for staff who have not accepted the current version. Migration `00023` adds independent versioned guardian notification consent and requires it before push dispatch.
- Private browser verification passed: both policy pages, manifest, native worker root scope, initially unchecked consent, direct-click permission timing, denial, invalid invitations, and pasted-link revalidation. Context and denial used fixtures; no production consent or FCM send was created. The temporary browser profile, invitation fixture, and private preview were removed afterward.
- Read-only remote preflight found one historical guardian device in Firebase project `attendai-41f64`, two historical submitted absences for Student One, and no prior push communication for those events. The tightened controlled attendance preflight rejects both old events. The historical device will need fresh guardian notification consent after migration `00023` before it can receive any new push.
- Remote policy deployment check failed: the policy migration is not visible and both `/privacy` and `/terms` return HTTP 404. The local route files are absent from `HEAD`, which explains why a deployment of the committed branch cannot serve them. The checker exits nonzero in this state.
- The production guardian page returns HTTP 200, but its manifest returns 404, its route bundle does not request root scope, and its service worker response lacks `Service-Worker-Allowed: /`. The FCM deployment checker exits nonzero. The current local build includes the manifest, requests root scope, and includes the header rule.
- Firebase service-account authentication for project `attendai-41f64` passed. Guardian validation-only preflight stopped before any FCM message call because the versioned guardian consent records are unavailable in production. No FCM validation message or real notification was sent.
- The institution has not formally approved the Terms or Privacy Policy. The current instruction authorizes deployment as product drafts pending final institutional/legal review; the policy pages display that status. The live database migration dry-run selects only `00022` and `00023`. Verify the released pages and worker before enrolling the existing guardian phone and attempting the single controlled push.
- The offline/reconnect trial requires the enrolled device owner to confirm the device is offline immediately before sending the single test notification.

## Policy release

Apply `00022_policy_acceptance.sql` and `00023_guardian_notification_consent.sql` before serving the new application bundle. The first creates independent versioned staff acceptance records, a current-version check, and database guards for attendance RPCs and staff business tables. The second creates guardian notification consent history and a send fence. Neither changes guardian `communication_consent` or `receives_notifications`. Publish matching `/privacy` and `/terms` content before activating a new database policy version. The public contact text directs privacy, support, and data requests to the institution administrator; `VITE_POLICY_CONTACT` can replace it when an official address is configured. Governing law remains subject to the institution agreement.

Current Terms and Privacy version: `2026-10-15.1`. A later required version must deactivate the prior active row, insert the new active row, and ship matching page content in the same release. Historical acceptances remain intact.

## Push behavior

Attendance alerts use FCM Web Push for project `attendai-41f64`. The Web Push `TTL` header is `21600` seconds (six hours): an old absence alert is more likely to be misleading, and FCM's four-week default is unsuitable. The separate offline/reconnect test uses `300` seconds. FCM may retain an undeliverable message during the TTL and deliver it on reconnection; there is no delivery while the device has no internet. An FCM message ID proves provider acceptance only. A device acknowledgement is recorded separately when the foreground page shows the message or the recipient opens the notification page.

The guardian service worker is registered at origin scope `/`. The hashed worker asset receives `Service-Worker-Allowed: /` from `public/_headers`. Verify that header on the deployed worker URL and confirm the root scope in browser DevTools. The click URL carries only a communication ID. The guardian page rechecks the current attendance status through the device-scoped endpoint, so a correction is not presented as a still-current absence.

## Controlled trials

1. Deploy both migrations and the matching application/Worker. Keep general `FCM_DELIVERY_MODE` disabled during the controlled trial so the scheduled worker cannot drain other pending push jobs.
2. Generate exactly one short-lived link for Attendance Test Guardian and wait for human enrollment on one device. Verify one current-project installation and a current consent record before attempting a provider call.
3. Run the attendance preflight and send through `scripts/run-controlled-attendance-push.mjs` only if a fresh, legitimate Student One absence meets every check. It prints the exact alert before sending. If no safe event exists, do not fabricate or reuse an old absence; stop the attendance trial. Do not rerun a send with an uncertain outcome.
4. Observe foreground/background/browser-closed display on the one enrolled test device, where the browser supports it. Record human observation separately from provider acceptance.
5. Only after the online attendance trial is proven and the tester confirms that same device is offline, run `node --env-file-if-exists=.env scripts/run-offline-push-test.mjs --confirmed-offline`. This sends one clearly labeled test notification unrelated to attendance and records its provider result. The fixed execution key prevents reuse. Ask the tester to reconnect within five minutes, then verify display and acknowledgement. If it does not arrive, investigate without resending.

No SMS transport is part of these trials.
