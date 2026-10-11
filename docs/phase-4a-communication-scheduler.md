# Phase 4A communication scheduler

## Runtime and scheduler

AttendAI builds as a TanStack Start application through Nitro's
`cloudflare-module` preset. The production artifact is a Cloudflare Worker, so
the communication scheduler uses a native Cloudflare Cron Trigger. No separate
scheduler vendor or continuously running process is required.

`wrangler.json` configures `* * * * *`, the platform-supported one-minute
cadence. Nitro's `cloudflare:scheduled` hook makes one in-process `POST` request
to `/api/internal/communications/process`. The request carries the worker
secret in the `Authorization: Bearer` header, never in the URL. Each invocation
claims one bounded batch and then exits.

The batch defaults to 20 and is configurable through
`COMMUNICATION_WORKER_BATCH_SIZE`; values are clamped to a maximum of 50. Jobs
inside a batch execute concurrently, and each provider request has a 20-second
timeout. There is no polling loop. PostgreSQL `SKIP LOCKED`, lease ownership,
the 15-minute stale-lease window, and `max_attempts` remain the source of truth
for overlap and retry safety.

## Required server configuration

Set these names as Cloudflare Worker secrets or server variables. Never prefix
them with `VITE_`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COMMUNICATION_WORKER_SECRET`
- `COMMUNICATION_WORKER_BATCH_SIZE` (optional; default `20`, maximum `50`)
- `SMS_DELIVERY_MODE` (`disabled` by default; use `simulate` for local verification)
- `SMS_LIVE_RECIPIENT_ALLOWLIST` (comma-separated E.164 numbers; required for `live`)
- `SMS_INDIA_DLT_READY` (`true` only after sender and template registration is verified)
- `TWILIO_TRIAL_MODE` (`false` by default; when `true`, live SMS uses Twilio's fixed
  `Body=sms_appointment_reminders` trial template identifier and omits `From`)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `TWILIO_WHATSAPP_FROM`
- `TWILIO_WEBHOOK_PUBLIC_URL`
- `TWILIO_WHATSAPP_CONTENT_SID_EN`
- `TWILIO_WHATSAPP_CONTENT_SID_HI`
- `TWILIO_WHATSAPP_CONTENT_SID_TE`
- `TWILIO_WHATSAPP_CONTENT_SID_TA`
- `TWILIO_WHATSAPP_CONTENT_SID_KN`

The cadence is deployment configuration in `wrangler.json`, not an environment
variable. Change it there only if operations explicitly chooses another
Cloudflare-supported cron expression.

## Safe local verification

The communication suite replaces all provider network calls and exercises the
authenticated scheduler path, including an absence job, invalid-token
rejection, bounded batch processing, an empty queue, provider classifications,
and a database outage:

```powershell
npm run test:communications
```

The PostgreSQL suite starts a disposable embedded database, applies all
migrations and seed data, runs the Phase 2 RLS suites, submits an absence,
verifies the outbox, and tests concurrent claims, terminal jobs, stale-lease
recovery, retries, and an empty queue:

```powershell
npm run test:postgres
```

Neither command uses `.env`, and neither can send SMS or WhatsApp messages.

The PostgreSQL suite also exercises a complete disposable SMS flow: faculty
attendance submission, outbox creation, worker claim, simulated provider call,
signed callback verification, persisted delivery status, consent revocation,
rate limiting, tenant template RLS, and uncertain-outcome handling. The
simulated provider never calls Twilio.

## SMS templates and live delivery

Migration `00012_sms_delivery.sql` adds tenant-scoped SMS templates and the
dispatch fence. A template must be active, match the institution and event,
and include approved `student_name` and `attendance_date` variables. The worker
selects the guardian's current language, then an English template in the same
institution if the preferred language has no active template. A missing
template blocks delivery. Template content is rendered and validated on the
server before delivery.

Configured Twilio credentials alone do not enable SMS. `SMS_DELIVERY_MODE`
must be `live`, the normalized recipient must be in
`SMS_LIVE_RECIPIENT_ALLOWLIST`. Normal production SMS to India additionally
requires `SMS_INDIA_DLT_READY=true`; the fixed Twilio trial template path is
exempt. The worker checks guardian consent and notification
eligibility again after claiming a job. If a provider request may have been
accepted but its outcome is unknown, the job is left for manual reconciliation
instead of an automatic resend.

For a verified Twilio SMS trial recipient, `TWILIO_TRIAL_MODE=true` switches only
the live provider payload to Twilio's `sms_appointment_reminders` Body identifier.
The normal institution template is still selected and validated. The recipient
allowlist, consent and attendance checks, dispatch fence, and signed callback
remain required. The stored communication body is the actual Body submitted to
Twilio, while `template_id` identifies the intended AttendAI template. Leave
`TWILIO_TRIAL_MODE=false` for normal custom SMS. The trial request uses `To`,
`Body`, and `StatusCallback`; Twilio selects its trial sender.
Twilio's [India SMS guidelines](https://www.twilio.com/en-us/guidelines/in/sms)
distinguish international traffic, which needs no DLT registration, from
domestic traffic, which does.

Before one authorized live test, an operator must apply migrations through
`00012` to the intended project, create and activate a reviewed template for
the institution, confirm the recipient's own consent and notification
preference, verify sender registration, configure the HTTPS callback and worker
secrets, then allowlist only that recipient and enable `live`. Keep the worker
disabled until those checks are complete. No migration or live SMS is performed
by this repository test suite.

## Deployment handoff

No cloud deployment is performed by Phase 4A. An authorized operator must:

1. Select or create the intended Cloudflare Workers project/account.
2. Configure the server-side variables and secrets listed above.
3. Apply all unapplied migrations through `00012` to the intended Supabase project.
4. Deploy the prebuilt Worker with the generated Wrangler configuration (for
   example, `npx nitro deploy --prebuilt`) after verifying the selected account.
5. Confirm in Cloudflare that the `* * * * *` Cron Trigger is attached, then
   inspect one run's structured log counts.

Cloud login, project selection, secret creation, migration push, and deployment
are intentionally left to the authorized operator.
