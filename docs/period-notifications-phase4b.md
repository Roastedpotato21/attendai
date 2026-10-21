# Problem #4 — Phase 4B: guardian absence alerts and corrections

Implemented locally. Production migrations and deployment have not been applied.
Tests use disposable PostgreSQL, intercepted browsers and simulated provider
responses. No production contacts, attendance, devices or provider sends are
created by validation.

## Eligibility and daily identity

Period notifications use Phase 4A sessions and Phase 3B canonical guardians.
The processor requires Final Submit, a database-clock deadline that has passed,
a non-cancelled session and a current Absent mark. Opening the register is not
required to persist a lock first. Drafts, Pending, grace-period marks, Approved
Leave, unmarked students and cancelled sessions cannot generate absence facts.

Each institution/student/local-date has at most one logical `first_absence`
event and one logical `daily_summary` event, enforced by unique indexes. Each
event has separate recipient records for every recorded active guardian
relationship. Several children of one guardian still have separate student-day
events. Later absent periods do not generate another immediate alert.

Every recipient resolves the actual canonical guardian, relationship UUID,
notification preference, channel preference and contact-version checkpoint.
Active institution/student/contact, communication consent, a currently active
dated relationship, a current-project registration, browser permission and
accepted current enrollment notice are checked independently. No registration
is recorded as unavailable; no consent or permission is invented. English is
the explicit fallback for all languages until reviewed translations are supplied.

First alerts contain the recorded student, subject, period label, date and
institution. A combined lab remains one logical attendance period. Summaries
contain the count and available subject/period labels, bounded to FCM's existing
350-character body limit. The existing accountless page retrieves the current
per-period statuses after verifying the requesting device and relationship.

## Queue, corrections and provider boundary

`period_notification_events` stores logical identity and attendance facts.
`period_notification_recipients` stores relationship/contact checkpoints and
links to existing `communications`, `communication_jobs` and
`communication_dispatches`. There is no second push transport or SMS provider.

Corrections use the institution lifecycle mutex shared by attendance and guardian
operations. A correction before dispatch cancels the stale queued recipient and
job. Dispatch authorization repeats current attendance, consent, dates, settings,
device project and contact-version checks under that mutex. The same transaction
returns the current message snapshot, preventing an earlier worker read from
rendering a superseded summary. An unsent first event can resume under its same
identity if the mark becomes Absent again; a new logical first alert is never
created. Unsent summaries are refreshed with audited old/new facts.

The dispatch fence records an external attempt as `sending` immediately before
the provider call. An external request already authorized/in flight cannot be
atomically retracted across PostgreSQL and FCM. A competing correction retains
that attempt; if its result becomes provider-accepted, completion reconciles the
current mark and queues a separate correction. Uncertain requests remain
unconfirmed and are not blindly replayed. This boundary does not promise that a
previously authorized network request can be recalled.

An accepted original is never rewritten or deleted. Corrections have a new
communication and a link to the original event, changed session and mark
revision. Only guardians with an accepted original receive its correction.
Messages identify the old reported status, new status, subject, period and date
and ask the guardian to ignore the previous period notice. Superseded unsent
corrections cannot dispatch. Repeated accepted corrections retain their history.
An accepted summary also receives corrections when its reported periods change.

Recorded full-day leave follows Phase 4A's effective scope. It cancels notices
for newly changed unsent marks and creates corrections for accepted notices.
Earlier completed periods retain their marks until explicitly corrected by the
authorized CI. No notification logic manufactures or revokes leave.

Provider acceptance and provider ID are separate from the device acknowledgment.
The UI says provider accepted, device acknowledged, queued, cancelled,
unavailable, ineligible, failed or unconfirmed according to recorded evidence.
It never infers delivery or display from successful submission to FCM.

## Summary settings, processing and TTL

Institution owners/admins can configure **Guardian attendance alerts** and a
daily-summary local time on Timetable or Period Attendance. Settings default to
disabled, with 17:00 as the initial time. Saving settings sends nothing.

The existing authenticated communication worker invokes
`process_period_notifications(100)` before processing push jobs when
`FCM_DELIVERY_MODE=live`. Each call examines at most 100 outstanding student-days;
the service-only RPC supports a bounded limit of 1–500. Run repeatedly to drain
larger backlogs. The database enforces current institution timezone and the
configured summary cutoff. A summary is generated only if locked current
absences remain. Repeated and concurrent calls reuse the same daily identities.

`wrangler.json` already declares a minute cron. This change provisions no new
scheduler and does not establish that a production cron is deployed, authenticated
or running. Verify the deployed schedule reaches the existing worker endpoint,
with `COMMUNICATION_WORKER_SECRET`, and monitor failed runs/backlogs. Missing
server database configuration fails explicitly. Each channel still reports its
own failure; SMS and push do not depend on one another succeeding.

The default `ATTENDANCE_PUSH_TTL_SECONDS` is 28,800 seconds (eight hours), with
the existing validated range of 3,600–86,400. Period events additionally expire
after eight hours: first notices from the original lock deadline, summaries
from the configured cutoff, and corrections from their creation. Expired events
cannot start new sends. FCM receives the smaller of configured TTL and remaining
event lifetime, so a retry does not restart an eight-hour delivery window.
The processor does not backfill days-old first alerts or summaries. It considers
today's first alerts and current/recent summary cutoffs only.

## Privacy, audit and rollout

The new outbox and audit tables have RLS and no browser read/write policies.
Private helpers and predecessor transport entry points are not browser-callable.
Service-only processing cannot be invoked by faculty or unrelated tenants.
The session status RPC uses current Phase 4A authority and filters merged rosters
by the caller's section. It returns student/event/type/status/time only, without
guardian IDs, contact details, installation identifiers or provider credentials.

`period_notification_audit` records event/recipient creation, ineligibility,
unavailable registrations, queueing, cancellation/resumption, summary refresh,
dispatch attempts/results, provider IDs and device acknowledgments. Attendance
events retain the actual actor, old/new mark and reason; the notification chain
links through session, student, revision, original event and relationship IDs.
No device secrets, FCM registration values or Auth credentials enter these audits.
Contact changes never retarget an existing communication or alter historical
provider records. Inactive, suspended, graduated, transferred-out and discontinued
students cannot authorize future sends.

Apply all earlier migrations, then `00047_period_notification_outbox.sql` and
`00048_period_notification_dispatch.sql` using authorized additive migration
access after reviewing a backup. Never reset a linked production database.
Deploy migrations before frontend/server and reload the PostgREST schema cache.
Existing server Supabase credentials, current Firebase project credentials,
HTTPS application URL, worker secret and live delivery gate remain required.
There are no new secrets. Keep the existing legacy daily-register cutover decision
explicit; period marks are not copied into legacy attendance or its alerts.

Staging must verify real PostgREST joins, accountless callback, current-project
FCM acceptance, device acknowledgment, summary timezone and actual scheduler
execution. These operational checks are not established by local intercepted
tests. Do not enable an institution until its real guardians, consent,
registrations, academic placements and schedules have been reviewed.

## Local validation

Run `npm run test:postgres`, `npm run test:period-notifications`, all existing
period/student/staff/institution/auth/communications/record-metrics suites,
`npx tsc --noEmit`, `npm run lint`, `npm run build` and `git diff --check`.
Browser checks use the existing period/student/staff/auth suites against a built
local preview; `npm run test:guardian-browser` uses its own isolated preview.

The database suite exercises the actual approval/staff/academic/period RPC chain,
guardian consent and accountless enrollment, then first/day deduplication,
siblings, multiple guardians, suppressed preferences, missing devices,
pending/grace/cancelled gates, corrections before and during dispatch, accepted
originals, summary retries, leave, status/contact/project/TTL gates and privacy.
Independent real connections race processors, correction versus dispatch,
duplicate provider starts and stale concurrent corrections. Unit/API tests use
simulated FCM results and verify bounded payloads, expiry, fresh snapshot rendering
and honest provider/display status. Synthetic fixtures remain isolated.

No parent login/dashboard, new SMS provider, Firebase redesign, authentication
redesign, animation work or production deployment is included. Stop at Phase 4B.
