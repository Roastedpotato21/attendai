# Fast2SMS migration and controlled trial

Fast2SMS is the selected provider for new SMS in the deployed Worker. SMS is
primary; FCM remains an independent secondary channel. Migration `00018` is
applied to AttendAI project `elebygmdftfjgecauyiq`. Worker version:
`311e776e-7aa8-449f-8def-69cfde4989e6`.

Delivery remains disabled and `SMS_CONTROLLED_ONLY=true` prevents the scheduler
from consuming the SMS queue. This preserves the one-request authorization while
the duplicate-delivery blocker is unresolved. No Fast2SMS dispatch was created.

## Official API contract

- [Quick SMS POST](https://docs.fast2sms.com/reference/quick-sms-post):
  `POST https://www.fast2sms.com/dev/bulkV2`, Authorization header, JSON fields
  `route=q`, `numbers` (one Indian 10-digit mobile), `message` (rendered template),
  `sms_details=1`, and `udf1` (communication ID). No DLT route, redirects or retries.
- [Provider response documentation](https://www.fast2sms.com/help/bulk-sms-api-india/):
  acceptance requires `return=true` and a nonempty `request_id`.
- [Delivery reports](https://docs.fast2sms.com/reference/fetch-delivery-reports):
  authenticated `GET /dev/dlr/{REQUEST_ID}`. The official example has `success`,
  `data[].request_id`, `data[].route`, and `delivery_status[]` with `mobile` and
  `status`. Both request and recipient must match before status is applied.

`FAST2SMS_API_KEY` was verified by secret name and a protected runtime presence
check. Its value was never retrieved, copied or printed. Browser artifacts were
checked for the secret binding and provider endpoint; neither appears there.

## Implementation

The server-only `SmsProvider` contract selects `Fast2SmsProvider` by default.
`TwilioProvider` rejects new SMS without a network call. Existing Twilio
WhatsApp support, signature validation and historical callbacks are retained.
Callbacks cannot claim a Fast2SMS communication via a supplied communication ID.

The existing dispatch fence still verifies lease ownership, tenant, consent,
guardian relationship, active student/institution, current submitted absence,
rate limit, template and phone. One dispatch per job attempt is durable before
the POST. Explicit API rejection is terminal. Timeout, malformed acceptance or
server error is unconfirmed and never automatically resent.

Fast2SMS `request_id` is stored in `provider_message_id` on both communication
and SMS dispatch. Dispatches record `submitted_at`, HTTP status, provider code,
failure details and `provider_status`. Accepted dispatches are `submitted`;
communication `queued` with a request ID means provider accepted, not delivered.
Only the authenticated delivery report can mark delivery.

The protected POST endpoints use the existing Worker bearer credential:

- `/api/internal/communications/fast2sms/readiness`: presence/configuration only.
- `/api/internal/communications/fast2sms/report`: body `{ "communicationId": "<id>" }`;
  performs one official GET, then persists an idempotent report. It cannot send SMS.

Polling was chosen, so no manual Fast2SMS webhook dashboard configuration is
required. The public Twilio callback remains solely for legacy records.

## Live preflight and blocker

Run `node --env-file=.env scripts/preflight-fast2sms.mjs`. It reads live state,
renders the real template, checks deployed configuration, and never sends.

Verified: Attendance Test Guardian and Student One remain in the same tenant;
consent and receives-notifications are true; Student One is active and the
submitted October 5, 2026 attendance remains absent. The allowlisted recipient
is `+91******6753`; it normalizes to a valid Indian mobile. Rate limit passes.

Exact rendered message (122 characters):

> Dear Parent, Student One was marked absent on 2026-10-05. Please contact the institution if you believe this is incorrect.

**DUPLICATE SAFETY BLOCKER:** October 5 communication
`8529906c-bc04-4041-828d-94afb5293a68` remains `unconfirmed`. Its job
`185d512d-2e26-4a43-a2e5-d0fbbbcd5cdb` is `dead_letter`, with one attempt and
`provider_request_started_at=2026-10-05T08:48:39.844877+00:00`. No message ID or
definitive rejection was recorded. There is no historical `sms_dispatches` row
because that attempt predates the dispatch table.

The HTTP 422 / Twilio code 572002 belongs to the **October 6** communication
`3cbb5b73-f04b-44e5-b6cd-c60c7c016f70`. It cannot reconcile October 5. The current
Twilio Message query is empty, but that alone is not proof of non-delivery.
No historical rows were reclassified, overwritten or deleted. No replacement
exception was added to event idempotency while this uncertainty remains.

Provider-side evidence definitively resolving the October 5 request is required
before a replacement can be authorized by preflight. Changing providers or
enabling delivery cannot resolve this condition.

## Validation and outcome

- 37 communication tests passed, including 9 Fast2SMS-specific tests.
- Disposable PostgreSQL: all migrations and eight database suites passed,
  including Fast2SMS report ingestion, duplicate/tenant fences and SMS flow tests.
- TypeScript, ESLint, production build and `git diff --check` passed.
- Linked migration and Worker deployment succeeded. Runtime secret: PRESENT.
- Deployed homepage: HTTP 200; unauthenticated report endpoint: HTTP 401.
- Preflight: FAILED (duplicate safety; live delivery intentionally disabled).
- Real Fast2SMS requests: 0. Twilio send requests: 0. Duplicate requests: 0.
- Provider acceptance: not attempted. New request ID: none.
- Delivery/report: not attempted. FCM involvement: none.

Final verdict: **BLOCKED — October 5 Twilio outcome cannot be ruled out.**

## Reconciliation follow-up — October 12, 2026 (Asia/Kolkata)

`node --env-file=.env scripts/reconcile-twilio-evidence.mjs` now collects
read-only evidence without printing credentials or the recipient's full number.
The October 12 follow-up verified:

- Account identity matches the configured account; HTTP 200, active Trial.
- Recipient Message list: HTTP 200, empty, no additional pages.
- Outbound SMS usage for October 5–7: HTTP 200, count `0`, usage `0` segments,
  no additional pages. This corroborates non-delivery, but is an aggregate rather
  than a deterministic rejection for the original request.
- October 5 request alerts (08:40–09:10 UTC): HTTP 401, code `20003`.
- Audit events since October 5: HTTP 401, code `20003`.
- Both Monitor APIs explicitly report: “This feature is not available on a Trial
  account. Please upgrade your account to gain access.” This is a provider account
  restriction, not a failed local network connection.
- No callback events or historical SMS dispatch row exist for October 5.
- Historical communication/job remain `unconfirmed` / `dead_letter`.
- Live Fast2SMS preflight still verifies the secret and all attendance/consent
  gates, but fails duplicate safety. No provider send was attempted.

The original request requires proof that the old request was rejected before
carrier submission. The accessible evidence does not establish that fact.
No account upgrade or historical reclassification was performed.

An unsent [Twilio support request](twilio-oct5-reconciliation-request.md) identifies
the exact event and required evidence. The account owner can submit it through
the authenticated Twilio Console. No support message has been sent by this tool.
