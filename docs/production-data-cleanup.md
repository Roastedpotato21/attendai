# Production cleanup audit — 2026-10-19

Checkout cleanup and final verification completed on 2026-10-20.

The public deployment is `https://attendai.attendai-expresspotato44.workers.dev`.
Its browser bundle identifies Supabase project `elebygmdftfjgecauyiq`.

The saved Supabase CLI account can list two unrelated projects, but the production
project's API-key endpoint explicitly returned HTTP 403. Cloudflare CLI has no
saved authenticated account. No production records were read or deleted, and
this cleanup has not been deployed.

The public Supabase URL and anonymous browser key were recovered into ignored
local `.env`, allowing local sign-in with an existing authorized staff account.
These public values do not grant administrative database access.

## Findings fixed in the checkout

- Removed the platform build wrapper, its dependency tree, sandbox integration
  settings, and the old heart favicon. Vite now uses the framework plugins
  directly, retaining the Cloudflare build and communication scheduler.
  Both package-manager lockfiles were regenerated; the existing gRPC override
  now uses the top-level syntax supported by both npm and Bun.
- Removed the seeded memory database and password-free demo sign-in. Supabase
  configuration is required; unsupported data modes fail explicitly.
- Replaced invented dashboard numbers, attendance trends, class statistics, and
  language distributions with database calculations. Today's absences use
  today's attendance sessions instead of cached historical student statuses.
  Empty attendance displays no records instead of a fabricated perfect rate.
  Student percentages, consecutive absences, and risk now come from dated
  attendance records rather than potentially stale cached student aggregates.
- Paginated repository lists so API row limits cannot silently truncate totals.
- Removed hardcoded insights, editable sample templates, fake institution
  settings, pretend report schedules, invented user/MFA counts, and unsupported
  success toasts. Reports can download a real attendance summary as CSV; route
  access is displayed from the actual route rules.
- Removed the old simulated communication engine and provider success responses.
  The durable server workers remain the delivery path. Unsupported manual
  outreach and unimplemented QR identity/proximity checks fail before writing.
- Simulated SMS delivery is refused in production. Any existing simulation
  records are labelled as simulated and excluded from real delivery totals.
- Removed heuristic text masquerading as successful AI output when the provider
  is unavailable. AI failures now surface as unavailable.
- Disabled automatic SQL seeding. Synthetic SQL rows now live in
  `supabase/tests/fixtures.sql`, loaded only by isolated database verification.
- Removed the obsolete trial execution key from the worker configuration.

## Production records still need inspection

Run [`audit_production_data.sql`](../supabase/verification/audit_production_data.sql)
in the production Supabase SQL editor using an account authorized for this
project. It is a read-only transaction and does not output phone numbers,
device tokens, or notification bodies.

It checks fixture-like institutions and profiles, the previously used Student
One / Student Two / Attendance Test Guardian records, simulated communication
history, stale pending absence jobs, old Firebase registrations, and expired
unused enrollment invitations. These are candidates, not confirmed live findings.

Inspect actual results and relationships before preparing a scoped deletion or
archival transaction. The legacy institution ID is created by a migration and
cannot alone prove that its records are fake. Historical attendance, consent
records, provider evidence, and real phone enrollment must not be inferred fake
merely because they were used in a test.

GitHub reports no repository webhooks. Listing installed GitHub Apps is not
supported by the saved OAuth token (HTTP 403), so external repository access
has not been independently verified. Review repository access in GitHub's
installed-app settings to finish disconnecting any external editor integration.

The native build configuration follows the
[Nitro Vite integration](https://nitro.build/docs/vite) and
[TanStack Start hosting guidance](https://tanstack.com/start/latest/docs/framework/react/guide/hosting).

## Validation

TypeScript, ESLint, the production build, 59 communication/security tests,
7 data-accuracy/pagination tests, 5 authentication-error tests, and the isolated
PostgreSQL suite passed. The database suite also executes the audit above as a
read-only transaction against the full migrated schema. The local production
preview returned HTTP 200 for sign-in, policy pages, the replacement favicon,
and the unavailable student check-in page. Neither the source checkout nor
the built application contains the removed platform integration markers.

These checks do not prove that existing production records are clean or that
an authenticated live dashboard has been tested; that requires production access.

The final npm lockfile audit reported zero vulnerabilities. Both dependency
graphs resolve the existing gRPC override to version 1.14.6.
