# October 2 Fast2SMS read-only reconciliation

Classification: **D. NO FAST2SMS REQUEST FOUND**.

The attendance event was October 2, but the actual attempted dispatch was October 12 at `00:16:21.589891 UTC` (`05:46:21.589891 IST`). The provider query therefore covered October 11–12, not October 2.

## Verified provider evidence

- Official `POST https://www.fast2sms.com/dev/wallet`: HTTP 200, `return=true`, wallet `50.0000`, sms_count `200`.
- Official `GET https://www.fast2sms.com/dev/sms_logs?from=2026-10-11&to=2026-10-12&limit=100&page=1`: HTTP 200, `success=true`, `data=[]`.
- Pagination: total=0, count=0, current_page=1, total_pages=1, next_page_url=null. The response was not truncated.
- No request ID, route, delivery status, debit, sent/delivery time, or destination-correlated record exists in the returned history.
- No Fast2SMS error code was returned; error 999 was not observed. A wallet balance alone does not establish eligibility for a future send.

The key remained in Cloudflare Worker secret storage. It was not copied to the local environment or printed. No SMS-capable provider endpoint was called during reconciliation.

## Why the response was lost

A read-only wallet probe on the same Worker reproduced this exception immediately, with elapsedMs=0 and no HTTP response:

> TypeError: Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).

The deployed SMS adapter used the same unsupported `redirect: "error"`. Cloudflare rejected this option before outbound fetch. Its catch block discarded the exception and returned the generic ambiguous result, which was then persisted correctly as unconfirmed/dead_letter. There was no captured provider response to parse or persist.

This reproduced defect, immediate historical failure, and successful empty provider log query indicate the original attempt failed before Fast2SMS acceptance. The original exception itself was not retained. We do not invent a provider rejection event, error code, or delivery status.

Other reviewed paths: one 20-second AbortSignal timeout; one response-body read; JSON POST with the official Quick SMS URL; no automatic redirects/retries. The reproduced failure occurred before the timeout or response parsing. There is no evidence of a Worker CPU/subrequest limit failure.

## Changes and verification

- Changed provider send, delivery-report and read-only account fetches to `redirect: "manual"`; redirects are never followed.
- Read provider response text once before parsing; preserve HTTP status and sanitized body even when parsing fails.
- Capture sanitized exception, failure stage, elapsed milliseconds and response content type.
- Preserve string/numeric status codes and request IDs when returned.
- Migration `00020_fast2sms_diagnostics.sql` adds `safe_response_body` and `transport_diagnostics` to dispatches and persists them through the existing finish function without rewriting old rows.
- Authenticated `/account` diagnostics allow only wallet POST and SMS Logs GET; no arbitrary provider URL or send action.
- 40 communication tests passed, including malformed JSON, body-read/network failure evidence and read-only endpoint restrictions. All disposable PostgreSQL tests passed, including response evidence persistence and existing duplicate fences. TypeScript, lint and production build passed.
- Deployed Worker version: `edc0ffd0-f58c-47cb-b108-092f70a6091a`.

## Historical state

Communication `ff642340-83c1-4915-a00d-b24210bcf489`, job `43bfc8b8-e478-4401-adbd-c09d29643964`, and dispatch `9f47de4d-b8f7-44d0-bab2-9187f98d62c3` remain unchanged: unconfirmed/dead_letter, attempts=1/max_attempts=1, provider request ID=null. No provider event was found to reconcile into those records. This document appends the verified investigation evidence without overwriting the original result. Duplicate protection remains in force.

Next safe action: retain this evidence and obtain explicit authorization for any future controlled SMS test; do not resend automatically.

Official references: [SMS Logs](https://docs.fast2sms.com/reference/sms-analytics-api), [Fast2SMS error codes](https://docs.fast2sms.com/reference/error-code-list).
