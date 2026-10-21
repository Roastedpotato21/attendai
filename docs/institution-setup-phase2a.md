# Problem #2 — Phase 2A: institution setup and staff model

This document describes the Phase 2A baseline. Ownership and lifecycle extensions
are documented in [Phase 2B](institution-setup-phase2b.md).

Status: implemented and locally validated. Production migrations and deployment
have not been performed. No production staff identities or invitation links were
created by the tests.

Scope stops at Phase 2A. There are no ownership-transfer, principal replacement,
staff-exit/deactivation, emergency recovery or responsibility-transfer workflows.
There are no student imports or subject attendance session changes.

## Existing model audited

The existing profiles/Auth identities, institution memberships and verified
owner link are retained. The old faculty table mixes descriptive designation
with a small enum and uses whole-class faculty mappings. The old staff API also
contains lifecycle controls that do not belong in this phase.

The new model keeps these separate:

| Concern                                                     | Source                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| Verified person/account                                     | Supabase Auth and profiles                               |
| Tenant membership                                           | profile_institutions                                     |
| Institution Owner                                           | institutions.owner_profile_id from approved verification |
| Staff contact, employee ID, primary department, designation | staff_records                                            |
| Broad system roles                                          | staff_role_grants                                        |
| Academic responsibilities, additional departments and dates | staff_responsibilities                                   |
| Previous values, actor and change reason                    | staff_setup_audit and retained history rows              |

An Institution Owner is derived from the verified owner link. Owner is not an
assignable checkbox or a client metadata claim. Institution Admin, Faculty,
Class Incharge, HOD, Coordinator and Staff can be combined without creating
compound roles. A designation such as Professor or HOD grants no permissions.

## Institution profile

The owner/admin can configure official address, city, state where not fixed by
verification, institution type where not fixed by verification, academic year,
IANA timezone, official contact email/phone, HTTPS website, display branding and
brand color. The institution name remains the recognized identity and is read
only. The RPC rejects forged identity edits independently of the form.

PNG/JPEG logos are stored in Supabase as bounded image bytes, up to 256 KiB.
Both the database and UI validate the size/type; the database checks the image
signature. SVG/HTML and arbitrary external logo URLs are not accepted. Access is
limited to institution members, and image bytes are omitted from audit history.
Display branding does not change the institution's verified name.

## Academic structure

The institution defines its own departments, programs/courses, years/semesters/
terms, sections and subjects. No department or degree names are hardcoded.

    Institution
      -> Department
         -> Program / Course
            -> Academic year + dated Year / Semester / Term
               -> Section
            -> Subjects

A section has a stable link to the existing classes table. Subjects belong to a
program; teaching responsibilities explicitly associate a subject, section and
term. Composite tenant foreign keys and database scope validation reject
cross-tenant references, mismatched programs/terms/subjects and invalid dates.

Create departments first, then programs, terms, sections and subjects. Annual
and semester-based programs can coexist. Term names and optional year numbers
are institution-defined.

## Roles, scope and dates

A staff record is unique within an institution by normalized email, employee ID
when present, and linked person. Additional departments and cross-department
teaching use responsibilities on the same staff record.

Responsibilities include:

- Additional department membership.
- Subject faculty: subject + section + academic term.
- Class Incharge: section + academic term/year.
- HOD: department.
- Coordinator: program, optionally restricted to a particular year/term.

Each responsibility has effective dates, an active/closed state, author and
reason. Ending one responsibility retains its original dates and history.
Role changes close old grants and append new grants; they do not delete history.
Staff deactivation and exit handover are outside this phase.

The permission helpers combine active membership, active roles, matching
responsibilities, tenant/program/section/subject scope and effective dates:

| Predicate                                               | Meaning                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| can_mark_assigned_subject(section, subject, term, date) | Current Faculty role plus the exact dated teaching assignment  |
| can_manage_assigned_section(section, date)              | Current Class Incharge role plus that dated section assignment |
| can_oversee_department(department, date)                | Current HOD role plus that dated department assignment         |
| can_coordinate_program(program, term, date)             | Current Coordinator role plus matching program/year/term scope |

Omitted dates use the institution timezone's current day. HOD + Faculty +
Class Incharge + Coordinator produces the union of valid scopes. HOD alone
does not authorize subject attendance; a Class Incharge role alone does not
authorize another section.

These predicates model subject-specific permissions. New teaching assignments
do not authorize the old whole-class attendance submission RPC: that RPC has no
subject context. A subject-session attendance UI/rewrite is deliberately absent.

## Existing staff upgrade

Migration 00033 imports existing active memberships from actual profiles,
system role assignments and faculty records. It preserves recorded names,
emails and descriptive faculty designations. It does not infer HOD permissions
from a descriptive HOD designation.

Missing employee IDs remain null. Missing designations display Not recorded.
No missing program, subject or term is fabricated. Existing department names
are reused when unambiguous; otherwise the imported department uses its actual
source name and a stable import-prefixed code for administrator review.
Original role assignment actors are retained where recorded; unknown migration
actors remain system/database rather than being attributed to the staff member.

Existing explicit class_faculty mappings remain usable by their assigned active
faculty. The staff dashboard lists those real mappings separately for later
subject/term review. They never grant access to an unrelated class or invent a
teaching subject. Legacy pending invitations can finish their previous verified
acceptance flow and then receive the new model.

Once a person uses the new model, a stale legacy enum role cannot override the
new dated role grants. The existing notification admin API reads effective
owner/admin grants through a server-only database authorization function.
Notification scheduling, transport, device handling and delivery architecture
are unchanged.

## Staff invitations

Use Staff -> Add staff:

1. Personal details.
2. Primary department.
3. Descriptive designation.
4. System roles.
5. Dated subject/class and other responsibilities.
6. Review and generate invitation.

Creating the record does not activate membership. The invitation endpoint
validates the caller's identity and owner/admin capability before accessing
Supabase Auth admin APIs. Existing identities use an account verification link;
new identities use an Auth invitation link. It never creates a second person
for additional responsibilities.

The implementation uses Supabase
[generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink),
which prepares links for a separate delivery process. This phase provides a
private link for manual delivery and reports link_generated. It does not send
email or claim delivery. The private link is shown in the current page state;
it is not put in localStorage, audit records or production logs.

A separate 256-bit random institution invitation token is bound to the staff
record, institution, intended Auth user and email. Only its SHA-256 hash is
stored in Supabase. Institution invitation validity is seven days; the embedded
Auth verification link can expire sooner according to Supabase configuration.
Generating a replacement invalidates the prior institution invitation.

Acceptance requires the same verified email/account, current policy acceptance,
an active institution, pending membership, an unexpired token and no previous
acceptance. A new-style invitation cannot be activated through the old no-token
RPC. The callback removes the institution token from the address bar and clears
its temporary sessionStorage value after successful acceptance or logout.

The old staff invitation/management endpoints return 410 rather than bypassing
the new role model or exposing deactivation controls.

## Pages and dashboards

| Page                 | Access                                   |
| -------------------- | ---------------------------------------- |
| /institution-profile | Owner/Admin                              |
| /departments         | Owner/Admin                              |
| /programs            | Owner/Admin                              |
| /staff               | Owner/Admin                              |
| /staff-assignments   | Owner/Admin                              |
| /staff-profile       | Own active staff profile                 |
| /                    | Scoped staff dashboard for the new model |

Staff see their name, designation, primary department, active roles, subjects,
sections, dates and HOD/coordinator/incharge responsibilities. HOD and coordinator
overviews show only structural counts within their assigned scope. There are no
invented institution metrics or institution-wide queries in an ordinary staff
dashboard.

Owners/admins get institution setup controls. Staff with multiple active
institution memberships can select their workspace; the server validates every
institution independently. Ordinary staff cannot open setup/admin pages through
a direct URL or call privileged mutation RPCs.

RLS limits staff directory and role/responsibility reads to the person or their
institution's owner/admin. Ordinary staff cannot enumerate institution identities,
private setup audits, cross-tenant staff or another person's role grants. Public
signup metadata never grants staff membership or roles.

## Additive migrations

Apply all previous migrations, including Problem #1, before these:

| Migration                               | Purpose                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 00030_institution_setup_staff_model.sql | Settings, academic hierarchy, staff records, dated roles/responsibilities, audit, owner initialization and RLS |
| 00031_institution_setup_operations.sql  | Validated profile/logo, academic creation, staff/profile/role/assignment RPCs and invitation acceptance        |
| 00032_staff_scoped_access.sql           | Scoped capability checks, workspace/auth resolution and legacy bypass guards                                   |
| 00033_existing_staff_upgrade.sql        | Existing staff upgrade, explicit legacy class compatibility and effective server admin authorization           |

Never reset a linked production database. Review actual legacy emails,
memberships, department names and duplicate identifiers before applying the
upgrade. Invalid source data fails explicitly rather than being deleted or
silently replaced. Apply migrations before deploying the frontend/server.

The invitation server needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
VITE_SUPABASE_ANON_KEY and ATTENDAI_APP_URL. Browser configuration remains the
public VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Keep server credentials
unprefixed by VITE_ and outside Git.

Configure Supabase Auth to allow the application's /accept-invite redirect,
including its staff_invitation query parameter, and keep email confirmation
enabled. Validate the actual callback on staging. Private links must be delivered
only to the intended person through a trusted channel.

## Validation and operational status

All fixtures are isolated from production. The database suite applies the full
migration chain to disposable UTF-8 PostgreSQL with Auth/storage test catalogs.
It verifies actual Problem #1 approval creates the owner, then exercises Phase
2A against that owner.

Checks cover initial owner capabilities, fixed institution identity, bounded
logo formats, flexible program structure, designation without permission,
multiple roles, dated scopes, HOD/Faculty combinations, section-specific
incharge, cross-department teaching, duplicate emails/IDs, invitation expiry/
reuse/wrong identity, self-join rejection, cross-tenant access, role-change audit,
historical assignments, existing staff upgrade and effective server roles.

The API/unit tests exercise authorization before Auth generation, bounded
requests, hashed private tokens, generated-link status, existing identity reuse,
failure handling and retired endpoint rejection. Browser tests use local
Supabase/API responses to exercise the six-step UI, owner profile, scoped
dashboard, direct URL gates and invitation acceptance. They create no production
Auth users or messages.

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

With a local built preview and isolated headless Chrome profile:

    npm run test:staff-browser -- http://127.0.0.1:4173 9222
    npm run test:auth-browser -- http://127.0.0.1:4173 9222

Production remains unapplied. Remaining setup is authorized database migration/
deployment access, server environment and Auth redirect configuration, review of
imported legacy staff metadata and actual manual delivery of generated private
invitations. Problem #1 operational prerequisites still apply before a new
institution can become active. No Phase 2B or Problem #3 work is included.
