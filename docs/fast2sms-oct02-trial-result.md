# Controlled Fast2SMS trial result

The single authorized real provider attempt used Student One's existing October 2, 2026 absence, for Attendance Test Guardian (`+91******6753`). October 5 was excluded and unchanged.

The earlier October 2 envelope was failed with a cancelled job, zero attempts, no provider-start timestamp, no provider ID and no dispatch. The live preflight verified current absence, tenant and guardian relationship, consent, notification preference, valid allowlisted phone, template, rate limit and duplicate protection. It passed before sending.

Exact body:

> Dear Parent, Student One was marked absent on 2026-10-02. Please contact the institution if you believe this is incorrect.

- Provider/route: Fast2SMS Quick SMS (`q`).
- Request started: `2026-10-12T00:16:21.589891Z`.
- Result persisted: `2026-10-12T00:16:21.728381Z`.
- Communication: `ff642340-83c1-4915-a00d-b24210bcf489`.
- Job: `43bfc8b8-e478-4401-adbd-c09d29643964`.
- Dispatch: `9f47de4d-b8f7-44d0-bab2-9187f98d62c3`.
- Attempts/max attempts: 1/1; retries: 0.
- Provider HTTP status/code/request ID: none captured.
- Provider acceptance: unknown; delivery: unknown.
- Persisted state: communication/dispatch `unconfirmed`, provider status `unknown`, job `dead_letter`.
- `submitted_at` remains null because acceptance was not established; the attempt timestamp is preserved separately.

The adapter's exception path produced "Fast2SMS outcome unknown; manual reconciliation required". The underlying exception was not retained, so these records do not establish whether the provider received the request. Do not infer rejection or resend.

The delivery-report endpoint returned HTTP 409, "No accepted Fast2SMS dispatch". The official request-specific DLR API cannot be queried without a provider request ID. No delivery claim is made.

A subsequent read-only preflight returned HTTP 409 with duplicateProtection=false. No second provider attempt, Twilio request, FCM call, or second recipient was used. Scheduled SMS remains disabled. October 2 now requires provider reconciliation before any replacement can be considered.

Validation: 38 communication tests, all disposable PostgreSQL suites including safe_sms_trial.sql, TypeScript, lint and production build passed. Migration 00019 applied; Worker version `c3f40452-3c7f-4654-b578-08a9caa9e56f` deployed.

Final verdict: **BLOCKED — provider outcome unknown; no request ID available for delivery reconciliation.**

Subsequent read-only investigation: [October 2 reconciliation](fast2sms-oct02-reconciliation.md) records successful wallet authentication, empty official SMS logs, and the reproduced Cloudflare redirect-mode failure. This original attempt report is preserved as historical evidence.
