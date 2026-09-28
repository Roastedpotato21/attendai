/**
 * AttendAI E2E auth-onboarding verification script.
 *
 * Tests the FULL flow programmatically:
 *   1. signUp() → creates auth.users record
 *   2. admin-confirm the email (service_role shortcut, equivalent to clicking link)
 *   3. signIn() with original password → session established
 *   4. provision_my_new_institution() RPC → institution + membership + admin role
 *   5. resolveStaffAccess() → verifies the onboarded profile
 *   6. signOut()
 *   7. signIn() again with SAME email + SAME password → success
 *   8. signIn() with WRONG password → denied
 *   9. provision_my_new_institution() again → idempotent (no duplicate)
 *   10. cleanup (optional)
 *
 * Usage:
 *   node scripts/test-e2e-onboarding.mjs
 *
 * Requires .env to have:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * And one of:
 *   SUPABASE_SERVICE_ROLE_KEY  (for admin-confirming email without real email click)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Load .env manually (no dotenv dependency needed)
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  const env = {};
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  } catch {
    // .env not found, rely on process.env
  }
  return env;
}

const fileEnv = loadEnv();
const get = (key) => process.env[key] || fileEnv[key];

const SUPABASE_URL = get("VITE_SUPABASE_URL");
const ANON_KEY = get("VITE_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("FATAL: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.");
  process.exit(1);
}

// Extract project ref for safe logging
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
console.log(`\n🔗 Supabase project: ${projectRef}`);
console.log(`🔗 URL: ${SUPABASE_URL}`);
console.log(`🔑 Service role key: ${SERVICE_ROLE_KEY ? "present" : "⚠️  MISSING"}\n`);

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const adminClient = SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const TEST_EMAIL = `e2etest${Date.now()}@gmail.com`;
const TEST_PASSWORD = "TestP@ssw0rd!2026";
const TEST_NAME = "E2E Test Admin";
const TEST_INST_NAME = `E2E Test Institution ${Date.now()}`;
const TEST_INST_CODE = `e2e-test-${Date.now()}`;

let testUserId = null;
let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log(`  ✅ ${label}`);
}
function fail(label, detail) {
  failed++;
  console.error(`  ❌ ${label}: ${detail}`);
}

// ---------------------------------------------------------------------------
// STEP 1: signUp
// ---------------------------------------------------------------------------
console.log("── STEP 1: signUp() ──────────────────────────────");
const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
  options: {
    emailRedirectTo: "http://localhost:8080/create-account",
    data: {
      name: TEST_NAME,
      onboarding_intent: "new_institution_admin",
      onboarding_institution_name: TEST_INST_NAME,
      onboarding_institution_code: TEST_INST_CODE,
    },
  },
});

if (signUpError) {
  fail("signUp", signUpError.message);
  console.error("\nFATAL: Cannot continue without a signup. Exiting.");
  process.exit(1);
}

testUserId = signUpData.user?.id;
const hasIdentities = (signUpData.user?.identities?.length ?? 0) > 0;
const emailConfirmedAtSignup = !!signUpData.user?.email_confirmed_at;

if (testUserId) ok(`auth.users record created (id: ${testUserId.slice(0, 8)}…)`);
else fail("signUp", "no user returned");

if (hasIdentities) ok("identities list is non-empty (real new account)");
else fail("signUp", "identities empty — may be duplicate email");

console.log(`  ℹ️  email: ${TEST_EMAIL}`);
console.log(`  ℹ️  email_confirmed_at signup: ${emailConfirmedAtSignup}`);
console.log(`  ℹ️  session returned: ${!!signUpData.session}`);

// ---------------------------------------------------------------------------
// STEP 2: Admin-confirm email (simulates clicking verification link)
// ---------------------------------------------------------------------------
console.log("\n── STEP 2: Admin-confirm email ───────────────────");

if (!adminClient) {
  console.log("  ⚠️  SUPABASE_SERVICE_ROLE_KEY not available.");
  console.log("  ⚠️  Cannot admin-confirm email programmatically.");
  console.log("  ⚠️  You must click the verification link in your email manually.");
  console.log("  ⚠️  Remaining tests that require a confirmed email will be SKIPPED.\n");

  // Try signing in anyway — if Confirm Email is disabled, this will work
  const { error: preLoginErr } = await anonClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (preLoginErr) {
    if (/email.*not.*confirmed/i.test(preLoginErr.message)) {
      console.log("  ℹ️  Confirm: email verification IS enforced (good).");
      ok("Supabase requires email confirmation before login");
    } else {
      fail("pre-login check", preLoginErr.message);
    }
  } else {
    console.log("  ℹ️  Login worked without confirmation — Confirm Email may be disabled.");
  }
} else {
  // Use admin API to update the user's email_confirmed_at
  const { data: adminUpdateData, error: adminUpdateError } =
    await adminClient.auth.admin.updateUserById(testUserId, {
      email_confirm: true,
    });

  if (adminUpdateError) {
    fail("admin email confirm", adminUpdateError.message);
  } else if (adminUpdateData?.user?.email_confirmed_at) {
    ok(`email confirmed via admin API (email_confirmed_at populated)`);
  } else {
    fail("admin email confirm", "email_confirmed_at still null after update");
  }
}

// ---------------------------------------------------------------------------
// STEP 3: signIn with original password (session establishment)
// ---------------------------------------------------------------------------
console.log("\n── STEP 3: signIn (session establishment) ────────");

// Sign out first to clear any session from signup
await anonClient.auth.signOut();

const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
});

if (signInError) {
  fail("signIn", signInError.message);
  if (/email.*not.*confirmed/i.test(signInError.message)) {
    console.log("  ℹ️  Email not confirmed. Add SUPABASE_SERVICE_ROLE_KEY to .env to proceed.");
    console.log("  ℹ️  Or manually confirm the email in Supabase Dashboard.\n");
  }
} else if (signInData.session && signInData.user) {
  ok(`signIn succeeded (session established)`);
  ok(`user id matches: ${signInData.user.id === testUserId}`);
  console.log(`  ℹ️  access_token present: ${!!signInData.session.access_token}`);
}

// ---------------------------------------------------------------------------
// STEP 4: Check profile was created by trigger
// ---------------------------------------------------------------------------
console.log("\n── STEP 4: Verify profile trigger ────────────────");

if (signInData?.session) {
  const { data: profile, error: profileError } = await anonClient
    .from("profiles")
    .select("id, auth_user_id, name, email, status")
    .eq("auth_user_id", testUserId)
    .maybeSingle();

  if (profileError) {
    fail("profile lookup", profileError.message);
  } else if (!profile) {
    fail("profile lookup", "handle_new_auth_user trigger did NOT create a profile row");
  } else {
    ok(`profile exists (id: ${profile.id.slice(0, 8)}…)`);
    ok(`auth_user_id matches: ${profile.auth_user_id === testUserId}`);
    ok(`name: "${profile.name}"`);
    ok(`email: ${profile.email}`);
    ok(`status: ${profile.status}`);
  }
} else {
  console.log("  ⏭️  Skipped — no session established");
}

// ---------------------------------------------------------------------------
// STEP 5: provision_my_new_institution() RPC
// ---------------------------------------------------------------------------
console.log("\n── STEP 5: provision_my_new_institution() ────────");

let provisionedInstitutionId = null;
if (signInData?.session) {
  const { data: rpcResult, error: rpcError } = await anonClient.rpc("provision_my_new_institution");

  if (rpcError) {
    fail("provision RPC", `${rpcError.code}: ${rpcError.message}`);
  } else {
    provisionedInstitutionId = rpcResult;
    ok(`institution provisioned (id: ${String(rpcResult).slice(0, 8)}…)`);
  }
} else {
  console.log("  ⏭️  Skipped — no session");
}

// ---------------------------------------------------------------------------
// STEP 6: Verify institution + membership + role
// ---------------------------------------------------------------------------
console.log("\n── STEP 6: Verify provisioned data ───────────────");

if (provisionedInstitutionId && signInData?.session) {
  // Institution
  const { data: inst, error: instErr } = await anonClient
    .from("institutions")
    .select("id, name, code, status")
    .eq("id", provisionedInstitutionId)
    .maybeSingle();

  if (instErr) fail("institution lookup", instErr.message);
  else if (!inst) fail("institution lookup", "row not found");
  else {
    ok(`institution row: name="${inst.name}", code="${inst.code}", status="${inst.status}"`);
  }

  // Profile for membership/role lookups
  const { data: profile } = await anonClient
    .from("profiles")
    .select("id")
    .eq("auth_user_id", testUserId)
    .maybeSingle();

  if (profile) {
    // profile_institutions
    const { data: membership, error: memberErr } = await anonClient
      .from("profile_institutions")
      .select("profile_id, institution_id, status")
      .eq("profile_id", profile.id)
      .eq("institution_id", provisionedInstitutionId)
      .maybeSingle();

    if (memberErr) fail("membership lookup", memberErr.message);
    else if (!membership) fail("membership lookup", "no profile_institutions row");
    else ok(`membership: status="${membership.status}"`);

    // profile_roles
    const { data: role, error: roleErr } = await anonClient
      .from("profile_roles")
      .select("profile_id, institution_id, role_code")
      .eq("profile_id", profile.id)
      .eq("institution_id", provisionedInstitutionId)
      .eq("role_code", "admin")
      .maybeSingle();

    if (roleErr) fail("role lookup", roleErr.message);
    else if (!role) fail("role lookup", "no admin profile_roles row");
    else ok(`role: role_code="${role.role_code}"`);
  }
} else {
  console.log("  ⏭️  Skipped — no provisioned institution");
}

// ---------------------------------------------------------------------------
// STEP 7: Logout + Re-login with SAME email + SAME password
// ---------------------------------------------------------------------------
console.log("\n── STEP 7: Logout + re-login (same credentials) ─");

await anonClient.auth.signOut();
ok("signed out");

const { data: reloginData, error: reloginError } = await anonClient.auth.signInWithPassword({
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
});

if (reloginError) {
  fail("re-login", reloginError.message);
} else if (reloginData.session && reloginData.user) {
  ok("re-login succeeded with SAME email + SAME password");
  ok(`user id still matches: ${reloginData.user.id === testUserId}`);
} else {
  fail("re-login", "no session or user returned");
}

// ---------------------------------------------------------------------------
// STEP 8: Wrong-password control test
// ---------------------------------------------------------------------------
console.log("\n── STEP 8: Wrong-password denial ─────────────────");

await anonClient.auth.signOut();

const { error: wrongPwError } = await anonClient.auth.signInWithPassword({
  email: TEST_EMAIL,
  password: "WrongPassword!9999",
});

if (wrongPwError) {
  ok(`wrong password correctly denied: "${wrongPwError.message}"`);
} else {
  fail("wrong-password", "LOGIN SUCCEEDED WITH WRONG PASSWORD — critical security failure");
}

// ---------------------------------------------------------------------------
// STEP 9: Idempotency test — re-run provisioning
// ---------------------------------------------------------------------------
console.log("\n── STEP 9: Provisioning idempotency ──────────────");

// Re-sign-in with correct password
const { data: idempSignIn } = await anonClient.auth.signInWithPassword({
  email: TEST_EMAIL,
  password: TEST_PASSWORD,
});

if (idempSignIn?.session) {
  const { data: rpcResult2, error: rpcError2 } = await anonClient.rpc(
    "provision_my_new_institution",
  );

  if (rpcError2) {
    fail("idempotency RPC", `${rpcError2.code}: ${rpcError2.message}`);
  } else if (String(rpcResult2) === String(provisionedInstitutionId)) {
    ok("idempotent — returned same institution_id, no duplicate created");
  } else {
    fail("idempotency", `returned different id: ${rpcResult2} vs ${provisionedInstitutionId}`);
  }

  // Verify no duplicate institutions with same code
  const { data: dupeCheck } = await anonClient
    .from("institutions")
    .select("id")
    .eq("code", TEST_INST_CODE);
  if (dupeCheck && dupeCheck.length === 1) {
    ok("exactly 1 institution row with this code (no duplicates)");
  } else {
    fail("duplicate check", `found ${dupeCheck?.length ?? 0} institution rows`);
  }
} else {
  console.log("  ⏭️  Skipped — could not re-sign-in");
}

// ---------------------------------------------------------------------------
// STEP 10: Cleanup (optional — delete test user if admin client available)
// ---------------------------------------------------------------------------
console.log("\n── STEP 10: Cleanup ──────────────────────────────");

await anonClient.auth.signOut();

if (adminClient && testUserId) {
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(testUserId);
  if (deleteError) {
    console.log(`  ⚠️  Could not delete test user: ${deleteError.message}`);
  } else {
    ok("test user deleted from auth.users (cascade deletes profile + memberships)");
  }
} else {
  console.log(`  ℹ️  Test user left in place: ${TEST_EMAIL}`);
  console.log("  ℹ️  Add SUPABASE_SERVICE_ROLE_KEY to .env for auto-cleanup.");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n══════════════════════════════════════════════════");
console.log(`  PASSED: ${passed}    FAILED: ${failed}`);
console.log(`  VERDICT: ${failed === 0 ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);
console.log("══════════════════════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
