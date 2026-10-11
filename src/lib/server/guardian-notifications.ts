/** Invitation and device APIs. All table access is through trusted server code. */
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fidPattern = /^[A-Za-z0-9_:.-]{12,256}$/;
const invitationPattern = /^[A-Za-z0-9_-]{43}$/;
const cookieName = "attendai_guardian_device";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function db(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Supabase server credentials are unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const deployed = process.env["ATTENDAI_APP_URL"];
  try {
    return (
      origin === new URL(request.url).origin ||
      Boolean(deployed && origin === new URL(deployed).origin)
    );
  } catch {
    return false;
  }
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return {};
  try {
    const data: unknown = await request.json();
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function cookie(request: Request): string | null {
  const match = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)attendai_guardian_device=([A-Za-z0-9_-]{43})(?:;|$)/);
  return match?.[1] ?? null;
}
function deviceCookie(secret: string, maxAge = 60 * 60 * 24 * 180): string {
  return `${cookieName}=${secret}; Path=/api/guardian/notifications; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function staffContext(request: Request, database: SupabaseClient) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) return null;
  const { data: auth, error: authError } = await database.auth.getUser(bearer.slice(7));
  if (authError || !auth.user) return null;
  const { data: profile, error: profileError } = await database
    .from("profiles")
    .select("id,status")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.status !== "active") return null;
  const { data: roles, error: rolesError } = await database
    .from("profile_roles")
    .select("institution_id,profile_institutions!inner(status),institutions!inner(status)")
    .eq("profile_id", profile.id)
    .in("role_code", ["admin", "staff"])
    .eq("profile_institutions.status", "active")
    .eq("institutions.status", "active");
  if (rolesError) throw new Error("Unable to verify staff membership");
  const ids = [...new Set((roles ?? []).map((row) => String(row.institution_id)))];
  return ids.length === 1 ? { profileId: profile.id, institutionId: ids[0]! } : null;
}

/** Staff list, invitation creation and device revocation. */
export async function handleGuardianNotificationAdmin(request: Request): Promise<Response> {
  if (!sameOrigin(request) && request.method !== "GET") return json({ error: "Forbidden" }, 403);
  try {
    const database = db();
    const context = await staffContext(request, database);
    if (!context) return json({ error: "Forbidden" }, 403);
    if (request.method === "GET") {
      const [{ data: guardians, error: guardianError }, { data: devices, error: deviceError }] =
        await Promise.all([
          database
            .from("parents")
            .select("id,name,communication_consent,active")
            .eq("institution_id", context.institutionId)
            .order("name")
            .limit(1000),
          database
            .from("guardian_notification_installations")
            .select("id,guardian_id,active,permission_state")
            .eq("institution_id", context.institutionId)
            .limit(5000),
        ]);
      if (guardianError || deviceError) throw new Error("Unable to list guardian devices");
      return json({
        guardians: (guardians ?? []).map((guardian) => ({
          id: guardian.id,
          name: guardian.name,
          communicationConsent: guardian.communication_consent,
          active: guardian.active,
          devices: (devices ?? [])
            .filter((device) => device.guardian_id === guardian.id)
            .map((device) => ({
              id: device.id,
              active: device.active,
              permission: device.permission_state,
            })),
        })),
      });
    }
    if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
    const input = await body(request);
    if (input["action"] === "revoke") {
      const installationId = input["installationId"];
      if (typeof installationId !== "string" || !uuid.test(installationId))
        return json({ error: "Invalid device" }, 400);
      const { error } = await database
        .from("guardian_notification_installations")
        .update({
          active: false,
          revoked_at: new Date().toISOString(),
          failure_reason: "staff_revoked",
        })
        .eq("id", installationId)
        .eq("institution_id", context.institutionId);
      if (error) throw new Error("Unable to revoke device");
      return json({ ok: true });
    }
    if (
      input["action"] !== "invite" ||
      typeof input["guardianId"] !== "string" ||
      !uuid.test(input["guardianId"])
    )
      return json({ error: "Invalid guardian" }, 400);
    const { data: guardian, error: guardianError } = await database
      .from("parents")
      .select("id,active")
      .eq("institution_id", context.institutionId)
      .eq("id", input["guardianId"])
      .maybeSingle();
    if (guardianError || !guardian || !guardian.active)
      return json({ error: "Guardian unavailable" }, 404);
    const appUrl = process.env["ATTENDAI_APP_URL"];
    if (!appUrl || new URL(appUrl).protocol !== "https:")
      throw new Error("HTTPS app URL is required for guardian enrollment");
    const { count, error: quotaError } = await database
      .from("guardian_notification_invitations")
      .select("id", { head: true, count: "exact" })
      .eq("created_by", context.profileId)
      .eq("institution_id", context.institutionId)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
    if (quotaError) throw new Error("Unable to enforce invitation limit");
    if ((count ?? 0) >= 10) return json({ error: "Invitation limit reached" }, 429);
    const token = randomBytes(32).toString("base64url");
    const { error: inviteError } = await database.from("guardian_notification_invitations").insert({
      institution_id: context.institutionId,
      guardian_id: guardian.id,
      token_hash: sha256(token),
      created_by: context.profileId,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    if (inviteError) throw new Error("Unable to create invitation");
    const link = new URL("/guardian-notifications", appUrl);
    link.hash = `invite=${token}`;
    return json({ link: link.toString(), expiresInMinutes: 15 }, 201);
  } catch (error) {
    console.error(
      "[guardian-notifications] staff operation failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "Guardian notification operation unavailable" }, 503);
  }
}

/** Minimal public API. A valid invitation or secure device cookie is required. */
export async function handleGuardianNotificationDevice(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
  const input = await body(request);
  try {
    const database = db();
    if (path.endsWith("/validate") || path.endsWith("/enroll")) {
      const invitation = input["invitation"];
      if (typeof invitation !== "string" || !invitationPattern.test(invitation))
        return json({ valid: false }, 400);
      const tokenHash = sha256(invitation);
      if (path.endsWith("/validate")) {
        const { data, error } = await database
          .from("guardian_notification_invitations")
          .select("id")
          .eq("token_hash", tokenHash)
          .is("consumed_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (error) throw new Error("Unable to validate invitation");
        return json({ valid: Boolean(data) });
      }
      const fid = input["installationId"];
      if (typeof fid !== "string" || !fidPattern.test(fid))
        return json({ error: "Invalid device" }, 400);
      const secret = randomBytes(32).toString("base64url");
      const { data, error } = await database.rpc("consume_guardian_notification_invitation", {
        p_token_hash: tokenHash,
        p_fid: fid,
        p_device_secret_hash: sha256(secret),
        p_project_id: "attendai-41f64",
      });
      if (error || !data) return json({ error: "Invitation unavailable" }, 410);
      return json({ enabled: true }, 201, { "set-cookie": deviceCookie(secret) });
    }
    const secret = cookie(request);
    if (!secret) return json({ enabled: false }, 401);
    const { data: device, error: deviceError } = await database
      .from("guardian_notification_installations")
      .select("id,institution_id,guardian_id,active,permission_state,firebase_project_id")
      .eq("device_secret_hash", sha256(secret))
      .maybeSingle();
    if (deviceError || !device || !device.active) return json({ enabled: false }, 401);
    if (path.endsWith("/status"))
      return json({
        enabled: device.firebase_project_id === "attendai-41f64",
        permission: device.permission_state,
        migrationRequired: device.firebase_project_id !== "attendai-41f64",
      });
    if (path.endsWith("/permission")) {
      if (input["permission"] !== "denied" && input["permission"] !== "default")
        return json({ error: "Invalid permission state" }, 400);
      const { error } = await database
        .from("guardian_notification_installations")
        .update({
          permission_state: input["permission"],
          active: false,
          revoked_at: new Date().toISOString(),
          failure_reason: "permission_removed",
        })
        .eq("id", device.id)
        .eq("institution_id", device.institution_id);
      if (error) throw new Error("Unable to update permission state");
      return json({ enabled: false });
    }
    if (path.endsWith("/revoke")) {
      const { error } = await database
        .from("guardian_notification_installations")
        .update({
          active: false,
          revoked_at: new Date().toISOString(),
          failure_reason: "guardian_revoked",
        })
        .eq("id", device.id)
        .eq("institution_id", device.institution_id);
      if (error) throw new Error("Unable to revoke device");
      return json({ enabled: false }, 200, { "set-cookie": deviceCookie("", 0) });
    }
    if (path.endsWith("/refresh")) {
      const fid = input["installationId"];
      const permission = input["permission"];
      if (
        typeof fid !== "string" ||
        !fidPattern.test(fid) ||
        !["granted", "denied", "default"].includes(String(permission))
      )
        return json({ error: "Invalid device state" }, 400);
      if (permission !== "granted") return json({ error: "Permission is required" }, 400);
      const newSecret = randomBytes(32).toString("base64url");
      const { data, error } = await database.rpc("refresh_guardian_notification_installation", {
        p_old_secret_hash: sha256(secret),
        p_new_secret_hash: sha256(newSecret),
        p_fid: fid,
        p_project_id: "attendai-41f64",
      });
      if (error || !data) return json({ error: "Device could not be refreshed" }, 409);
      return json({ enabled: true }, 200, { "set-cookie": deviceCookie(newSecret) });
    }
    return json({ error: "Not Found" }, 404);
  } catch (error) {
    console.error(
      "[guardian-notifications] device operation failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "Guardian notification operation unavailable" }, 503);
  }
}
