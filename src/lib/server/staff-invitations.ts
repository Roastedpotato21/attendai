import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type StaffRole = "faculty" | "staff";
type InviteInput = { email: string; name: string; role: StaffRole };
type UpdateInput =
  | { action: "suspend" | "reactivate" | "revoke" | "resend"; profileId: string }
  | { action: "set_role"; profileId: string; role: StaffRole };
type Profile = { id: string; name: string; email: string; status: string };
type AdminContext = { profile: Profile; institutionId: string };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invitationAttempts = new Map<string, number[]>();
const INVITATION_LIMIT = Number(process.env["ATTENDAI_INVITATION_LIMIT"] ?? 10);
const INVITATION_WINDOW_MS = Number(process.env["ATTENDAI_INVITATION_WINDOW_MS"] ?? 60 * 60 * 1000);

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
function environment(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}
function serviceDb(): SupabaseClient {
  return createClient(environment("SUPABASE_URL"), environment("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
function invitationRedirect(): string {
  return new URL("/accept-invite", environment("ATTENDAI_APP_URL")).toString();
}
function normalizeInvite(value: unknown): InviteInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const email = typeof raw["email"] === "string" ? raw["email"].trim().toLowerCase() : "";
  const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
  if (
    !emailPattern.test(email) ||
    !name ||
    name.length > 120 ||
    (raw["role"] !== "faculty" && raw["role"] !== "staff")
  )
    return null;
  return { email, name, role: raw["role"] };
}
function normalizeUpdate(value: unknown): UpdateInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const profileId = typeof raw["profileId"] === "string" ? raw["profileId"] : "";
  if (!uuidPattern.test(profileId)) return null;
  if (["suspend", "reactivate", "revoke", "resend"].includes(String(raw["action"])))
    return { action: raw["action"] as "suspend" | "reactivate" | "revoke" | "resend", profileId };
  if (raw["action"] === "set_role" && (raw["role"] === "faculty" || raw["role"] === "staff"))
    return { action: "set_role", profileId, role: raw["role"] };
  return null;
}
async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
async function verifiedCaller(request: Request, db: SupabaseClient): Promise<string | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const { data, error } = await db.auth.getUser(authorization.slice("Bearer ".length));
  return error || !data.user ? null : data.user.id;
}
async function profileForAuthUser(db: SupabaseClient, authUserId: string): Promise<Profile | null> {
  const { data, error } = await db
    .from("profiles")
    .select("id, name, email, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

/** The current UI has no tenant picker, so multi-admin tenants are rejected rather than guessed. */
async function adminContext(request: Request, db: SupabaseClient): Promise<AdminContext | null> {
  const authUserId = await verifiedCaller(request, db);
  if (!authUserId) return null;
  const profile = await profileForAuthUser(db, authUserId);
  if (!profile || profile.status !== "active") return null;
  const { data, error } = await db
    .from("profile_roles")
    .select(
      "institution_id, profile_institutions!profile_roles_membership_fkey!inner(status), institutions!inner(status)",
    )
    .eq("profile_id", profile.id)
    .eq("role_code", "admin")
    .eq("profile_institutions.status", "active")
    .eq("institutions.status", "active");
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((row) => row.institution_id as string))];
  return ids.length === 1 ? { profile, institutionId: ids[0]! } : null;
}
function consumeInvitationQuota(context: AdminContext): number | null {
  const now = Date.now();
  const key = `${context.profile.id}:${context.institutionId}`;
  const attempts = (invitationAttempts.get(key) ?? []).filter(
    (time) => now - time < INVITATION_WINDOW_MS,
  );
  if (attempts.length >= INVITATION_LIMIT) {
    invitationAttempts.set(key, attempts);
    return Math.ceil((INVITATION_WINDOW_MS - (now - attempts[0]!)) / 1000);
  }
  attempts.push(now);
  invitationAttempts.set(key, attempts);
  return null;
}
async function audit(
  db: SupabaseClient,
  context: AdminContext,
  profileId: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("audit_logs").insert({
    institution_id: context.institutionId,
    actor_id: context.profile.id,
    action,
    target: profileId,
    ip: "server",
    severity: "info",
    entity_type: "profile",
    entity_id: profileId,
    metadata,
  });
  if (error) throw error;
}
async function createInvitation(
  db: SupabaseClient,
  context: AdminContext,
  invite: InviteInput,
): Promise<void> {
  const existing = await db.from("profiles").select("id").eq("email", invite.email).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const membership = await db
      .from("profile_institutions")
      .select("status")
      .eq("profile_id", existing.data.id)
      .eq("institution_id", context.institutionId)
      .maybeSingle();
    if (membership.error) throw membership.error;
    if (membership.data)
      throw new Error(
        membership.data.status === "invited"
          ? "This staff member already has a pending invitation. Use resend if needed."
          : "This email already belongs to a staff member in this institution.",
      );
    throw new Error(
      "This email already belongs to an AttendAI identity and must be provisioned by a trusted administrator.",
    );
  }
  let createdAuthUserId: string | null = null;
  try {
    const { data: invited, error: inviteError } = await db.auth.admin.inviteUserByEmail(
      invite.email,
      { data: { name: invite.name }, redirectTo: invitationRedirect() },
    );
    if (inviteError || !invited.user)
      throw inviteError ?? new Error("Supabase did not create the invitation.");
    createdAuthUserId = invited.user.id;
    const profile = await profileForAuthUser(db, invited.user.id);
    if (!profile) throw new Error("The auth profile was not provisioned.");
    const { error: profileError } = await db
      .from("profiles")
      .update({ name: invite.name, email: invite.email })
      .eq("id", profile.id);
    if (profileError) throw profileError;
    const { error: membershipError } = await db.from("profile_institutions").upsert(
      {
        profile_id: profile.id,
        institution_id: context.institutionId,
        status: "invited",
        invited_at: new Date().toISOString(),
        invited_by: context.profile.id,
        activated_at: null,
        revoked_at: null,
      },
      { onConflict: "profile_id,institution_id" },
    );
    if (membershipError) throw membershipError;
    const { error: roleError } = await db.from("profile_roles").upsert(
      {
        profile_id: profile.id,
        institution_id: context.institutionId,
        role_code: invite.role,
        assigned_by: context.profile.id,
      },
      { onConflict: "profile_id,institution_id,role_code" },
    );
    if (roleError) throw roleError;
    await audit(db, context, profile.id, "staff.invited", {
      role: invite.role,
      email: invite.email,
    });
  } catch (error) {
    // Auth and Postgres do not share a transaction. Delete only a newly-created
    // invite on failure, so no orphaned privileged identity survives.
    if (createdAuthUserId) await db.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
    throw error;
  }
}
async function memberInTenant(
  db: SupabaseClient,
  context: AdminContext,
  profileId: string,
): Promise<Profile | null> {
  if (profileId === context.profile.id)
    throw new Error("Administrators cannot change their own staff access.");
  const { data, error } = await db
    .from("profile_institutions")
    .select("profiles!profile_institutions_profile_id_fkey!inner(id, name, email, status)")
    .eq("profile_id", profileId)
    .eq("institution_id", context.institutionId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.profiles as unknown as Profile) : null;
}
async function updateMember(
  db: SupabaseClient,
  context: AdminContext,
  update: UpdateInput,
): Promise<void> {
  const target = await memberInTenant(db, context, update.profileId);
  if (!target) throw new Error("Staff member was not found in this institution.");
  const { data: roles, error: rolesError } = await db
    .from("profile_roles")
    .select("role_code")
    .eq("profile_id", update.profileId)
    .eq("institution_id", context.institutionId);
  if (rolesError) throw rolesError;
  if (!(roles ?? []).some((entry) => entry.role_code === "faculty" || entry.role_code === "staff"))
    throw new Error("Only faculty and staff accounts can be managed from this screen.");
  if (update.action === "set_role") {
    const { error: deleteError } = await db
      .from("profile_roles")
      .delete()
      .eq("profile_id", update.profileId)
      .eq("institution_id", context.institutionId)
      .in("role_code", ["faculty", "staff"]);
    if (deleteError) throw deleteError;
    const { error: roleError } = await db.from("profile_roles").insert({
      profile_id: update.profileId,
      institution_id: context.institutionId,
      role_code: update.role,
      assigned_by: context.profile.id,
    });
    if (roleError) throw roleError;
    await audit(db, context, update.profileId, "staff.role_changed", { role: update.role });
    return;
  }
  if (update.action === "resend") {
    const { data: membership, error: membershipError } = await db
      .from("profile_institutions")
      .select("status")
      .eq("profile_id", update.profileId)
      .eq("institution_id", context.institutionId)
      .single();
    if (membershipError) throw membershipError;
    if (membership.status !== "invited") throw new Error("Only pending invitations can be resent.");
    const { error: inviteError } = await db.auth.admin.inviteUserByEmail(target.email, {
      data: { name: target.name },
      redirectTo: invitationRedirect(),
    });
    if (inviteError)
      throw new Error(
        "Supabase could not resend this invitation. Revoke it and create a new invitation instead.",
      );
    const { error: touchError } = await db
      .from("profile_institutions")
      .update({ invited_at: new Date().toISOString(), invited_by: context.profile.id })
      .eq("profile_id", update.profileId)
      .eq("institution_id", context.institutionId);
    if (touchError) throw touchError;
    await audit(db, context, update.profileId, "staff.invite_resent");
    return;
  }
  const status =
    update.action === "suspend"
      ? "suspended"
      : update.action === "reactivate"
        ? "active"
        : "revoked";
  const { error } = await db
    .from("profile_institutions")
    .update({ status, revoked_at: status === "revoked" ? new Date().toISOString() : null })
    .eq("profile_id", update.profileId)
    .eq("institution_id", context.institutionId);
  if (error) throw error;
  await audit(db, context, update.profileId, `staff.membership_${status}`);
}

export async function handleStaffInvitationRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const invite = normalizeInvite(await requestBody(request));
  if (!invite)
    return json({ error: "Provide a valid name, email, and faculty or staff role." }, 400);
  try {
    const db = serviceDb();
    const context = await adminContext(request, db);
    if (!context)
      return json(
        { error: "Only an active administrator of one selected institution can invite staff." },
        403,
      );
    const retryAfter = consumeInvitationQuota(context);
    if (retryAfter !== null)
      return json({ error: "Invitation limit reached. Try again later." }, 429, {
        "retry-after": String(retryAfter),
      });
    await createInvitation(db, context, invite);
    return json({ ok: true }, 201);
  } catch (error) {
    console.error("[staff-invitation] failed", error);
    return json(
      { error: error instanceof Error ? error.message : "The invitation could not be sent." },
      422,
    );
  }
}
export async function handleStaffManagementRequest(request: Request): Promise<Response> {
  try {
    const db = serviceDb();
    const context = await adminContext(request, db);
    if (!context)
      return json(
        { error: "Only an active administrator of one selected institution can manage staff." },
        403,
      );
    if (request.method === "GET") {
      const { data: memberships, error } = await db
        .from("profile_institutions")
        .select(
          "profile_id, status, invited_at, activated_at, profiles!profile_institutions_profile_id_fkey!inner(id, name, email, status)",
        )
        .eq("institution_id", context.institutionId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const profileIds = (memberships ?? []).map((membership) => membership.profile_id);
      const { data: roles, error: rolesError } = profileIds.length
        ? await db
            .from("profile_roles")
            .select("profile_id, role_code")
            .eq("institution_id", context.institutionId)
            .in("profile_id", profileIds)
        : { data: [], error: null };
      if (rolesError) throw rolesError;
      const roleByProfile = new Map((roles ?? []).map((role) => [role.profile_id, role.role_code]));
      return json({
        staff: (memberships ?? [])
          .map((membership) => ({
            ...(membership.profiles as unknown as Profile),
            membershipStatus: membership.status,
            invitedAt: membership.invited_at,
            activatedAt: membership.activated_at,
            role: roleByProfile.get(membership.profile_id),
          }))
          .filter((member) => member.role === "faculty" || member.role === "staff"),
      });
    }
    if (request.method !== "PATCH") return new Response("Method Not Allowed", { status: 405 });
    const update = normalizeUpdate(await requestBody(request));
    if (!update) return json({ error: "Provide a valid staff management action." }, 400);
    await updateMember(db, context, update);
    return json({ ok: true });
  } catch (error) {
    console.error("[staff-management] failed", error);
    return json(
      { error: error instanceof Error ? error.message : "The staff account could not be updated." },
      422,
    );
  }
}
