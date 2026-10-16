# Dedicated Fast2SMS transport test

The one explicitly authorized transport test was run on 2026-10-12. It used a
separate protected Worker path and `sms_transport_tests`; it created no
attendance communication, job, or SMS dispatch. Migration `00021` was applied,
and Worker version `d226ab1f-72e7-4ff7-860e-3bb73b5d8c83` was deployed.

## Preflight

- Guardian: Attendance Test Guardian; institution: `vits` (active).
- Recipient: `+91******6753`; allowlist, consent, notification relationship,
  phone format, one-test rate limit, idempotency and provider configuration all
  passed.
- Provider: Fast2SMS, Quick SMS route `q`.
- Message: `AttendAI SMS test. No attendance action is required.`
- Attendance: not queried or modified. Twilio and FCM: not used.

## Single provider request

- Test record: `dec57d4e-a375-45f4-b8bd-42d9c3220268`.
- Request count: 1; no retry.
- Request started: `2026-10-12T00:47:52.305244Z` (06:17:52 IST).
- Fast2SMS HTTP status: **400**; provider error code: **999**.
- Safe provider response: `You need to complete one transaction of 100 INR or more before using API route.`
- Provider request ID: none; no ID stored.
- Provider acceptance: unknown; the API response did not contain a request ID or an explicit `return` field.
- Delivery: unknown; there is no request ID for the official DLR lookup.
- Persisted test state: `unconfirmed`, request count 1, status code/body stored,
  `submitted_at` null.
- Twilio requests: 0. FCM requests: 0. Attendance changes: none.

The result is a **Fast2SMS provider account blocker**. Do not retry this execution
key. The table rate-limits tests to one per recipient per 24 hours and the
durable reservation makes this execution key single-use even if the Worker loses
its response. Any future test requires a separate authorization and execution
key after the provider account restriction is resolved.

The internal command is `node --env-file=.env scripts/run-dedicated-sms-test.mjs
<preflight|send|inspect>`. It only accepts a fixed execution key and resolves
the recipient server-side. Never pass a recipient or API key on the command line.
