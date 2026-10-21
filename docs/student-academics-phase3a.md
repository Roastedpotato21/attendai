# Problem #3 — Phase 3A: student import, cohorts and academic lifecycle

Implemented and locally validated. Production migrations and deployment have
not been performed. All synthetic records stay in disposable database or local
browser fixtures. No production students, guardians, attendance or messages were
created by these tests.

## Identity and academic structure

The existing `students` row is the canonical identity within an institution.
Placement changes, promotions and department/program transfers retain its UUID.
Normalized admission numbers and nonblank roll numbers are unique per institution,
including inactive students. Normalization covers Unicode compatibility forms,
case, surrounding whitespace and repeated whitespace. The same identifiers can
exist in different institutions. Names alone never merge identities.

Students record their actual admission date, admission/roll identifiers, entry
type, entry term/cohort and enrollment status. Current department, program,
term/year/semester, section and cohort come from dated `student_placements`.
Departments, programs, terms and sections reuse Phase 2A's institution-defined
structure. No degree or department names are prescribed.

Normal, lateral and transfer entry all use the actual entry point. A lateral
student may start in Year Two or any institution-defined equivalent without an
invented earlier placement. An existing student's first recorded placement can
be their known current placement; entry metadata records the actual admission
point without reconstructing unknown history.

Cohorts have a program, code, label, start date, expected end date and optional
description. Their dates and names do not calculate a student's current year.
Entry cohort remains recorded when a later placement changes program/cohort.

## CSV and Excel import

Create the academic structure and cohorts first. Open **Student Import**, provide
a specific reason and download the empty CSV header template. Select CSV or
Excel `.xlsx`; older `.xls` files must be saved as `.xlsx` or CSV first.

Files are limited to 4 MiB and 500 student rows. Excel reads the first worksheet.
Use text cells for admission/roll identifiers, especially leading zeroes; numeric
identifier cells fail explicitly. Use ISO `YYYY-MM-DD` dates and the exact term,
academic-year and section names shown on the page. Department/program/cohort
codes match the institution's existing records.

| Column                                           | Meaning                                        |
| ------------------------------------------------ | ---------------------------------------------- |
| `full_name`, `admission_number`                  | Required identity                              |
| `roll_number`                                    | Optional institution-wide unique roll          |
| `admitted_on`                                    | Actual admission date                          |
| `department_code`, `program_code`, `cohort_code` | Existing institution codes                     |
| `academic_year`, `term_name`, `section_name`     | Current placement target                       |
| `entry_type`                                     | `normal`, `lateral` or `transfer`              |
| `entry_academic_year`, `entry_term_name`         | Actual academic entry point                    |
| `starts_on`                                      | Effective start of this recorded placement     |
| `entry_year`, `current_year`                     | Optional checks against the term's year number |

CSV supports quoted commas, multiline cells, Unicode and a UTF-8 BOM. Malformed
UTF-8, duplicate/unknown headers and missing required headers fail explicitly.
Excel ZIP expansion and entry counts are bounded. Formula cells, external
relationships, macros/embedded files and XML entity declarations are rejected;
formulas are never evaluated.

Parsing does not create student identities. The server stores a durable preview
batch with filename, SHA-256, original rows, creator, reason and revision. It
independently validates references, dates, entry point, required fields and
duplicate admission/roll identifiers. The page shows valid rows, warnings,
rejections, existing students and potential duplicates.

Correct individual fields and save corrections to obtain a new revision. Resolve
duplicates explicitly:

- Skip a row, including duplicated rows in the file.
- Enroll an exact existing identity with incomplete academic metadata. Its UUID,
  name and identifiers must match; the operation never silently merges accounts.
- Acknowledge a same-name potential match only after checking it represents a
  different person. Acknowledgment cannot bypass admission/roll uniqueness.

Existing students already managed by this model use profile corrections and
placement transitions rather than another import. Choose valid rows and type
`IMPORT <selected count>`. Commit revalidates authorization, batch revision and
selected rows while holding the institution lifecycle lock. It inserts/enrolls
only selected valid rows atomically. The batch is single use; committed row
numbers and student UUIDs remain available after reload. A failure rolls back
the transaction and is reported explicitly.

Raw rows, corrections and minimal batch/audit metadata are retained in Supabase;
the original file bytes are parsed locally and are not uploaded or retained.
The recorded hash identifies the selected bytes; it does not certify that a
file's contents are authoritative.

## Placement history, moves and promotion

**Students** provides search, cohort filtering, paginated records, profiles and
placement history. Profiles show current placement, original entry point, entry
cohort, entry type and enrollment status. History records department/program,
term/year, section, cohort, dates, actor, change type and reason.

A transition closes the previous placement and appends a new one in the same
transaction. Original identity and historical scope remain. One latest placement
and nonoverlapping date ranges prevent simultaneous unrelated sections. Current
placement uses the institution timezone's current day; a scheduled academic-only
placement does not replace today's placement early.

Open **Promotion**, select source cohort and term, review students and choose
individuals. Provide the target term/section/cohort and effective date; individual
overrides support promotion, repeating, excluding or an academic break. Program
and department changes derive from actual target scope. No progression is
inferred from cohort dates. Review the saved preview and type `PROMOTE <count>`.
Changed student versions or placement IDs require a new preview. A failure in
any included operation rolls back the batch. Larger cohorts can be processed in
reviewed batches of at most 500 students.

An academic break sets the student inactive and closes/cancels applicable
placements. It is effective immediately. Explicit reactivation retains the
identity but requires a separately recorded fresh placement.

## Student status and existing roster compatibility

Supported enrollment states are active, graduated, transferred out, discontinued,
suspended and inactive; existing legacy `withdrawn` values remain readable.
Status changes require a current version and reason. Leaving closes current
placements and cancels scheduled ones without deleting the student, earlier
placement periods or attendance records. A cancelled future placement remains
visible as a scheduled row that never started. Reactivation does not revive old
placements.

Existing legacy students are not assigned invented admission dates, programs,
terms, cohorts or guardians. Administrators explicitly review and enroll their
real identity through the import preview. Existing guardian relationships and
attendance records remain attached to the same student UUID.

Migration `00037` marks existing nonnull `class_id` records as legacy roster
linked. An immediate placement transition updates that class projection to the
target section's existing class in the same transaction. A future-dated move or
promotion of these students is rejected: apply it on its effective date to
prevent a stale roster projection. Reactivation clears the previous projection
until a new placement is explicitly assigned. Academic-only imports support
future placements because they have no legacy roster projection to schedule.

New imports have no fabricated guardian, legacy class or daily attendance status.
They are omitted from the legacy guardian/attendance repository serialization
until an explicitly designed later integration exists. Phase 3A does not change
attendance submission, session handling, guardian mapping, notification delivery,
SMS providers or FCM. It does not activate new imports in those older workflows.

## Authorization and audit

The database checks live membership, verified identity, current policies,
effective roles and responsibility scope for every operation:

| Actor                             | Access                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Current Owner / Institution Admin | Import, cohorts, identity corrections and all institution academic operations |
| Class Incharge                    | Read and manage assigned current section scope                                |
| HOD                               | Read and manage assigned department scope                                     |
| Coordinator                       | Read and manage assigned program, respecting optional term and academic year  |
| Assigned Faculty                  | Read assigned teaching-section students; no academic mutation                 |
| Unrelated Faculty                 | No institution-wide student directory or academic mutation                    |

Both source and target placement scopes are checked. Status changes also check
scheduled placements they would cancel. A current program-wide coordinator can
plan upcoming terms; a coordinator restricted to one academic year cannot acquire
another year's sections. Inactive staff, stale roles, client-supplied metadata
and another institution's identifiers cannot grant access.

New tables use RLS and authenticated clients cannot write them directly. Direct
student inserts/deletes are blocked. A column guard blocks academic identity and
lifecycle changes outside the audited RPCs while preserving existing class-scoped
legacy attendance metric updates. Private internal helpers are not callable by
browser roles. Only an institution owner/admin can read full academic audits;
import batches are readable by their creator with current institution access.

Audits record import previews/commits, row corrections, cohort creation, profile
corrections, promotion, moves and status changes with actor, timestamp, reason,
old/new values and batch reference where applicable. No Auth tokens or server
credentials are stored in these records.

## Additive migrations and production prerequisites

Apply all prior migrations, including Problems #1 and #2, then:

| Migration                               | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `00037_student_academic_model.sql`      | Canonical identity constraints, cohorts, placements, import batches, audit and RLS      |
| `00038_student_academic_operations.sql` | Scoped catalog/directory/profile, cohort creation, atomic moves, status and corrections |
| `00039_student_import_promotion.sql`    | Durable validated import/promotion previews, explicit resolution and atomic commits     |

Review against a production backup using authorized migration access. Never
reset a linked database. Before migration, review existing institution-wide
admission and roll identifiers for normalized duplicates, including across
classes and inactive students. Conflicting real identifiers cause migration
failure; they are never renumbered, merged or deleted automatically. Resolve
source records through an approved institutional review before retrying.

Review actual Phase 2A program/term/section structure, then create real cohorts
and prepare admission data with accurate entry points and dates. Apply migrations
before deploying the frontend. No new environment secrets, background jobs,
provider integrations or delivery configuration are introduced. Existing Supabase
configuration remains required; missing configuration fails explicitly.

## Local validation

`npm run test:postgres` applies the full migration chain to disposable UTF-8
PostgreSQL. The real isolated Problem #1 approval creates the owner; Phase 2A/2B
and Phase 3A then run against that context with rollback-isolated fixtures.

Student database checks cover normal/lateral/transfer entry, preview without
insertion, duplicate constraints, existing identity resolution, revision checks,
cohorts, promotion exceptions, cross-program/department moves, history, status,
future cancellation, legacy projection compatibility, audit, cross-tenant
references and denied role/scope paths. They assert no guardian, attendance,
session or communication records were created by academic operations.

Unit tests parse actual isolated CSV and `.xlsx` bytes and exercise malformed or
unsafe files, identifier preservation, input bounds and import summaries. Browser
checks intercept all Supabase/API requests locally and cover profiles/history,
cohorts, import/correction/confirmation, promotion exceptions and direct URL gates.
They are not production integration tests.

Run:

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

With a local built preview and isolated hidden headless Chrome profile:

    npm run test:students-browser -- http://127.0.0.1:4191 9227
    npm run test:staff-browser -- http://127.0.0.1:4191 9227
    npm run test:auth-browser -- http://127.0.0.1:4191 9227

Production migration/deployment access and review of legacy identifiers/data
remain rollout prerequisites. No Phase 3B or attendance/guardian workflow is
included.
