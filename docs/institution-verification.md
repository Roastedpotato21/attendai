# Institution and authorized representative verification

Implementation status: locally verified, not deployed. A read-only production
check found the configured server credential works, but the application table is
absent (HTTP 404). No production accounts, tenants or evidence were created by
these tests. No production migration or deployment was performed.

## Existing flow audited: YES

The prior signup created a Supabase Auth identity and, after email verification,
called the policy-wrapped provision_my_new_institution() RPC. Its implementation
created an active institution, membership and admin role without independently
checking either institutional existence or representative authority.

The replacement reuses profiles, institutions, profile_institutions,
profile_roles, institution_admin_onboarding, policy acceptance and the existing
active-tenant membership checks. New applications create a pending institution
without a membership or role. Approval creates the initial owner atomically.
Existing active institutions remain operational. Both old provisioning RPCs fail
explicitly, including the renamed implementation; the direct bootstrap script is
retired. Staff invitation, student import and guardian communication architecture
are outside this change.

## Flow and access

1. Search the imported official registry; compare canonical name, state, type,
   AISHE code and matched sources. Similar names never auto-approve.
2. Review institution details. Unlisted institutions can request manual review.
3. Supply representative name, phone, institutional email where available,
   designation and leadership authorization. Principal, director, registrar,
   secretary and explicitly authorized representatives are supported.
4. Supply a letter on letterhead identifying applicant/designation/institution,
   AttendAI authorization, signatory/designation/date, plus recognition or
   affiliation evidence.
5. Generate a 15-minute random challenge and supply a fresh representative photo
   with its visible code and institution context. Human review is required.
6. Submit. Submission guarantees no access or approval.
7. View pending status, requests for more information, approval or rejection.

Account email verification establishes identity only. Pending users can access
their verification workflow, permitted edits/uploads, legal notices and logout.
Protected URLs redirect to verification. PostgreSQL RLS/RPC checks and existing
server role checks enforce the same restriction independently of the browser.

States: draft -> submitted -> registry_check -> pending_manual_review ->
pending_institution_confirmation -> approved. Review can request
needs_more_information or reject; approval can later be revoked. Submitted and
registry_check are audited transitions within the submission transaction.
Changes increment the application revision; accepted evidence and official
confirmations from a previous revision cannot authorize the new revision.
Changed account email also requires renewed review. Conflicting confirmations
block approval until a new revision resolves the dispute.

## Registry model and official import boundaries

institution_registry stores canonical/normalized name, type, state, city,
AISHE code, UGC and AICTE identifiers/status, official website/domain and source
update time. institution_registry_sources stores source-specific external IDs,
source URL, timestamps and import SHA-256. Search normalization covers Unicode,
punctuation, whitespace and common college/university abbreviations.

AISHE is primary. UGC/AICTE imports cross-check explicit AISHE identifiers or a
reviewed registry UUID. Imports never merge institutions by fuzzy name. Duplicate
IDs, conflicting AISHE identity, untrusted source hosts and older source updates
are rejected. Registry match and cross_checked indicate source matches, not
verified authority.

Official starting points: [AISHE directory](https://dashboard.aishe.gov.in/),
[UGC](https://www.ugc.gov.in/) and [AICTE](https://www.aicte-india.org/).
No stable official API or current approved dataset has been integrated here.
Adapters and canonical JSON/CSV imports are implemented and tested for all three
sources. Signup performs no government-page scraping. No invented production
registry rows ship with the application.

Before importing, obtain an official export, review licensing/provenance and map
its columns into these canonical fields:

| Field                                   | Requirement                                                       |
| --------------------------------------- | ----------------------------------------------------------------- |
| external_id                             | Official source identifier                                        |
| canonical_name, institution_type, state | Required                                                          |
| city                                    | Optional district/city text                                       |
| aishe_code                              | Required for AISHE; use reviewed mapping for crosschecks          |
| official_website                        | Optional HTTPS URL; domain is derived                             |
| source_url                              | HTTPS official AISHE, UGC or AICTE source URL                     |
| source_updated_at                       | Actual source update date/time, never a fabricated freshness date |
| status                                  | Source status                                                     |
| registry_id                             | Optional UUID for explicit crosscheck mapping                     |

JSON is an array of canonical records; CSV uses these exact headers and supports
quoted multiline fields. There are no bundled production imports.

Commands (validation is the default, applying is explicit):

    npm run verification:import -- aishe path/to/reviewed-canonical.csv
    npm run verification:import -- aishe path/to/reviewed-canonical.csv --apply
    npm run verification:import -- ugc path/to/reviewed-canonical.json --apply
    npm run verification:import -- aicte path/to/reviewed-canonical.json --apply

Apply requires server-only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
Review imports in batches of at most 10,000 records. A source URL allowlist checks
provenance syntax; it does not authenticate an arbitrary operator-supplied file.
Trusted operators must validate the actual official export.

## Independent reviewer and official contact confirmation

The platform reviewer role is separate from institution admin. A reviewer must
have a verified active account and current policies. Appointment is an explicit
trusted database operation, never a signup option or tenant role. After verifying
the officer's identity, an operator can appoint the exact Auth user:

    INSERT INTO public.institution_verification_reviewers
      (auth_user_id, appointment_reason)
    VALUES ('<verified-auth-user-uuid>', '<specific reviewed appointment reason>');

Do not appoint an applicant to review their own application. Self-review remains
blocked even when that person has a platform reviewer grant.

At /institution-review the officer must:

1. Independently check institutional recognition and the authorization letter.
2. Scan downloaded quarantined files using a trusted external malware scanner
   and inspect their contents in a safe environment. Explicit notes and scan/
   content attestations are required before acceptance.
3. Check the photo's fresh code, representative and institution context manually.
4. Source an official email or telephone independently from a trusted registry,
   verified official website or official directory. Record the URL, source type
   and why it is independent. Applicant/document contacts alone are insufficient.
5. Actually contact the official officer and record method, confirmer name and
   designation, time and a private reply/call evidence reference.
6. Approve with a specific reason after existence, authority, clean current
   evidence and affirmative current official confirmation all pass.

This console records real manual outbound verification. It sends no email/SMS,
and never claims a message was delivered. Official contacts, confirmation details
and internal review history are not applicant-readable, including when an
applicant also holds a reviewer grant. Applicant-facing decision reasons must
avoid exposing internal contact details.

Duplicate registry/name-and-state claims are rejected. Existing legacy active
tenants are also checked by normalized name. The applicant can file an
authorized-administrator recovery request. This records a pending request only;
it grants no access, merges no accounts and does not implement staff onboarding.
Independent reviewers must catch spelling/identity variations in manual claims;
there is deliberately no fuzzy auto-approval or automatic account merge.

## Private evidence and retention

The institution-verification Supabase bucket is private, limited to PDF/JPEG/PNG
and 5 MiB per file. A restrictive storage policy denies direct browser reads,
writes and signed-URL creation, even if another permissive storage policy exists.
A bucket trigger prevents public access and unbounded uploads. Paths use generated
institution/application/evidence UUIDs. Clients cannot choose a path or overwrite.

The server-only /api/institution-verification/evidence proxy requires a verified
bearer identity and database authorization for every upload/download/deletion.
Downloads are audited, attachments, no-store and nosniff; there are no public
document URLs. The server checks stream size, MIME and file signatures, blocks
obvious active PDF content and quarantines every upload. These checks are not a
complete malware scanner: the operational external scan/manual review is required
before acceptance. No facial recognition or biometric templates are used.

Challenges expire after 15 minutes, have one successful use, and invalidate older
unused challenges. Exact photo SHA-256 reuse is blocked across applications,
including after deletion. Transformed photographs still require human review.

Photo byte retention is 30 days from upload; document retention is 90 days.
Expired or tombstoned evidence is immediately inaccessible through the API.
Deletion first revokes access, then removes bytes and records a receipt only
after storage confirms absence. Failure reports deletion pending. Minimal audit
metadata/hash tombstones remain for replay prevention and accountability.

Configure a trusted scheduled runner, separate from communication workers:

    npm run verification:prune
    npm run verification:prune -- --apply

The default inventories only. Apply removes at most 100 due evidence objects per
run and records receipts; rerun until drained. It also removes unregistered
private objects older than an hour, left by interrupted/failed upload registration.
Schedule frequent runs and monitor failures/backlog. No scheduler is provisioned
by this repository change. Reviewers must securely dispose of downloaded copies.
Private bucket behavior follows
[Supabase private bucket documentation](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Additive migrations and rollout

Apply in order using the authorized database migration process; review against a
production backup first. Never reset a linked database.

| Migration                                    | Purpose                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 00025_institution_verification.sql           | Registry/application/evidence schema, RLS, workflow, initial owner activation, private bucket; retires legacy provisioning |
| 00026_institution_registry_imports.sql       | Atomic official-source import RPC and provenance validation                                                                |
| 00027_institution_verification_session.sql   | Verified pending/reviewer session eligibility                                                                              |
| 00028_institution_claim_recovery.sql         | Recovery request inbox without automatic access                                                                            |
| 00029_institution_verification_hardening.sql | Self-review privacy, disputed confirmation gate, orphan retention inventory                                                |

The production REST service credential cannot apply PostgreSQL DDL by itself.
A database connection or authorized migration-management access is still required.
Deploy migrations before the new frontend/server so old clients fail closed and
new routes have their RPCs. Do not roll back by enabling the old provisioning RPC.

Server evidence handling needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the
browser-safe VITE_SUPABASE_ANON_KEY. The browser needs VITE_SUPABASE_URL and
VITE_SUPABASE_ANON_KEY. Never expose server keys with a VITE_ prefix. Keep email
confirmation on and allow the /institution-verification redirect in Supabase Auth.

Production readiness also requires reviewed official datasets, independent
reviewer appointments, a trusted external file scan procedure, an actual official
contact verification process and a scheduled retention runner. Existing tenants
need a separately reviewed registry mapping if their legacy identity is ambiguous.

## Validation

- All migrations apply in disposable UTF-8 embedded PostgreSQL with isolated
  Auth/storage catalogs and synthetic fixtures; no linked reset or real sends.
- Institution workflow checks cover registry matches/crosschecks, ambiguity,
  not-found review, forged status, old-RPC bypass, pending/rejected/revoked access,
  independent authority confirmation, stale revisions, conflicting replies,
  account email changes, self-review, duplicate/recovery claims, storage policy
  bypass, private IDOR, photo expiry/replay, retention and atomic initial ownership.
- Institution unit/API tests validate adapters, CSV, upload bytes/size, quarantine,
  authorization, private downloads, registration cleanup and deletion failure.
- Browser auth checks intercept all Supabase requests with isolated fixtures.
  They cover search/manual fallback, identity-only signup, invalid credentials,
  pending login/reload, six direct protected URLs, reviewer denial, legal access
  and logout. They are not a production integration test.
- Existing auth-error, record-metric and communication/security tests remain in
  the regression run.

Run:

    npm run test:postgres
    npm run test:institutions
    npm run test:auth-errors
    npm run test:communications
    npm run test:record-metrics
    npx tsc --noEmit
    npm run lint
    npm run build
    git diff --check

For browser checks, run the built preview and a hidden headless Chrome with a
temporary profile/debugging port, then:

    node scripts/test-auth-browser.mjs http://127.0.0.1:4173 9222

The compatibility test-e2e-onboarding.mjs command now runs the disposable database
suite; it cannot create or admin-confirm synthetic production users.
