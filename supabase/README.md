# AttendAI Supabase foundation

This directory is the only database foundation introduced in Phase 2. The UI
is not coupled to a service role key; browser code uses the public URL and
anon key from `.env`.

## Configure a project

1. Copy `.env.example` to `.env` and add the project's public URL and anon key.
   `VITE_DATA_MODE=supabase` makes missing connection configuration fail visibly.
2. Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
3. Authenticate the CLI and link the project:

   ```powershell
   supabase login
   supabase link --project-ref <project-ref>
   ```

4. Apply versioned migrations to the linked project:

   ```powershell
   supabase db push
   ```

`supabase db push` applies `migrations/` without resetting the remote database.
Never use a linked reset against production.

For a local disposable development database, Docker must be running:

```powershell
supabase start
supabase db reset
supabase test db
```

Automatic seeding is disabled and `seed.sql` contains no data. The isolated
`npm run test:postgres` command explicitly loads `tests/fixtures.sql` into a
disposable database. Never load that fixture file into production. Existing
SQL tests that need those fixtures should run through that command.

After a linked migration, run `verification/verify_phase_2.sql` through a
read-only-capable PostgreSQL session to verify the actual catalog. Run
`verification/verify_seed.sql` only in the seeded development environment.

## Foundation scope

The migrations create profiles linked to `auth.users`, roles and role
assignments, academic entities, attendance, communications, interventions,
escalations, audit logs, indexes, integrity constraints, timestamp triggers,
and RLS policies. The auth trigger only provisions the profile row after a
Supabase Auth user exists; it does not add an application sign-in flow.

Profiles and role definitions are global. `profile_institutions` is the
protected source of tenant membership, and `profile_roles` assigns one or more
roles inside a specific membership. Signup metadata cannot create either one.
All operational records carry an `institution_id`; composite foreign keys and
validation triggers prevent cross-institution relationships even when a
service process bypasses RLS. Browser access is then narrowed by membership,
role, and faculty/class assignment policies.

## Staff provisioning flow

Phase 2A adds institution setup and the staff model through migrations 00030–00033.
Use [the setup guide](../docs/institution-setup-phase2a.md) for the current staff
invitation and role/assignment workflow. Invitations generate private links for
manual delivery and do not report email delivery. Legacy staff write endpoints
are retired.

New institutions begin with registry search at `/create-account`. Email
verification creates only an applicant identity. The seven-step
`/institution-verification` workflow requires independently reviewed existence,
authority documents, a fresh photo challenge and official-contact confirmation.
Only an independent platform reviewer can activate the institution and its
initial owner atomically. Pending applicants receive no tenant membership or role.

Migrations `00025` through `00029` disable both legacy institution-provisioning
RPCs. The direct admin bootstrap script is retired; there is no public or
internal bootstrap HTTP endpoint. Existing active tenants remain active.
See [institution verification operations](../docs/institution-verification.md)
for registry imports, reviewer appointment, private storage and retention.

Add the deployed `/institution-verification` and `/accept-invite` URLs to
Supabase Auth's Redirect URLs list. Keep email confirmation enabled.

Once signed in, the owner/admin can use **Institution Setup → Staff**. The server
checks current owner/admin authority, generates a private Auth/account invitation
link and records a pending institution invitation. The recipient verifies their
email, accepts policies and finishes `/accept-invite` with the separate one-use
institution token. Only then do the membership and assigned roles become active.

Add the deployed `/accept-invite` URL to Supabase Auth's Redirect URLs list.
Never put `SUPABASE_SERVICE_ROLE_KEY` in a
`VITE_` environment variable.

`00005_phase_2_multi_tenancy.sql` is a forward migration. Because every schema
before it represented one institution, it deterministically backfills existing
Phase-2 rows into the fixed legacy institution before making tenant keys
required. Review and rename that legacy institution after migration if the
development project already contains real fixture data.

Synthetic data belongs only in isolated tests (`supabase/tests/fixtures.sql`);
the production seed contains no synthetic institution records.

Phase 2B migrations `00034`–`00036` add atomic ownership transfer, staff lifecycle,
dated handover, access revocation and independently reviewed emergency succession.
Apply after Phase 2A and before the frontend. See
[ownership and staff lifecycle operations](../docs/institution-setup-phase2b.md).

Phase 3A migrations `00037`–`00039` add student cohorts, dated placements,
validated CSV/Excel import batches, promotion and academic status lifecycle.
Review normalized institution-wide admission and roll duplicates before applying;
conflicts fail explicitly. See
[student academic operations](../docs/student-academics-phase3a.md).

Phase 3B migrations `00040`–`00043` retain guardian IDs while adding dated
relationships, scoped contact privacy, reviewed guardian imports and compatibility
eligibility gates. Apply before deploying the app and reload the PostgREST schema
cache. See [guardian mapping operations](../docs/guardian-mapping-phase3b.md).

Problem #4 Phase 4A migrations `00044`–`00046` add timetable-driven period
sessions, merged-section rosters, strict faculty/substitute authority, timed
locking and Class Incharge corrections. They create no notification jobs.
See [period attendance operations](../docs/timetable-attendance-phase4a.md).

`tests/fixtures.sql` contains two institutions with deliberately overlapping class,
admission, and employee identifiers. `tests/database/phase_2_tenant_isolation.sql`
exercises cross-tenant RLS and relationship attacks transactionally.
