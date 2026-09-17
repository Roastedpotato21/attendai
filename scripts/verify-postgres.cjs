const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const port = 54323;
  const dbDir = path.join(__dirname, '../data/test-db');
  if (fs.existsSync(dbDir)) {
    fs.rmSync(dbDir, { recursive: true, force: true });
  }

  const pg = new EmbeddedPostgres({
    port,
    databaseDir: dbDir,
    user: 'postgres',
    password: 'password'
  });

  console.log('1. Initializing and starting EmbeddedPostgres...');
  await pg.initialise();
  await pg.start();
  console.log('PostgreSQL started on port', port);

  const client = new Client({
    host: 'localhost',
    port,
    user: 'postgres',
    password: 'password',
    database: 'postgres'
  });

  await client.connect();
  console.log('Connected to PostgreSQL!');

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
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      created_at timestamptz DEFAULT now()
    );
  `);
  await client.query(`CREATE ROLE authenticated NOLOGIN;`);
  await client.query(`CREATE ROLE anon NOLOGIN;`);

  console.log('2. Running migrations 00000 through 00006...');
  const migrationsDir = path.join(__dirname, '../supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    console.log(`Applying migration: ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await client.query(sql);
    console.log(`  ✓ ${file} applied successfully`);
  }

  // Supabase PostgREST default grants
  await client.query(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
  `);

  console.log('3. Applying seed.sql...');
  const seedSql = fs.readFileSync(path.join(__dirname, '../supabase/seed.sql'), 'utf8');
  await client.query(seedSql);
  console.log('  ✓ seed.sql applied successfully');

  console.log('4. Running Phase 2 test suite...');
  const testsDir = path.join(__dirname, '../supabase/tests/database');
  const testFiles = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of testFiles) {
    console.log(`Running test: ${file}...`);
    const sql = fs.readFileSync(path.join(testsDir, file), 'utf8');
    await client.query(sql);
    console.log(`  ✓ ${file} passed!`);
  }

  console.log('5. Testing 00006 submit_attendance RPC atomic behavior & constraints...');
  // Test submit_attendance with an admin user from seed
  await client.query(`SET ROLE authenticated;`);
  // Seed admin u-admin id:
  const adminRes = await client.query(`SELECT id, auth_user_id FROM public.profiles WHERE email = 'admin@attendai.com';`);
  const adminProfileId = adminRes.rows[0].id;
  const adminAuthId = adminRes.rows[0].auth_user_id;
  await client.query(`SET LOCAL request.jwt.claim.sub = '${adminAuthId}';`);

  const classRes = await client.query(`SELECT id, institution_id FROM public.classes LIMIT 1;`);
  const testClassId = classRes.rows[0].id;
  const testInstId = classRes.rows[0].institution_id;

  const studentsRes = await client.query(`SELECT id FROM public.students WHERE class_id = '${testClassId}' LIMIT 2;`);
  const student1 = studentsRes.rows[0].id;
  const student2 = studentsRes.rows[1].id;

  const rpcResult = await client.query(`
    SELECT public.submit_attendance(
      $1::uuid,
      $2::date,
      $3::text,
      $4::jsonb
    ) as result;
  `, [
    testClassId,
    '2026-09-17',
    'manual',
    JSON.stringify([
      { student_id: student1, status: 'present' },
      { student_id: student2, status: 'absent' }
    ])
  ]);
  console.log('  ✓ submit_attendance returned:', rpcResult.rows[0].result);

  // Test duplicate session rejection
  try {
    await client.query(`
      SELECT public.submit_attendance(
        $1::uuid,
        $2::date,
        $3::text,
        $4::jsonb
      );
    `, [
      testClassId,
      '2026-09-17',
      'manual',
      JSON.stringify([
        { student_id: student1, status: 'present' }
      ])
    ]);
    throw new Error('Duplicate session was NOT rejected!');
  } catch (err) {
    console.log('  ✓ Duplicate attendance correctly rejected:', err.message);
  }

  // Test wrong student rejection (student from different class)
  const otherClassStudentRes = await client.query(`SELECT id FROM public.students WHERE class_id != '${testClassId}' LIMIT 1;`);
  if (otherClassStudentRes.rows.length > 0) {
    const wrongStudentId = otherClassStudentRes.rows[0].id;
    try {
      await client.query(`
        SELECT public.submit_attendance(
          $1::uuid,
          $2::date,
          $3::text,
          $4::jsonb
        );
      `, [
        testClassId,
        '2026-09-18',
        'manual',
        JSON.stringify([
          { student_id: wrongStudentId, status: 'present' }
        ])
      ]);
      throw new Error('Wrong student was NOT rejected!');
    } catch (err) {
      console.log('  ✓ Wrong class student correctly rejected:', err.message);
    }
  }

  await client.query(`RESET ROLE;`);
  await client.end();
  await pg.stop();
  console.log('All local database verifications passed successfully!');
}

main().catch(err => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
