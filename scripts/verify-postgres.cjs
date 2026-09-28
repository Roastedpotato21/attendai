const EmbeddedPostgres = require("embedded-postgres").default;
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

async function main() {
  const port = 54323;
  const dbDir = path.join(__dirname, "../data/test-db");
  if (fs.existsSync(dbDir)) {
    fs.rmSync(dbDir, { recursive: true, force: true });
  }

  const pg = new EmbeddedPostgres({
    port,
    databaseDir: dbDir,
    user: "postgres",
    password: "password",
  });

  console.log("1. Initializing and starting EmbeddedPostgres...");
  await pg.initialise();
  await pg.start();
  console.log("PostgreSQL started on port", port);

  const client = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "password",
    database: "postgres",
  });

  await client.connect();
  console.log("Connected to PostgreSQL!");

  // Check auth schema mock / uuid extension
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth;`);
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;
  `);
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$ LANGUAGE sql STABLE;
  `);
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      instance_id uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      aud text DEFAULT 'authenticated',
      role text DEFAULT 'authenticated',
      email text,
      encrypted_password text DEFAULT '',
      email_confirmed_at timestamptz DEFAULT now(),
      raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `);
  await client.query(`CREATE ROLE authenticated NOLOGIN;`);
  await client.query(`CREATE ROLE anon NOLOGIN;`);
  await client.query(`CREATE ROLE service_role NOLOGIN;`);

  console.log("2. Running migrations 00000 through 00009...");
  const migrationsDir = path.join(__dirname, "../supabase/migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    console.log(`Applying migration: ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query(sql);
    console.log(`  ✓ ${file} applied successfully`);
  }

  // Supabase PostgREST default grants
  await client.query(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
  `);

  console.log("3. Applying seed.sql...");
  const seedSql = fs.readFileSync(path.join(__dirname, "../supabase/seed.sql"), "utf8");
  await client.query(seedSql);
  console.log("  ✓ seed.sql applied successfully");

  console.log("4. Verifying staff invitation lifecycle...");
  // The profile trigger deliberately assigns a neutral legacy profile role.
  // Staff access must instead come from the active tenant membership and its
  // tenant-scoped profile_roles row.
  const lifecycleAuthId = "00000000-0000-4000-8000-000000000088";
  const lifecycleInstitutionId = "11111111-1111-4111-8111-111111111111";
  await client.query(
    `
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ($1, 'lifecycle-staff@test.invalid', '{"name": "Lifecycle Staff"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `,
    [lifecycleAuthId],
  );
  const profileRole = await client.query(`SELECT role FROM public.profiles WHERE id = $1`, [
    lifecycleAuthId,
  ]);
  if (profileRole.rows[0]?.role !== "student") {
    throw new Error("Lifecycle fixture did not retain the neutral legacy profile role");
  }
  await client.query(
    `
    INSERT INTO public.profile_institutions (profile_id, institution_id, status, invited_at)
    VALUES ($1, $2, 'invited', timezone('utc', now()))
    ON CONFLICT (profile_id, institution_id) DO UPDATE
      SET status = 'invited', invited_at = timezone('utc', now()), activated_at = NULL, revoked_at = NULL;
  `,
    [lifecycleAuthId, lifecycleInstitutionId],
  );
  await client.query(
    `
    INSERT INTO public.profile_roles (profile_id, institution_id, role_code)
    VALUES ($1, $2, 'staff')
    ON CONFLICT (profile_id, institution_id, role_code) DO NOTHING;
  `,
    [lifecycleAuthId, lifecycleInstitutionId],
  );
  await client.query(`SET ROLE authenticated;`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', '${lifecycleAuthId}', false);`);
  const activation = await client.query(
    `SELECT public.activate_my_staff_invitation() AS institution_id;`,
  );
  if (activation.rows[0]?.institution_id !== lifecycleInstitutionId) {
    throw new Error("Pending staff invitation was not activated for its assigned institution");
  }
  const staffAccess = await client.query(
    `SELECT public.has_institution_role($1, ARRAY['staff']::user_role[]) AS allowed;`,
    [lifecycleInstitutionId],
  );
  if (!staffAccess.rows[0]?.allowed) {
    throw new Error("Active tenant-scoped staff role was not authorized");
  }
  await client.query(`RESET ROLE;`);

  for (const status of ["suspended", "revoked"]) {
    await client.query(
      `UPDATE public.profile_institutions SET status = $1 WHERE profile_id = $2 AND institution_id = $3;`,
      [status, lifecycleAuthId, lifecycleInstitutionId],
    );
    await client.query(`SET ROLE authenticated;`);
    await client.query(`SELECT set_config('request.jwt.claim.sub', '${lifecycleAuthId}', false);`);
    const deniedAccess = await client.query(
      `SELECT public.has_institution_role($1, ARRAY['staff']::user_role[]) AS allowed;`,
      [lifecycleInstitutionId],
    );
    if (deniedAccess.rows[0]?.allowed) {
      throw new Error(`${status} membership retained staff portal authorization`);
    }
    await client.query(`RESET ROLE;`);
  }

  await client.query(
    `UPDATE public.profile_institutions SET status = 'invited' WHERE profile_id = $1 AND institution_id = $2;`,
    [lifecycleAuthId, lifecycleInstitutionId],
  );
  await client.query(
    `DELETE FROM public.profile_roles
      WHERE profile_id = $1 AND institution_id = $2 AND role_code = 'staff';`,
    [lifecycleAuthId, lifecycleInstitutionId],
  );
  await client.query(
    `INSERT INTO public.profile_roles (profile_id, institution_id, role_code)
      VALUES ($1, $2, 'student');`,
    [lifecycleAuthId, lifecycleInstitutionId],
  );
  await client.query(`SET ROLE authenticated;`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', '${lifecycleAuthId}', false);`);
  try {
    await client.query(`SELECT public.activate_my_staff_invitation();`);
    throw new Error("Student-only invitation was activated as staff");
  } catch (error) {
    if (error.message === "Student-only invitation was activated as staff") throw error;
    if (error.code !== "42501") throw error;
  }
  await client.query(`RESET ROLE;`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  console.log(
    "  ✓ invitation activation, tenant role resolution, suspension/revocation, and student rejection passed",
  );

  console.log("5. Verifying first-admin institution onboarding...");
  const onboardingAuthId = "00000000-0000-4000-8000-000000000089";
  await client.query(
    `
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (
      $1,
      'first-admin@test.invalid',
      '{"name":"First Administrator","onboarding_intent":"new_institution_admin","onboarding_institution_name":"Onboarding Academy","onboarding_institution_code":"onboarding-academy"}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;
  `,
    [onboardingAuthId],
  );
  await client.query(`SET ROLE authenticated;`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', '${onboardingAuthId}', false);`);
  const onboarding = await client.query(
    `SELECT public.provision_my_new_institution() AS institution_id;`,
  );
  const onboardingInstitutionId = onboarding.rows[0]?.institution_id;
  if (!onboardingInstitutionId)
    throw new Error("First-admin onboarding did not create an institution");
  const onboardingAccess = await client.query(
    `
    SELECT public.has_institution_role($1, ARRAY['admin']::user_role[]) AS allowed,
           (SELECT status FROM public.profile_institutions WHERE profile_id = $2 AND institution_id = $1) AS membership_status,
           (SELECT count(*)::int FROM public.profile_roles WHERE profile_id = $2 AND institution_id = $1 AND role_code = 'admin') AS admin_roles;
  `,
    [onboardingInstitutionId, onboardingAuthId],
  );
  if (
    !onboardingAccess.rows[0]?.allowed ||
    onboardingAccess.rows[0]?.membership_status !== "active" ||
    onboardingAccess.rows[0]?.admin_roles !== 1
  ) {
    throw new Error("First-admin onboarding did not create one active admin membership");
  }
  const onboardingRetry = await client.query(
    `SELECT public.provision_my_new_institution() AS institution_id;`,
  );
  if (onboardingRetry.rows[0]?.institution_id !== onboardingInstitutionId) {
    throw new Error("First-admin onboarding was not idempotent");
  }
  await client.query(`RESET ROLE;`);

  const unverifiedAuthId = "00000000-0000-4000-8000-000000000090";
  await client.query(
    `
    INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    VALUES (
      $1,
      'unverified-admin@test.invalid',
      NULL,
      '{"name":"Unverified Administrator","onboarding_intent":"new_institution_admin","onboarding_institution_name":"Unverified Academy","onboarding_institution_code":"unverified-academy"}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;
  `,
    [unverifiedAuthId],
  );
  await client.query(`SET ROLE authenticated;`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', '${unverifiedAuthId}', false);`);
  try {
    await client.query(`SELECT public.provision_my_new_institution();`);
    throw new Error("Unverified email created an institution");
  } catch (error) {
    if (error.message === "Unverified email created an institution") throw error;
    if (error.code !== "42501") throw error;
  }
  await client.query(`RESET ROLE;`);

  const studentAuthId = "00000000-0000-4000-8000-000000000091";
  await client.query(
    `
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (
      $1,
      'student-onboarding@test.invalid',
      '{"name":"Student Identity","onboarding_intent":"new_institution_admin","onboarding_institution_name":"Blocked Academy","onboarding_institution_code":"blocked-academy"}'::jsonb
    )
    ON CONFLICT (id) DO NOTHING;
  `,
    [studentAuthId],
  );
  const studentInstitution = await client.query(`SELECT id FROM public.institutions LIMIT 1;`);
  await client.query(
    `INSERT INTO public.profile_institutions (profile_id, institution_id, status)
     VALUES ($1, $2, 'active');`,
    [studentAuthId, studentInstitution.rows[0].id],
  );
  await client.query(
    `INSERT INTO public.profile_roles (profile_id, institution_id, role_code)
     VALUES ($1, $2, 'student');`,
    [studentAuthId, studentInstitution.rows[0].id],
  );
  await client.query(`SET ROLE authenticated;`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', '${studentAuthId}', false);`);
  try {
    await client.query(`SELECT public.provision_my_new_institution();`);
    throw new Error("Student identity created an institution");
  } catch (error) {
    if (error.message === "Student identity created an institution") throw error;
    if (error.code !== "42501") throw error;
  }
  await client.query(`RESET ROLE;`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  console.log(
    "  ✓ verified first admin, idempotence, email verification, and student rejection passed",
  );

  console.log("6. Running Phase 2 test suite...");
  const testsDir = path.join(__dirname, "../supabase/tests/database");
  const testFiles = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of testFiles) {
    console.log(`Running test: ${file}...`);
    const sql = fs.readFileSync(path.join(testsDir, file), "utf8");
    await client.query(sql);
    console.log(`  ✓ ${file} passed!`);
  }

  console.log("7. Testing 00006 submit_attendance RPC atomic behavior & constraints...");
  // Provision an admin user for testing RPC and jobs:
  const adminAuthId = "00000000-0000-4000-8000-000000000099";
  await client.query(
    `
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ($1, 'rpc-admin@test.invalid', '{"name": "RPC Admin"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `,
    [adminAuthId],
  );

  const instRes = await client.query(`SELECT id FROM public.institutions LIMIT 1;`);
  const testInstId = instRes.rows[0].id;

  await client.query(
    `
    INSERT INTO public.profile_institutions (profile_id, institution_id, status)
    VALUES ($1, $2, 'active')
    ON CONFLICT (profile_id, institution_id) DO UPDATE SET status = 'active';
  `,
    [adminAuthId, testInstId],
  );

  await client.query(
    `
    INSERT INTO public.profile_roles (profile_id, institution_id, role_code)
    VALUES ($1, $2, 'admin')
    ON CONFLICT (profile_id, institution_id, role_code) DO NOTHING;
  `,
    [adminAuthId, testInstId],
  );

  await client.query(`SET ROLE authenticated;`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', '${adminAuthId}', false);`);

  const classRes = await client.query(
    `SELECT id, institution_id FROM public.classes WHERE institution_id = $1 LIMIT 1;`,
    [testInstId],
  );
  const testClassId = classRes.rows[0].id;

  const studentsRes = await client.query(
    `SELECT id FROM public.students WHERE class_id = '${testClassId}' LIMIT 2;`,
  );
  const student1 = studentsRes.rows[0].id;
  const student2 = studentsRes.rows[1].id;

  const rpcResult = await client.query(
    `
    SELECT public.submit_attendance(
      $1::uuid,
      $2::date,
      $3::text,
      $4::jsonb
    ) as result;
  `,
    [
      testClassId,
      "2026-09-17",
      "faculty",
      JSON.stringify([
        { student_id: student1, status: "present" },
        { student_id: student2, status: "absent" },
      ]),
    ],
  );
  console.log("  ✓ submit_attendance returned:", rpcResult.rows[0].result);

  // Test duplicate session rejection
  try {
    await client.query(
      `
      SELECT public.submit_attendance(
        $1::uuid,
        $2::date,
        $3::text,
        $4::jsonb
      );
    `,
      [
        testClassId,
        "2026-09-17",
        "faculty",
        JSON.stringify([{ student_id: student1, status: "present" }]),
      ],
    );
    throw new Error("Duplicate session was NOT rejected!");
  } catch (err) {
    console.log("  ✓ Duplicate attendance correctly rejected:", err.message);
  }

  // Test wrong student rejection (student from different class)
  const otherClassStudentRes = await client.query(
    `SELECT id FROM public.students WHERE class_id != '${testClassId}' LIMIT 1;`,
  );
  if (otherClassStudentRes.rows.length > 0) {
    const wrongStudentId = otherClassStudentRes.rows[0].id;
    try {
      await client.query(
        `
        SELECT public.submit_attendance(
          $1::uuid,
          $2::date,
          $3::text,
          $4::jsonb
        );
      `,
        [
          testClassId,
          "2026-09-18",
          "faculty",
          JSON.stringify([{ student_id: wrongStudentId, status: "present" }]),
        ],
      );
      throw new Error("Wrong student was NOT rejected!");
    } catch (err) {
      console.log("  ✓ Wrong class student correctly rejected:", err.message);
    }
  }

  await client.query(`RESET ROLE;`);
  console.log("7. Testing 00007 attendance outbox, consent, idempotency, and job claiming...");
  const outboxRes = await client.query(
    `
    SELECT j.id, j.status, j.attempts, j.channel, c.idempotency_key
    FROM public.communication_jobs j
    JOIN public.communications c
      ON c.id = j.communication_id AND c.institution_id = j.institution_id
    WHERE j.institution_id = $1
      AND c.metadata ->> 'attendance_session_id' = $2
  `,
    [testInstId, rpcResult.rows[0].result.session_id],
  );
  if (outboxRes.rows.length !== 1) {
    throw new Error(`Expected one consented absence outbox job, got ${outboxRes.rows.length}`);
  }
  console.log("  ✓ consented absence created one durable outbox job:", outboxRes.rows[0]);

  const claimRes = await client.query(
    `SELECT id, status, attempts, lease_owner FROM public.claim_communication_jobs(10);`,
  );
  if (claimRes.rows.length < 1 || claimRes.rows.some((row) => row.status !== "processing")) {
    throw new Error("Ready communication job was not atomically claimed");
  }
  console.log("  ✓ ready job claimed once with processing lease");

  const duplicateRes = await client.query(
    `
    SELECT count(*)::int AS count
    FROM public.communication_jobs
    WHERE institution_id = $1 AND idempotency_key = $2
  `,
    [testInstId, outboxRes.rows[0].idempotency_key],
  );
  if (duplicateRes.rows[0].count !== 1) {
    throw new Error("Communication idempotency key is not unique");
  }
  console.log("  ✓ durable idempotency key is unique");

  const originalClaim = claimRes.rows.find((row) => row.id === outboxRes.rows[0].id);
  const originalFinished = await client.query(
    `SELECT public.finish_communication_job($1, $2, $3::jsonb) AS finished`,
    [
      originalClaim.id,
      originalClaim.lease_owner,
      JSON.stringify({ ok: true, provider: "mock", providerId: "mock-original", status: "queued" }),
    ],
  );
  if (!originalFinished.rows[0].finished) {
    const actual = await client.query(
      `SELECT id, status, attempts, lease_owner, locked_at, now() AS checked_at FROM public.communication_jobs WHERE id = $1`,
      [originalClaim.id],
    );
    throw new Error(
      `Original leased job did not finish: expected owner ${originalClaim.lease_owner}; actual ${JSON.stringify(actual.rows[0])}`,
    );
  }

  console.log("8. Testing overlapping claims and completed-job fencing...");
  const insertedConcurrent = await client.query(
    `
    INSERT INTO public.communication_jobs (
      institution_id, communication_id, channel, payload, idempotency_key
    )
    SELECT institution_id, communication_id, channel, '{}'::jsonb, key
    FROM public.communication_jobs source
    CROSS JOIN (VALUES ('phase4a-concurrent-a'), ('phase4a-concurrent-b')) AS keys(key)
    WHERE source.id = $1
    RETURNING id
    `,
    [outboxRes.rows[0].id],
  );
  if (insertedConcurrent.rows.length !== 2) throw new Error("Concurrent fixtures were not created");

  const connection = {
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "password",
    database: "postgres",
  };
  const clientA = new Client(connection);
  const clientB = new Client(connection);
  await Promise.all([clientA.connect(), clientB.connect()]);
  const [claimA, claimB] = await Promise.all([
    clientA.query(`SELECT id, lease_owner FROM public.claim_communication_jobs(1)`),
    clientB.query(`SELECT id, lease_owner FROM public.claim_communication_jobs(1)`),
  ]);
  await Promise.all([clientA.end(), clientB.end()]);
  if (
    claimA.rows.length !== 1 ||
    claimB.rows.length !== 1 ||
    claimA.rows[0].id === claimB.rows[0].id
  ) {
    throw new Error("Overlapping workers did not claim distinct jobs");
  }
  for (const claimed of [claimA.rows[0], claimB.rows[0]]) {
    const finished = await client.query(
      `SELECT public.finish_communication_job($1, $2, $3::jsonb) AS finished`,
      [
        claimed.id,
        claimed.lease_owner,
        JSON.stringify({
          ok: true,
          provider: "mock",
          providerId: `mock-${claimed.id}`,
          status: "sent",
        }),
      ],
    );
    if (!finished.rows[0].finished) throw new Error("Concurrent claimed job did not finish");
  }
  const reclaimedCompleted = await client.query(
    `SELECT id FROM public.claim_communication_jobs(10) WHERE id = ANY($1::uuid[])`,
    [[claimA.rows[0].id, claimB.rows[0].id]],
  );
  if (reclaimedCompleted.rows.length !== 0) throw new Error("Completed job was reclaimed");
  console.log("  ✓ overlapping workers claimed different jobs; completed jobs stayed terminal");

  console.log("9. Testing stale lease recovery and bounded retry outcomes...");
  const staleFixture = await client.query(
    `
    INSERT INTO public.communication_jobs (
      institution_id, communication_id, channel, status, attempts, max_attempts,
      payload, idempotency_key, locked_at, lease_owner
    )
    SELECT institution_id, communication_id, channel, 'processing', 1, 3,
           '{}'::jsonb, 'phase4a-stale', now() - interval '16 minutes', gen_random_uuid()
    FROM public.communication_jobs WHERE id = $1
    RETURNING id
    `,
    [outboxRes.rows[0].id],
  );
  const staleClaim = await client.query(
    `SELECT id, attempts, lease_owner, last_error FROM public.claim_communication_jobs(1)`,
  );
  if (
    staleClaim.rows.length !== 1 ||
    staleClaim.rows[0].id !== staleFixture.rows[0].id ||
    staleClaim.rows[0].attempts !== 2 ||
    staleClaim.rows[0].last_error !== "worker lease expired"
  ) {
    throw new Error("Stale lease was not recovered and reclaimed exactly once");
  }
  await client.query(`SELECT public.finish_communication_job($1, $2, $3::jsonb)`, [
    staleClaim.rows[0].id,
    staleClaim.rows[0].lease_owner,
    JSON.stringify({ ok: false, errorClass: "transient", message: "mock timeout" }),
  ]);
  const retryState = await client.query(
    `SELECT status, attempts, next_run_at > now() AS delayed FROM public.communication_jobs WHERE id = $1`,
    [staleFixture.rows[0].id],
  );
  if (retryState.rows[0].status !== "pending" || !retryState.rows[0].delayed) {
    throw new Error("Transient provider error did not schedule a delayed retry");
  }
  await client.query(`UPDATE public.communication_jobs SET next_run_at = now() WHERE id = $1`, [
    staleFixture.rows[0].id,
  ]);
  const finalAttempt = await client.query(
    `SELECT id, attempts, lease_owner FROM public.claim_communication_jobs(1) WHERE id = $1`,
    [staleFixture.rows[0].id],
  );
  await client.query(`SELECT public.finish_communication_job($1, $2, $3::jsonb)`, [
    finalAttempt.rows[0].id,
    finalAttempt.rows[0].lease_owner,
    JSON.stringify({ ok: false, errorClass: "transient", message: "mock timeout" }),
  ]);
  const exhausted = await client.query(
    `SELECT status, attempts FROM public.communication_jobs WHERE id = $1`,
    [staleFixture.rows[0].id],
  );
  if (exhausted.rows[0].status !== "dead_letter" || exhausted.rows[0].attempts !== 3) {
    throw new Error("Transient retries were not capped at max_attempts");
  }

  const permanentFixture = await client.query(
    `
    INSERT INTO public.communication_jobs (
      institution_id, communication_id, channel, payload, idempotency_key
    )
    SELECT institution_id, communication_id, channel, '{}'::jsonb, 'phase4a-permanent'
    FROM public.communication_jobs WHERE id = $1
    RETURNING id
    `,
    [outboxRes.rows[0].id],
  );
  const permanentClaim = await client.query(
    `SELECT id, lease_owner FROM public.claim_communication_jobs(1) WHERE id = $1`,
    [permanentFixture.rows[0].id],
  );
  await client.query(`SELECT public.finish_communication_job($1, $2, $3::jsonb)`, [
    permanentClaim.rows[0].id,
    permanentClaim.rows[0].lease_owner,
    JSON.stringify({ ok: false, errorClass: "permanent", message: "mock rejection" }),
  ]);
  const permanentState = await client.query(
    `SELECT status FROM public.communication_jobs WHERE id = $1`,
    [permanentFixture.rows[0].id],
  );
  if (permanentState.rows[0].status !== "dead_letter") {
    throw new Error("Permanent provider rejection was not terminal");
  }
  console.log(
    "  ✓ stale lease recovered; transient retries delayed/capped; permanent rejection terminal",
  );

  console.log("10. Testing an empty queue...");
  const emptyClaim = await client.query(`SELECT id FROM public.claim_communication_jobs(20)`);
  if (emptyClaim.rows.length !== 0) throw new Error("Empty queue claim returned work");
  console.log("  ✓ empty queue returned immediately without creating work");

  await client.end();
  await pg.stop();
  console.log("All local database verifications passed successfully!");
}

main().catch((err) => {
  console.error("VERIFICATION ERROR:", err);
  process.exit(1);
});
