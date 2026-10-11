# Firebase FCM project replacement

Target project: `attendai-41f64` (number `849652695985`). The Firebase
integration confirmed this project is active and its `attendai-web` app ID is
`1:849652695985:web:8b73aa6ecf97a2f313f390`. Its public Web SDK config
was retrieved from the integration and copied into `.env.example`.

Firebase remains the push delivery provider. Supabase continues to own
attendance, auth, guardians, consent, notification jobs, and history. Migration
`00015_fcm_project_identity.sql` labels existing installations as
`siri-1b57c`, adds project-aware enrollment and refresh, and rejects old
registrations at the database dispatch fence. On refresh, an old device row
is retired and a new project row is created while keeping the old history.
The worker also selects only current-project installations.

The local `.env` now uses the verified new Web app values, and
`FCM_DELIVERY_MODE` remains `disabled`. The operator confirmed that the
configured Web Push public key exactly matches the key in the new project's
Firebase Console. The new-project Admin JSON exists outside the repository;
its project metadata and OAuth authentication were verified. The local `.env`
contains its path and a randomly generated communication worker secret. For
shell commands that do not load `.env`, set the Admin credential path first:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\Users\sindh\firebase-secrets\attendai-admin.json"
```

Do not copy the private JSON into this repository. The Admin adapter checks
the credential's `project_id` before use. Migrations `00013`–`00015` were
applied to linked development project `elebygmdftfjgecauyiq`; the guardian
installation table now responds through PostgREST. Anonymous reads of the
invitation, installation, and dispatch tables return permission denied.
Current aggregate counts: zero active old-project installations, zero active
new-project installations, and zero pending push jobs. A schema-only remote
dump was unavailable because Docker is not running; local migrations and
database behavior tests passed.

Wrangler is authenticated as `expresspotato44@gmail.com`. The disabled trial
Worker is deployed at `https://attendai.attendai-expresspotato44.workers.dev`.
The local `.env` has that origin as `ATTENDAI_APP_URL`.
The guardian and staff pages return HTTP 200. The credential upload was initially
blocked by automatic approval review as outside the trial authorization. On
2026-10-11 the operator explicitly approved the upload, and Wrangler successfully
stored the required Supabase URL/service-role key, Firebase service-account JSON
and project ID, application origin, worker secret, and provider/delivery settings
on the existing `attendai` Worker. Both SMS and FCM delivery remain `disabled`.
No CLI access tokens or Twilio credentials were included in this upload.
The server FCM adapter now uses
the documented HTTP v1 API with a signed OAuth assertion, avoiding Firebase
Admin's incompatible Node dependency on Cloudflare. Local OAuth verification,
27 communication tests, TypeScript, and the production build passed. The
deployed Worker now passes a database-backed invitation lookup: a synthetic
invalid invitation returns HTTP 200 with `valid: false`, replacing the previous
503. Unauthenticated staff API access returns 403. Real browser enrollment has
not yet been verified. Sign in to `/guardian-devices`, create an enrollment link
for the designated guardian, and open it in that guardian's browser to grant
notification permission. A token-specific validation-only dry-run then becomes
possible. A dry-run does not prove device display.

The configured trial number matches `Attendance Test Guardian`. Only
`Student One` is linked to that guardian for notifications. The student was
present on 2026-10-11; older absent records exist for 2026-10-05 and
2026-10-02. There are still no new-project installations or pending push jobs.
No real alert has been sent.

The controlled real test requires one consented guardian, one new-project
installation, current absent attendance, and one job through the normal
AttendAI pipeline. Record the provider response, stored message ID, and
separately confirm device display. Only then remove remaining old active
configuration. Keep historical installation, communication, and Twilio rows.
The old Firebase project and its credentials are not deleted automatically.

Resume verification on 2026-10-11: all 27 communication tests, TypeScript, and
the disposable PostgreSQL suite passed, including migration `00016` and its
controlled-absence regression. The regression fixture was corrected to account
for the existing trigger firing on attendance updates as well as inserts.
Migration `00016` was tested locally only during this resume; no remote database
migration or real notification was performed.
