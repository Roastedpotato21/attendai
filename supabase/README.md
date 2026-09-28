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

The local reset applies all migrations and then loads `seed.sql`. The database
tests use a transaction and roll their fixtures back. Before loading seed data
into a remote project, independently confirm that the linked project is a
dedicated development environment; do not seed production.

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

New institutions use the public **Create an administrator account** link on
`/login`. Supabase Auth creates the identity and sends its verification email;
after verification, the `provision_my_new_institution()` RPC atomically creates
one institution, the caller's active membership, and the caller's `admin` role.
The RPC accepts no role or institution input, rejects student identities and
existing memberships, and is idempotent only for the original first admin.

Add the deployed `/create-account` URL to Supabase Auth's Redirect URLs list
alongside `/accept-invite`. Keep email confirmation enabled for the intended
verify-before-provisioning flow.

AttendAI uses Supabase Auth invitations rather than administrator-created
passwords. First provision one trusted administrator through the protected
`POST /api/internal/bootstrap-admin` endpoint. The request requires the
server-only `ATTENDAI_BOOTSTRAP_SECRET`; it sends an invitation and links the
Auth user to the supplied institution with the `admin` role.

Once signed in, that administrator can use **Faculty & Classes → Invite
staff**. The server verifies the caller's active institution-admin assignment,
sends a Supabase Auth invite, and records the recipient's active membership
and `faculty` or `staff` role. The recipient verifies their email, chooses an
AttendAI password at `/accept-invite`, and reaches the dashboard only after
the same membership and role validation used at password login succeeds.

Add the deployed `/accept-invite` URL to Supabase Auth's Redirect URLs list.
Never put `SUPABASE_SERVICE_ROLE_KEY` or `ATTENDAI_BOOTSTRAP_SECRET` in a
`VITE_` environment variable.

`00005_phase_2_multi_tenancy.sql` is a forward migration. Because every schema
before it represented one institution, it deterministically backfills existing
Phase-2 rows into the fixed legacy institution before making tenant keys
required. Review and rename that legacy institution after migration if the
development project already contains real fixture data.

The fixture data is historical sample data only. It performs no communication,
AI, QR, reporting, or automation action.

`seed.sql` contains two institutions with deliberately overlapping class,
admission, and employee identifiers. `tests/database/phase_2_tenant_isolation.sql`
exercises cross-tenant RLS and relationship attacks transactionally.
