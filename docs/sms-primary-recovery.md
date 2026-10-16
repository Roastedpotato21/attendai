# SMS primary recovery — 2026-10-11

The provider migration and current controlled-trial outcome are recorded in
[Fast2SMS migration](fast2sms-migration.md). The following is historical Twilio
recovery evidence; Fast2SMS is now selected for new SMS.

SMS is a primary absence channel for guardians whose existing preference is SMS.
Consent and preferences are never changed to make a test pass. Supabase remains
the attendance, relationship, consent, queue, and history source of truth.

## Routing and fixes

- Migration `00017` adds the SMS enqueue trigger before the existing push trigger.
  New eligible absences create independent SMS and push communications/jobs.
  `notification_channel_settings` can disable either channel per institution;
  the default preserves push enqueueing while enabling SMS enqueueing.
- The scheduler starts SMS first and runs both processors independently. Each
  channel's exception is isolated. FCM no longer requires SMS to be disabled.
  A disabled SMS worker leaves its queue untouched.
- SMS has its own dispatch-attempt history, exact provider request body, error
  code/HTTP status, provider message ID, and signed callback status. Acceptance
  is not labeled delivered. Existing historical records are not rewritten.
- The dispatch fence checks lease ownership, tenant, active institution/student,
  guardian relationship, consent, preference, current submitted absence within
  14 days, phone validity, channel policy, prior acceptance and SMS rate limit.
  The adapter checks the recipient allowlist, template and provider configuration
  before acquiring the fence. Push devices are not part of SMS eligibility.
- `enqueue_absence_sms(..., 1)` and `claim_sms_trial_job(job_id)` support one named
  operator trial with one attempt. Existing communications, including uncertain
  attempts, prevent another envelope for the same absence/guardian. A 429 cannot
  retry a one-attempt job; general jobs retain bounded explicit-rejection retries.
- Cloudflare now has the existing Twilio credentials and recipient allowlist in
  secret storage. Public trial/callback configuration is in `wrangler.json`.
  SMS and FCM delivery remain disabled; Firebase secrets and history are retained.
- The callback now targets the permanent Worker origin, replacing the old tunnel.
  The message dashboard labels SMS as current messaging, rather than legacy-only.

## Live provider and recipient evidence

Read-only Twilio API responses on 2026-10-11:

- Account: HTTP 200, `type=Trial`, `status=active`.
- IncomingPhoneNumbers: HTTP 200, no numbers.
- OutgoingCallerIds: HTTP 200, no legacy verified caller IDs. This endpoint alone
  does not establish the newer product-trial recipient verification state.
- Messages filtered to the controlled recipient: HTTP 200, no Message resources.
- Monitor Alerts: HTTP 401, code `20003`; the original rejection's full provider
  text could not be recovered through that API. No replacement send was attempted.

Current [Twilio SMS trial documentation](https://www.twilio.com/docs/usage/trials/try-out-sms)
states that the product trial sends only to verified US numbers and requires a
predefined body identifier. Its general trial/legacy documentation differs, so
the SMS-specific trial restriction is used conservatively for this account.
The existing configured target is `+91******6753`, not a supported US target.
No usable alternative SMS adapter or configured credentials were found;
`msg91(mock)` in the repository is a mock, not a configured alternative.

Supabase confirms Attendance Test Guardian and Student One share institution
`08d80924-683d-40a8-8d79-c9f4ee64c190`. Consent and `receives_notifications` are
true, the guardian's preference is SMS, the student is active, and the submitted
2026-10-05 record is still absent. The recipient is valid E.164 and allowlisted.

## Template and history

The active English template renders exactly:

> Dear Parent, Student One was marked absent on 2026-10-05. Please contact the institution if you believe this is incorrect.

The current product-trial API body would instead be
`sms_appointment_reminders`. That predefined appointment example does not carry
the student's absence details. It is not presented as an equivalent attendance
message, and neither body was sent during this recovery.

The October 5 communication `8529906c-bc04-4041-828d-94afb5293a68` is already
`unconfirmed`; job `185d512d-2e26-4a43-a2e5-d0fbbbcd5cdb` is `dead_letter` with
one recorded provider-started attempt and no SID. It was left unchanged.
The separate October 6 attempt records HTTP 422 and provider code `572002`.
The exact provider explanation was not preserved by the old adapter; the new
adapter stores sanitized provider messages for subsequent failures.

An empty provider Message listing is useful evidence but is not used to silently
clear an uncertain dispatch or manufacture a new absence. Reconcile that attempt
with Twilio before explicitly authorizing reuse of this event. No attendance,
consent, relationship preference, or historical result was altered.

## Reproducible checks and remaining action

`node --env-file=.env scripts/audit-sms-primary.mjs` reads live eligibility,
history, and provider metadata with masked phone numbers.
`node --env-file=.env scripts/preflight-sms-trial.mjs` is read-only with respect
to data and sends no SMS; it prints each gate and exits 2 on failed preflight.
Its callback probe is deliberately unsigned and must be rejected before any
history write. A future upgraded account also requires an operator to verify
the destination/sender/geographic permissions and set the preflight-only
`SMS_PROVIDER_DESTINATION_VERIFIED=true`; that flag does not enable SMS delivery.

The application changes are ready for a provider that supports this recipient
and message semantics. The operator must upgrade/configure a suitable Twilio
route or provide credentials for an approved India-capable provider, confirm
recipient and sender eligibility and relevant registration requirements, and
reconcile the existing uncertain October 5 attempt. No accounts were created,
no upgrade was performed, and no geography permission was guessed or changed.

Validation: 29 communication tests; disposable PostgreSQL migrations and all
database/SMS flow tests, including channel isolation, no-device SMS, corrections,
consent, RLS, duplicate fencing, rate limiting and a one-attempt trial; TypeScript;
ESLint; production build; `git diff --check`. Migrations `00016` and `00017` were
applied to the linked development database without modifying existing records.

Trial outcome for this recovery: attempted **NO**, provider POST count **0**,
new duplicate sends **0**, new SID **none**, delivery **not attempted**, real
delivery callback **not received**. SMS is primary and has no FCM dependency.
Preflight must fail for the provider destination restriction and existing
uncertain dispatch; both channels remain disabled.
