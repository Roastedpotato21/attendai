# Problem #3 — Phase 3B: guardians and notification preferences

Implemented locally. Production migrations and deployment have not been applied.
Tests use disposable PostgreSQL, synthetic file bytes and intercepted browser
requests. They create no production contacts, accounts, invitations or messages.

Builds on the Phase 3A student model.

## Existing model and canonical identity

The existing `parents` table remains the canonical guardian identity. Its UUID
already anchors enrollment invitations, FCM installations, consent records,
communications and delivery history, so none of these are moved to another
identity table. New guardians have no Auth account, staff profile or membership.
Existing legacy account references are retained rather than reassigned/deleted.

Guardians have a name, display mobile, separately normalized international
mobile, optional email, active/inactive state, supported preferred language,
bounded private contact metadata and a contact version. Father, mother, legal
guardian and other authorized guardian are relationship types rather than
properties of the person.

Mobile numbers require an explicit `+` country code and 8–15 digits. Spaces,
parentheses, periods and hyphens are display formatting only. Local numbers never
receive an inferred country code. This validates format; it does not prove
ownership or carrier reachability. Legacy noncanonical phones remain recorded
and need explicit review/correction before reuse in the new model.

Name/mobile candidates require operator review. An exact candidate must be
selected explicitly; a matching name or phone alone never merges people. A
shared phone with a different name requires a distinct-person acknowledgment.
The same guardian can then be selected for multiple children using its UUID and
current contact version. A household can share an email; email is not a unique
person identifier. Identical names and phones in different institutions remain
separate. No automatic or destructive guardian merge operation is provided.

## Relationships, preferences and history

`student_guardian_relationships` records the institution, student, guardian,
relationship type, primary/secondary flag, receives-notifications preference,
optional channel preference, effective dates, active/ended status, revision,
actor, reason and timestamps. A student can have multiple guardians; a guardian
can have multiple students. One overlapping active primary recipient is allowed.
Secondary recipients can independently opt into or out of notifications.

Links start on/before the current institution date and can have a future cutoff.
Future starts are rejected explicitly. End Relationship records an actual cutoff
on/before today and disables future eligibility immediately. Original relationship
identity/start/type and creation details are immutable. Replacement means ending
the former relationship and adding the new reviewed guardian; no history is
deleted. Changes to primary/preference flags retain old/new audit states.

Existing `student_parents` rows are backfilled using their actual recorded
creation dates; earlier unknown history is not invented. That table remains a
compatibility projection with its existing composite key. The new model controls
eligibility independently of cached projection flags and checks actual dates.
It does not populate a new student's legacy `students.parent_id` or class link.

Keep these states separate:

| State                     | Meaning                                                    |
| ------------------------- | ---------------------------------------------------------- |
| Guardian exists           | A contact identity is recorded                             |
| Guardian linked           | A dated relationship to a student is recorded              |
| Receives notifications    | Preference for this particular student relationship        |
| Communication consent     | Existing guardian-wide consent flag, recorded separately   |
| Enrollment notice consent | Accepted/revoked accountless notification notice           |
| Browser permission/device | A particular browser installation and project registration |

Creation/import does not set consent. New communication consent requires a
separate explicit action with the actual affirmative consent or withdrawal
evidence reference. Changing a preference cannot grant consent or device
permission. Optional channel preference filters future dispatch eligibility;
it does not configure or activate any provider.

Graduation, transfer, discontinuation, suspension or inactivity preserves all
guardian history. Eligibility checks require an active student, active contact,
current active relationship and that relationship's preference. Communication
dispatch additionally checks consent, contact version and channel preference.

## Student Profile controls

Open **Students → student profile → Guardians**. Authorized staff can:

- Add a distinct guardian or search/select a reviewed existing identity.
- Review name, relationship, primary/secondary, mobile/email and effective dates.
- Change Primary, Stop Notifications or change the optional channel preference.
- End Relationship and add a replacement without reimporting the student.
- Edit contact details or record actual separate communication consent/withdrawal.

The section displays communication consent and current-project installations
with current enrollment consent separately from relationship eligibility. Zero
registered devices means zero; the page does not assume FCM enrollment. Adding
a guardian or changing preferences sends no email, SMS or push notification.

## Import integration

The Phase 3A student CSV/Excel flow accepts these optional columns:

    guardian_name,guardian_relationship,guardian_mobile,guardian_email,
    guardian_is_primary,guardian_receives_notifications,guardian_language,
    guardian_effective_from,guardian_effective_until,guardian_id,
    guardian_distinct_acknowledged

Use `mother`, `father`, `guardian` (legal guardian) or `other`. Boolean cells use
literal `true` or `false`; omitted primary and notification flags default false.
Language supports `en`, `hi`, `te`, `ta`, `kn`, with English as the default.
Guardian start can use the student's placement start when omitted, provided it
is on/before today. No guardian fields means no guardian creation. Partial
guardian identity data fails validation.

For multiple guardians or existing students, select **Student Import → Import
type → Guardian relationships for existing students**. Download its separate
empty template: `admission_number` identifies the existing student and the
guardian columns above describe each relationship. Guardian name, relationship,
mobile and effective-from headers are required. Several rows can reference the
same student. Creating a new student is never part of this mode.

Use Text cells for mobiles and identifiers in `.xlsx`, and explicit international
mobiles in CSV. The existing file bounds, literal-value restrictions and first
worksheet rule still apply. Shared new guardians repeated in a file require
resolution: import one first, then explicitly select its ID in the other rows.
Existing guardian email conflicts must be reviewed separately rather than
silently overwriting the canonical contact.

Both modes preview errors, candidate guardians and consent warnings before any
identity/link insertion. Row corrections produce a new revision. Selected valid
rows require typed `IMPORT <count>` confirmation. Commits revalidate current
student/contact versions, references, duplicates, primary conflicts and authority
under the institution lifecycle lock. Student creation plus optional guardian
links is atomic; a guardian failure rolls back the student import as well.
The original import implementation is private and cannot bypass guardian checks.

Files are parsed locally; raw file bytes are not uploaded. Private original rows,
corrections, hashes and committed results remain in creator/admin-protected
Supabase batches. No production sample guardians or student data are bundled.

## Contact changes and channel compatibility

A mobile or active-state change increments contact version, records old/new
contact details and revokes pending enrollment invitations, existing installations
and accepted enrollment consents. Communication consent is cleared for renewed
review. A cookie for a revoked device cannot refresh it. Fresh enrollment requires
a fresh invitation, real communication consent, notice consent and browser
permission. Formatting changes that preserve the normalized destination do not
pretend the person acquired a different phone.

No past communication, provider ID, delivery status, stored recipient or dispatch
history is rewritten. Communication records carry a contact-version checkpoint;
queued work for a previous version cannot retarget the updated contact even
after new consent is recorded. The checkpoint added to existing rows reflects
the migration boundary, not a claim to know an unrecorded historical recipient.

Accountless FCM enrollment keeps the existing guardian UUID, installation/cookie
flow, notice version and Firebase project fence. Old-project registrations do
not become eligible for the current project. No Firebase transport, token
generation, provider or delivery-report architecture is redesigned.

`guardian_current_relationships` is a server compatibility view over existing
links with live eligibility filtering. It retains PostgREST's student foreign-key
columns for the existing enrollment queries. Deployment must validate those view
joins in staging after schema-cache reload. Existing push/SMS dispatch gates add
current relationship/version checks; they do not create alerts or enable sends.
View joins follow [PostgREST's view embedding rules](https://docs.postgrest.org/en/v13/references/api/resource_embedding.html#foreign-key-joins-on-views).
Future SMS can resolve student → current eligible relationship → canonical mobile
without changing the guardian identity model.

## Authorization, privacy and audit

Owner/Admin can manage institution-wide contacts. HOD, Coordinator and Class
Incharge use their current Phase 3A department/program/year/section scopes.
Ordinary assigned Faculty receive no guardian contact payload; unrelated Faculty
cannot enumerate contacts or use guardian mutation/search RPCs. Contact edits
and guardian-wide consent changes require authority over all currently linked
children, including other departments. Scoped staff can still change their own
student's relationship preference without changing the shared identity.

RLS independently restricts contacts, relationship rows, legacy projections and
historical communication bodies/recipient snapshots.
Direct browser writes/deletes cannot bypass audited RPCs. New contact tables
have no public policies. Private helpers and predecessor import/dispatch entry
points are revoked from browser roles. Legacy roster serializers tolerate an
RLS-hidden guardian without dropping the student or inventing contact values.
Attendance marking, sessions and submission logic are unchanged.

`guardian_mapping_audit` records actor, student, guardian, action, old/new state,
reason and timestamp. It covers creation/linking, primary/preference changes,
contact edits, consent decisions and endings. Full audit/contact metadata is
restricted to institution administrators. Browser/profile responses do not
contain device secrets, invitation hashes or Auth tokens. Do not copy contact
details into application logs; import/audit data stays in restricted Supabase.

## Rollout and validation

Apply all previous migrations, including Phase 3A, then:

| Migration                                  | Purpose                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `00040_guardian_relationship_model.sql`    | Canonical contact extensions, dated relationships, privacy, audit and version checkpoint |
| `00041_guardian_mapping_operations.sql`    | Scoped profile/search/link/contact/preference/consent operations                         |
| `00042_guardian_imports.sql`               | Optional student guardian import and separate relationship import                        |
| `00043_guardian_channel_compatibility.sql` | Current-link view and eligibility gates for existing enrollment/dispatch                 |

Review against a production backup using authorized additive migration access.
Never reset a linked database. Review actual legacy guardian duplicates, local
phone formats, relationship dates and any old account references before rollout.
Existing duplicates are retained for review; no automatic merge deletes them.
Apply migrations and reload the PostgREST schema cache before deploying the app.
Verify view/student joins and an actual accountless callback on staging. Existing
Supabase, HTTPS application URL and Firebase configuration remain required; no
new secrets or scheduler are introduced.

Run the disposable migration/workflow suite, student/guardian parser and security
tests, and all existing regression suites:

    npm run test:postgres
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

    npm run test:students-browser -- http://127.0.0.1:4191 9227
    npm run test:staff-browser -- http://127.0.0.1:4191 9227
    npm run test:auth-browser -- http://127.0.0.1:4191 9227
    npm run test:guardian-browser -- http://127.0.0.1:4191 9227

Tests cover sibling reuse, multiple guardians, primary/secondary and per-child
preferences, reviewed duplicates/shared phones/emails, CSV/Excel optional and
guardian-only input, preview/correction, existing-student edits, contact changes,
retained history, status eligibility, no guardian Auth identity, real isolated
enrollment RPCs, project fencing, stale snapshots, cross-tenant denial and faculty
privacy. Browser fixtures make no provider calls. These are local checks; the
production migration and staging integration prerequisites remain outstanding.

This phase introduces no attendance alerts, parent login/dashboard, SMS provider,
period attendance, daily summaries or correction notifications. Stop at Phase 3B.
