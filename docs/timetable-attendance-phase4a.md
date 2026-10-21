# Problem #4 — Phase 4A: timetable and period attendance

Implemented and validated locally. No production migrations, deployment,
attendance, invitations or provider sends were performed. Synthetic records
remain in disposable PostgreSQL and intercepted local browser fixtures.

## Existing flow audited

The earlier `attendance_sessions` model has one whole-class session per date,
legacy Present/Absent/Late/Excused marks, class-based permissions and absence
notification triggers. It cannot represent multiple subjects/periods per date or
merged sections safely. That history and its transport integrations are retained.

The new `period_sessions` engine uses the existing institutions, academic
departments/programs/terms/sections/subjects, staff identities/responsibilities
and canonical student placements. Its marks never enter the legacy attendance
tables or communication outbox. `/period-attendance` and `/timetable` are the new
pages; `/attendance` remains the legacy whole-class register. There is no automatic
conversion of old daily sessions into invented subject periods.

## Timetable and schedule history

Owners/admins can create institution timetables. Class Incharge can manage their
assigned section. Initial merged plans require authority over all attached
sections; each merged session then has one designated owner section for
session-level cancellation, dated replacements and substitution. Other attached
sections retain their own Class Incharge correction authority.

Use **Timetable** to create:

- Weekly rules with a weekday, dated effective range and local start/end time.
- Dated extra classes, special/monthly occurrences and overrides.
- Normal periods, labs and combined periods with institution-defined labels.
- One logical session spanning several named slots, such as a combined lab.
- Dated cancellation or full-day holiday exceptions with actor and reason.

There is no fixed number of periods. A rule has one time interval and 1–30 slot
labels; merged rules attach up to 20 sections. Attached sections must use the
subject's actual program and valid term dates. The scheduled faculty needs a
real dated teaching responsibility for every attached section. Overlapping
section/faculty intervals fail explicitly. Rules are bounded to a year.

To move/swap an upcoming occurrence, select **Plan dated replacement**. This
creates a new dated rule, records an override of the original occurrence and
cancels its unfinalized generated session. A two-period swap can be recorded by
cancelling both upcoming originals, then adding their replacement occurrences
at the exchanged times. Conflict checks never silently displace another class.

Retirement stops upcoming occurrences and cancels unsubmitted future generated
sessions. It retains the original rule and prior sessions. Past/finalized plans
cannot be rewritten. Full-day holidays must be recorded before that day; for a
same-day change, cancel the specific upcoming occurrence. An attached non-owner
section cannot silently cancel an entire merged class through a holiday.

Generation captures a plan snapshot containing subject/faculty names and IDs,
section/program/term details, slot labels, timezone and actual timestamps. Later
rule edits, staff changes or dated replacements do not rewrite that snapshot.
Schedule/substitute changes are separate audited records.

## Generation and session identity

Open **Period Attendance → Generate scheduled sessions** for a reviewed date
range. Generation is idempotent and unique on timetable-rule UUID plus date.
The immutable rule identifies sections, subject and the logical period span.
Overlapping active section/faculty sessions are rejected independently of the
rule creation checks. A lab spanning several slots is one session with one
submission, not duplicated attendance for each slot.

Ranges cover at most 31 days per call, at most a year ahead, and at most 1,000
generated sessions. Generation cannot invent past timetable occurrences. An
owner/schedule CI can generate their plans; assigned current faculty can generate
their assigned rules. No background generator or scheduled task is provisioned
by this change. Institutions must generate their actual upcoming schedule before
relying on session dashboards; a missing generated occurrence is not absence.

The staff home page shows today's generated sessions in the caller's scope,
pending/grace/locked/corrected/cancelled states, scheduled faculty, substitutes,
actual submitter and submission time. The session register supports date ranges
and pagination. HOD designation alone does not expose unrelated session rosters.

## Marking authority and roster

Initial marking requires the one scheduled Subject Faculty identity with its
dated subject/section responsibility, or the explicit session substitute. A
current active verified account, membership, Faculty role and current policy
acceptance are required. HOD, Owner/Admin and Class Incharge roles alone grant
no initial marking right. HOD + assigned Faculty can mark because of teaching
assignment. Stale JWTs, enum roles and metadata cannot override live staff state.

The designated owner section's Class Incharge can assign/replace/clear a
substitute before Final Submit, with a reason. The substitute must be a verified
active same-institution Faculty with valid dated role coverage. It does not gain
a general subject assignment or authority in another session. Assignment clears
the former authority's draft and increments the session revision. The scheduled
faculty remains in the snapshot while current substitute and actual submitter
are retained separately. Concurrent substitute/original actions have one winner.

Roster capture uses the student's recorded placement as of the session date.
Future rosters are not frozen against guessed student movement. Opening an
unsubmitted session on/after its date freezes canonical IDs, placement/section
IDs, names and admission identifiers; subsequent moves do not replace that
roster. A historical placement can retain a student who later graduated.
New academic students need no fabricated guardian or old class projection.

Only Present, Absent and recorded Approved Leave are supported. There is no Late
option and no default Present/Absent selection. Save Draft can retain incomplete
marks but creates no submitted attendance. Client edits are free before Final
Submit; saving uses current authority and optimistic version checks.

## Final Submit, grace period and lock

Final Submit requires every roster student exactly once, a started session and
typed `SUBMIT <count>` confirmation. Unmarked/missing, duplicate, foreign or
forged leave records fail. The transaction inserts original marks and individual
history, records actual submitter/time, and sets the deadline to exactly five
minutes after the database-clock submission time. An empty roster cannot submit.
Existing historical pending sessions can be explicitly submitted only when the
current faculty still has valid dated marking authority; no timeout submits them.

The state transition is scheduled → pending → submitted → grace period → locked,
with corrected/cancelled states where appropriate. Submitted is recorded as an
audited transition into the grace period. Unsubmitted sessions remain Pending
after their start, even if nobody ever submits. No missing session generates marks.

Within five minutes, only the same still-authorized submitter can correct a mark.
Corrections require the old status, new status, session version, mark version and
a specific reason. The database clock enforces the deadline on every mutation.
An old browser tab cannot extend the window. A read computes the effective lock
immediately; opening a due session persists its lock event with the recorded
deadline. No cron job is necessary for permission enforcement.

After lock, only the current Class Incharge of the student's original session
section can correct that student's mark. Owner/Admin/HOD have no default bypass.
CI A in a merged A+B session sees/corrects A students; CI B sees/corrects B.
Each correction appends old/new status, actor, reason and timestamp. Original
submitted status and original submitter remain unchanged. No direct browser
update can rewrite locked marks.

## Approved Leave and raw counts

Class Incharge can record full-day leave for an actually placed student with a
reason. The schema records an explicit leave scope and application timestamp so
future half-day/period-specific support can be added deliberately. That scope is
currently restricted to full day.

Unsubmitted sessions for that date apply recorded leave at Final Submit even if
a stale faculty form says Absent. Already-submitted remaining sessions in the
same section whose time span has not finished are amended to Approved Leave,
with history and session version increments. Earlier completed sessions retain
their marks; a historical leave record requires an explicit permitted correction
for previously finalized attendance. A client cannot manufacture Approved Leave.

Recorded leave cannot accidentally be changed into an absence through a faculty
correction. Leave revocation/withdrawal and partial-day policy are outside this
phase. Cancellation records no expected attendance, no fabricated all-present or
all-absent marks and no future absence eligibility.

The engine stores raw Present, Absent, Approved Leave and unmarked counts only.
It does not decide whether leave counts toward an attendance denominator, does
not mix legacy daily attendance into period percentages, and calculates no final
attendance percentage. Institution policy can later interpret the raw records.

## Concurrency, privacy and audit

Every timetable/session mutation uses the institution lifecycle mutex and row
locks. Session and mark revisions reject stale drafts, authority changes, duplicate
Final Submit and stale corrections. Constraints enforce unique occurrences and
one mark per roster student. A real two-connection test verifies one concurrent
submission succeeds, and a substitute-vs-original race cannot grant both control.

New tables use RLS with read-only browser policies and no direct write policies.
RPCs validate tenant, live identity, role, responsibility, date, exact roster and
expected versions independently of the UI. Private helper functions are revoked
from browser roles. CI merged-session responses filter both roster and individual
mark history by section. Plan metadata can identify the other attached section
because it explains the merged session; other section student records are hidden.
No guardian phone, email, consent or device token is part of a period roster.

`period_attendance_events` records rule creation/override/retirement, holidays,
schedule/cancellation, roster freeze, substitute assignment, submission, lock,
leave and every mark correction. It records relevant session/student/rule IDs,
old/new values, actor, reason and time. Session detail shows the latest 200 allowed
events; all rows remain stored. The new feature has no outbound communication
trigger and no SMS/FCM transport change.

## Additive migrations and rollout

Apply all prior migrations, including Phase 3B, then:

| Migration                                | Purpose                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `00044_period_session_model.sql`         | Timetable rules/exceptions, immutable plan snapshots, merged sections, roster, raw marks/drafts, leave, audit and RLS |
| `00045_timetable_operations.sql`         | Scoped future rule creation, dated replacement, holidays/cancellations, retirement and idempotent generation          |
| `00046_period_attendance_operations.sql` | Exact marking/substitution, drafts, Final Submit, clock-based lock, CI corrections, leave and scoped dashboards       |

Review against a production backup and apply through authorized additive database
migration access. Never reset a linked database. Apply migrations before the new
frontend and reload the PostgREST schema cache. Existing Supabase configuration
remains required; there are no new secrets, provider settings or background jobs.

Before rollout, review real institution timezone, terms, section/subject mappings,
dated Faculty and CI assignments, canonical student placements and merged-session
owners. Create reviewed timetable rules and generate the upcoming actual dates.
Verify the browser → Supabase RPC → roster/submission flow in staging. Local
browser tests intercept requests and are not a live PostgREST integration test.
Existing legacy daily attendance remains separately accessible; decide the
institution's operational cutover without duplicating daily/period submissions.

## Local validation

All migrations apply to disposable UTF-8 PostgreSQL. The actual isolated Problem
#1 approval establishes the owner before Phase 2/3 and period workflows run with
rollback-isolated fixtures. The separate concurrency fixture is committed only
inside that disposable database so independent connections can observe it; the
entire database is stopped afterward. No linked Supabase reset or live send occurs.

Database tests exercise normal/weekly/lab/combined/extra schedules, holidays,
overrides, snapshot preservation, duplicate and overlap prevention, exact
HOD+Faculty and substitute authority, Final Submit, grace/lock, section CI
corrections, merged-section privacy, pending sessions, leave, stale roles and
cross-tenant denial. Tests change timestamps only in trusted isolated fixtures to
exercise the deadline without waiting five minutes. They assert academic period
operations create no legacy attendance, communication jobs, messages or devices.

Run:

    npm run test:postgres
    npm run test:periods
    npm run test:students
    npm run test:staff
    npm run test:institutions
    npm run test:auth-errors
    npm run test:communications
    npm run test:record-metrics
    npx tsc --noEmit
    npm run lint
    npm run build
    git diff --check

With a built local preview and isolated hidden headless Chrome profile:

    npm run test:periods-browser -- http://127.0.0.1:4191 9227
    npm run test:students-browser -- http://127.0.0.1:4191 9227
    npm run test:staff-browser -- http://127.0.0.1:4191 9227
    npm run test:auth-browser -- http://127.0.0.1:4191 9227

The standalone `npm run test:guardian-browser` checks the existing accountless
guardian page with its own local preview and hidden browser. No guardian absence,
first-absence, end-of-day or correction notification is introduced. Stop at Phase
4A; Phase 4B is outside this change.
