# October 5 Twilio investigation

Investigated October 12, 2026 (Asia/Kolkata). Read-only provider and database
queries; no SMS, account setting changes, data reclassification or deployment.

## Target and identifiers

- Student One / Attendance Test Guardian, recipient `+91******6753`.
- Attendance date: October 5, 2026.
- Communication: `8529906c-bc04-4041-828d-94afb5293a68`.
- Job: `185d512d-2e26-4a43-a2e5-d0fbbbcd5cdb`.
- Request marked started: `2026-10-05T08:48:39.844877Z`.
- Job completed: `2026-10-05T08:48:42.119552Z`.
- Communication status: `unconfirmed`; job: `dead_letter`; attempts: `1`.
- Provider message ID and provider event ID: NULL.
- Error: `Twilio outcome unknown; manual reconciliation required`.
- No dispatch row, callback event or related audit record exists.
- Job payload contains only the communication ID. Communication metadata contains
  the attendance session/date, language and purpose, with no provider request ID.
- Stored body is only `Attendance absence notification.`; the exact October 5
  outbound API body and sender were not preserved. Current sender configuration
  exists but is not treated as proof of the historical request's sender.

## Provider evidence

Existing server credentials authenticated successfully for account, Message and
Usage resources. The account is active Trial and matches the configured account.

| Read-only source | Result |
|---|---|
| Entire account Message list, unfiltered (includes unsent records) | HTTP 200, zero messages, no further pages |
| Recipient Message list | HTTP 200, zero messages, no further pages |
| Outbound SMS usage October 5–7 | HTTP 200, count 0, usage 0 segments |
| Monitor Alerts, October 5 08:40–09:10 UTC | HTTP 401 / 20003: unavailable on Trial account |
| Monitor Events since October 5 | HTTP 401 / 20003: unavailable on Trial account |
| Existing October 5 BulkExport message archive | HTTP 401 / 20003: unavailable on Trial account |
| Legacy October 5 Notifications resource | HTTP 404 / 20404: resource not found |

The investigation API errors above do **not** describe the original SMS request.
The October 6 HTTP 422 / 572002 was excluded from October 5 classification.

## Application and Cloudflare evidence

- Database audit events in the October 5 08:40–09:10 UTC window: zero.
- Searched 33 task log/JSON files under the ignored `.tmp` directory. No matching
  October 5 communication/job/request identifiers, provider HTTP response or SID
  were found. The retained application stdout/stderr files start October 6.
- Local Wrangler command logs start October 11.
- Cloudflare's Worker API reports the current `attendai` Worker was created
  `2026-10-11T11:34:30.313993Z`, after the historical attempt.
- Current Worker settings: observability NULL, Logpush false.
- Historical telemetry query was attempted with `dry=true` (non-persisting) and
  returned HTTP 403 / 10000 with the existing Wrangler session. No permissions
  were changed. The current Worker did not exist on October 5 in any case.

## Classification

**UNRESOLVED**

Message SID: **NONE recorded/found** (not proof none was ever created).
Provider status, original provider error code and original provider response:
**NONE available**. Carrier submission possible: **UNKNOWN**. Delivery possible:
**UNKNOWN**. Safe for October 5 Fast2SMS replacement: **NO**.

The empty account Message list and zero usage support non-delivery, but no
request-level rejection or immutable evidence establishing non-acceptance was
recoverable. Twilio permits deletion of Message resources, so absence from its
current list is not conclusive on its own. Relevant official references:
[Message retention/deletion](https://help.twilio.com/articles/223181008-Twilio-SMS-message-and-traffic-storage),
[Monitor Alerts](https://www.twilio.com/docs/usage/monitor-alert), and
[existing daily archives](https://www.twilio.com/docs/usage/bulkexport/day).

**MANUAL TWILIO VERIFICATION REQUIRED:** Retrieve a correlated Debugger/support
record for October 5 at 08:48:39 UTC, including original HTTP/error response and
request/alert ID, or the Message SID and its final carrier/delivery outcome.
An explicit confirmation that no Message was created or no carrier submission
occurred can resolve the uncertainty. No credentials or verification codes
should be shared. The [support request draft](twilio-oct5-reconciliation-request.md)
contains the precise identifiers and remains unsent.

Reusable scripts: `scripts/reconcile-twilio-evidence.mjs` and
`scripts/investigate-oct5-cloudflare.mjs`. Neither sends SMS or modifies live data.
