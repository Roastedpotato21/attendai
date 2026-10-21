# Problem #2 — Phase 2B: ownership and staff lifecycle

Implemented locally; production migrations and deployment have not been applied.
Tests use disposable PostgreSQL and intercepted local browser fixtures. They
create no production identities, memberships, recovery cases or messages.

Phase 2A remains the staff and academic model. This phase adds lifecycle
operations without student imports, cohorts, guardian mapping, attendance
sessions or student promotion.

## Ownership and secondary administrators

Open **Staff → Owner-only controls**. Only the current verified owner with an
active membership and current policies can initiate a normal transfer. Select
an already verified, active same-institution staff identity; review name, email
and designation; provide a specific reason; type `TRANSFER <exact email>`.
The database validates these conditions again and compares the expected current
owner while holding the institution lifecycle lock. It changes the owner link
and records the previous/new owner in one transaction. Concurrent stale requests
fail. Client metadata and the Institution Admin role cannot appoint an owner.

The previous owner loses owner capability immediately. Explicit independent
staff roles remain effective until changed or closed; ownership-derived legacy
admin permissions are removed. The original verification application and
representative record are retained. An owner with no other grants may lose
staff portal access after transfer, which is expected. Ownership does not
silently become an admin role.

Multiple Institution Admins can manage Phase 2A setup/staff. Only the owner can
add/remove the admin role or change succession settings. A recorded successor
nominee is advisory and grants no privilege. Transferring ownership clears the
previous owner's nomination. Independent platform approval is the explicit
exception for emergency recovery/leadership authority; ordinary admins cannot
approve those actions.

## Staff state, deactivation and handover

Staff retain their existing identity and record through `active`, `on_leave`,
`inactive` and `left_institution`; draft/invited states remain supported. Select
the person in Staff to see current and scheduled responsibilities, scopes,
dates and active roles before changing state.

Every unexpired teaching, Class Incharge, HOD, Coordinator or additional
department duty requires an explicit decision: close it or transfer it to a
verified active successor with the matching dated role. Future duties must also
be resolved. An admin grant requires the owner's explicit closure. Existing
whole-class faculty mappings are listed separately and require explicit closure;
the application never invents a subject or term to transfer them.

State changes atomically close current grants, resolve duties, invalidate
pending invitations and disable the institution membership. They retain Auth
identities, profiles, staff records, attendance actions, old role/assignment
rows and audit history. The current owner cannot enter leave/inactive/left
states until ownership has transferred through the normal or reviewed route.

All RLS membership and privileged RPC checks inspect live database state,
including when a caller still holds an older valid JWT. A stale enum admin row
or mistakenly active membership cannot override an inactive staff record. The
browser refreshes staff access on focus and every 30 seconds; database denial
is immediate. Authentication credentials can remain valid for other institution
memberships and verification requests. They cannot authorize the deactivated
workspace. Supabase documents the distinction between JWT lifetime and database
authorization in [sessions](https://supabase.com/docs/guides/auth/sessions) and
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Reactivation is an explicit owner/admin operation against the original verified
email/account and current policy acceptance. It appends selected fresh role
grants. It does not revive closed responsibilities, superseded invitations or
legacy mappings. Roles and duties can subsequently be assigned through the
existing Phase 2A forms.

## Dates, leave and academic rollover

Original assignment scope, contractual dates, reason and creation actor are
immutable. `ended_on` records the actual inclusive cutoff and `end_reason`
records its explanation. Cancelling a future duty uses the day before its start.
Role changes close previous grants and append new rows; no historical role is
rewritten. Audit rows retain both states.

For previously closed Phase 2A rows, migration `00034` derives the cutoff from
the recorded closure timestamp in the institution timezone, bounded by the
original contractual dates. The original dates remain unchanged. Exclusive
assignment checks include closed history, preventing conflicting backdated
holders.

A dated transition can end one holder on May 30 and start the successor on May 31. Class Incharge duties cannot overlap for the same section. Owners may enable
one HOD per department; enabling this rejects existing overlapping duties.
Multiple HODs remain allowed by default to preserve Phase 2A institutions until
their owner explicitly adopts the stricter rule. Teaching and Coordinator duties
can have multiple holders. The institution lifecycle mutex serializes scope
claims and changes so concurrent requests cannot silently create exclusive
overlaps. A historical-date lookup returns the actual recorded duty holders
regardless of their current employment state.

Temporary leave uses a restricted-access policy: institutional membership and
roles close during leave. Each duty can be closed, transferred permanently, or
covered by a dated substitute followed by a separately recorded resumption for
the original person. `substitution_for_id`/`handover_from_id` preserve provenance
for future substitute-session work. No Problem #4 session workflow is implemented.

Leave does not expire into automatic access. Explicit reactivation requires
the recorded leave period to have finished. Early return is deliberately
rejected while the leave window is open, preventing competing substitute and
returning-staff access. Temporary substitution cannot extend past the original
assignment cutoff. A substitute's role must cover its complete assignment.

The completed-term rollover action closes only that institution's expired
term-scoped assignments. Staff identities carry forward. Administrators define
the next term/classes/subjects and append new assignments with Phase 2A tools.
Current terms cannot be bulk-expired through this action. No student promotion
or automatic subject/section mapping takes place.

## Emergency recovery and principal/registrar replacement

Use **Your staff profile → Authority review / emergency ownership recovery**,
or the same request form on Institution verification after signing in to a
verified account. Choose emergency ownership recovery or leadership replacement
and the intended owner/admin capability. An external successor can enter the
exact registered name, state and type; ambiguous or missing matches fail.
Requests are limited to three per applicant in 30 days and one open request per
institution/person. No public registry claim or email request grants ownership.

Existing active staff can apply directly. A verified external successor can
create a draft staff record, without membership or roles, so recovery also works
when no other active staff remain. Existing invited identities must finish their
invitation first. Inactive/left identities can be considered for explicit manual
authority reactivation. Student-linked or unverified identities are ineligible.

Recovery reuses the actual Problem #1 private upload proxy, quarantined evidence,
fresh challenge photo, revision-bound evidence acceptance, independent official
contact sourcing, recorded real outbound confirmation, disputed-reply checks,
privacy and retention. It requires a currently approved institutional existence
record. Recovery evidence never replaces the original representative application.

An independent platform reviewer, with no recorded membership in the target
institution, must inspect current clean evidence, establish successor authority
and obtain an affirmative current official reply. Applicant/self-review and
institution admin approval are blocked. Changed owner, candidate record, account
email, policy acceptance, disputed replies or stale evidence fail approval.
Requests older than 30 days require a new case.

Approval atomically activates/enrolls an external or inactive verified successor
when necessary, closes stale grants, and then transfers ownership or adds the
reviewed admin capability. It records the actor, target, previous/new state,
reason and timestamp. Rejection leaves institutional ownership/status unchanged.
The previous leader's profile, designation and verification history remain;
approved new leadership designation belongs to the successor's own staff record.
Approved recovery cannot be reversed by rolling the old representative back in:
subsequent ownership changes require a fresh authorized transfer/recovery.

Applicants can see their request/evidence/status. Tenant admins receive status
summaries. Reviewer contacts, reply references and internal review notes retain
the existing private reviewer restrictions. The console records manual outreach;
it sends no messages and makes no delivery claim. Old lightweight administrator
claim requests remain an intake inbox and grant no authority by themselves.

## Audit and rollout

`staff_lifecycle_events` records explicit lifecycle actions with actor, target,
previous/new values, reason and time. Existing `staff_setup_audit` still captures
row changes; verification events/reviews retain evidence and confirmation steps.
Ordinary staff cannot enumerate private lifecycle audits. The management page
shows the latest 100 events; full rows remain in Supabase. No private document
bytes or Auth tokens are copied into lifecycle events.

Apply all earlier migrations, including Problem #1 and Phase 2A, then:

| Migration                            | Purpose                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `00034_staff_lifecycle.sql`          | States, immutable history cutoffs, handovers, owner/admin controls, leave, rollover and audit |
| `00035_staff_lifecycle_access.sql`   | Current membership/status/cutoff checks and retired legacy mapping authorization              |
| `00036_staff_authority_recovery.sql` | Separate recovery/replacement applications using existing evidence and independent review     |

Use an authorized migration connection after reviewing a production backup and
actual legacy staff metadata. Never reset a linked database. Deploy migrations
before the new frontend. No new secrets are introduced: existing browser public
keys and server-only evidence credentials remain required and outside Git.

Production prerequisites remain: migration/deployment access, actual verified
institution mappings, independent reviewer appointments, trusted external file
scans, a real official-confirmation process and the existing evidence-retention
runner. Legacy institutions lacking an approved Problem #1 existence record
need reviewed mapping/verification before emergency authority approval. This
change provisions neither those operational appointments nor a scheduler.

## Local verification

The disposable database suite first approves a real isolated Problem #1 workflow
to create the owner, runs Phase 2A, then tests Phase 2B. Recovery tests register
quarantined private storage fixtures, perform evidence review and record actual
simulated official confirmations through the real RPC chain; they do not forge
approval flags. Browser fixtures intercept all Supabase/API traffic locally.

Run:

    npm run test:postgres
    npm run test:staff
    npm run test:institutions
    npm run test:auth-errors
    npm run test:communications
    npm run test:record-metrics
    npx tsc --noEmit
    npm run lint
    npm run build
    git diff --check

With the built local preview and an isolated hidden headless Chrome profile:

    npm run test:staff-browser -- http://127.0.0.1:4187 9222
    npm run test:auth-browser -- http://127.0.0.1:4187 9222

Tests cover transfers, secondary admins, role transitions, exclusive dated
handover, leave/substitutes, mandatory duty decisions, deactivation/reactivation,
owner exit protection, pending invitation revocation, historical lookup, rollover,
fresh independent recovery, external successors, principal replacement,
cross-tenant denial, immutable history and stale-token/membership/role denial.
