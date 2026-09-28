import { createClient } from "@supabase/supabase-js";

const [emailArg, nameArg, institutionNameArg, institutionCodeArg] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const name = nameArg?.trim();
const institutionName = institutionNameArg?.trim();
const institutionCode = institutionCodeArg?.trim().toLowerCase();

if (
  !email ||
  !name ||
  !institutionName ||
  !/^[a-z0-9][a-z0-9-]{1,62}$/.test(institutionCode ?? "")
) {
  console.error(
    "Usage: npm run bootstrap:admin -- <email> <full-name> <institution-name> <institution-code>",
  );
  process.exit(1);
}
if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.ATTENDAI_APP_URL
) {
  console.error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ATTENDAI_APP_URL must be configured.",
  );
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserByEmail(targetEmail) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === targetEmail);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  throw new Error("Refusing to scan more than 100,000 auth users for bootstrap safety.");
}

try {
  const { data: institution, error: institutionError } = await db
    .from("institutions")
    .upsert(
      { name: institutionName, code: institutionCode, status: "active" },
      { onConflict: "code" },
    )
    .select("id")
    .single();
  if (institutionError || !institution)
    throw institutionError ?? new Error("Institution was not created.");

  let authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { name },
      redirectTo: new URL("/accept-invite", process.env.ATTENDAI_APP_URL).toString(),
    });
    if (error || !data.user) throw error ?? new Error("Admin invitation was not created.");
    authUser = data.user;
  }

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUser.id)
    .single();
  if (profileError || !profile)
    throw profileError ?? new Error("Auth profile trigger did not create a profile.");

  const { data: existingAdmin } = await db
    .from("profile_roles")
    .select("profile_id")
    .eq("institution_id", institution.id)
    .eq("role_code", "admin")
    .maybeSingle();
  if (existingAdmin && existingAdmin.profile_id !== profile.id) {
    throw new Error("This institution already has a different administrator; refusing bootstrap.");
  }

  const { error: membershipError } = await db.from("profile_institutions").upsert(
    {
      profile_id: profile.id,
      institution_id: institution.id,
      status: authUser.last_sign_in_at ? "active" : "invited",
      invited_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,institution_id" },
  );
  if (membershipError) throw membershipError;
  const { error: roleError } = await db
    .from("profile_roles")
    .upsert(
      { profile_id: profile.id, institution_id: institution.id, role_code: "admin" },
      { onConflict: "profile_id,institution_id,role_code" },
    );
  if (roleError) throw roleError;

  console.log(
    `Trusted admin provisioned for ${institutionCode}. ${authUser.last_sign_in_at ? "Existing account linked." : "Invite email sent."}`,
  );
} catch (error) {
  console.error("Bootstrap failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
