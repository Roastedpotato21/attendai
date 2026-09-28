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

## Deployment handoff

No cloud deployment is performed by Phase 4A. An authorized operator must:

1. Select or create the intended Cloudflare Workers project/account.
2. Configure the server-side variables and secrets listed above.
3. Apply migrations `00006` and `00007` to the intended Supabase project.
4. Deploy the prebuilt Worker with the generated Wrangler configuration (for
   example, `npx nitro deploy --prebuilt`) after verifying the selected account.
5. Confirm in Cloudflare that the `* * * * *` Cron Trigger is attached, then
   inspect one run's structured log counts.

Cloud login, project selection, secret creation, migration push, and deployment
are intentionally left to the authorized operator.
