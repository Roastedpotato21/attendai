/** Invitation and device APIs. All table access is through trusted server code. */
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GUARDIAN_NOTIFICATION_CONSENT_VERSION } from "../guardian-consent.ts";

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
class RequestBodyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    throw new RequestBodyError("JSON body required", 415);
  const limit = 4096;
  if (Number(request.headers.get("content-length")) > limit)
    throw new RequestBodyError("Request body too large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError("Invalid JSON body", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RequestBodyError("Request body too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new RequestBodyError("Invalid JSON body", 400);
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

function linkedStudent(
  value: unknown,
): { name?: string; enrollment_status?: string; institution_id?: string } | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === "object"
    ? (item as { name?: string; enrollment_status?: string; institution_id?: string })
    : null;
}

async function staffContext(request: Request, database: SupabaseClient) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) return null;
  const { data: auth, error: authError } = await database.auth.getUser(bearer.slice(7));
  if (authError || !auth.user) return null;
  const { data: roles, error: rolesError } = await database.rpc(
    "authorized_staff_admin_institutions",
    { p_user: auth.user.id },
  );
  if (rolesError) throw new Error("Unable to verify staff membership");
  const memberships = (roles ?? []) as { institution_id: string; profile_id: string }[];
  const ids = [...new Set(memberships.map((row) => row.institution_id))];
  return ids.length === 1
    ? { profileId: memberships[0]!.profile_id, institutionId: ids[0]! }
    : null;
}

/** Staff list, invitation creation and device revocation. */
export async function handleGuardianNotificationAdmin(request: Request): Promise<Response> {
  if (!sameOrigin(request) && request.method !== "GET") return json({ error: "Forbidden" }, 403);
  try {
    const database = db();
    const context = await staffContext(request, database);
    if (!context) return json({ error: "Forbidden" }, 403);
    if (request.method === "GET") {
      const [
        { data: guardians, error: guardianError },
        { data: devices, error: deviceError },
        { data: relationships, error: relationshipError },
        { data: consents, error: consentError },
      ] = await Promise.all([
        database
          .from("parents")
          .select("id,name,communication_consent,active")
          .eq("institution_id", context.institutionId)
          .order("name")
          .limit(1000),
        database
          .from("guardian_notification_installations")
          .select("id,guardian_id,active,permission_state,created_at,last_seen_at,revoked_at")
          .eq("institution_id", context.institutionId)
          .limit(5000),
        database
          .from("guardian_current_relationships")
          .select("parent_id,receives_notifications,students!inner(name,enrollment_status)")
          .eq("institution_id", context.institutionId)
          .limit(5000),
        database
          .from("guardian_notification_consents")
          .select("guardian_id,installation_id,status,consent_version,accepted_at,revoked_at")
          .eq("institution_id", context.institutionId)
          .limit(5000),
      ]);
      if (guardianError || deviceError || relationshipError || consentError)
        throw new Error("Unable to list guardian devices");
      return json({
        guardians: (guardians ?? []).map((guardian) => ({
          id: guardian.id,
          name: guardian.name,
          communicationConsent: guardian.communication_consent,
          active: guardian.active,
          students: (relationships ?? [])
            .filter((relationship) => relationship.parent_id === guardian.id)
            .map((relationship) => ({
              name: linkedStudent(relationship.students)?.name,
              receivesNotifications: relationship.receives_notifications,
            }))
            .filter((student) => Boolean(student.name)),
          devices: (devices ?? [])
            .filter((device) => device.guardian_id === guardian.id)
            .map((device) => ({
              id: device.id,
              active: device.active,
              permission: device.permission_state,
              registeredAt: device.created_at,
              lastSeenAt: device.last_seen_at,
              revokedAt: device.revoked_at,
              consent: (consents ?? []).some(
                (consent) =>
                  consent.installation_id === device.id &&
                  consent.status === "accepted" &&
                  !consent.revoked_at &&
                  consent.consent_version === GUARDIAN_NOTIFICATION_CONSENT_VERSION,
              ),
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
    const { count: linkedCount, error: linkedError } = await database
      .from("guardian_current_relationships")
      .select("student_id,students!inner(id)", { head: true, count: "exact" })
      .eq("institution_id", context.institutionId)
      .eq("parent_id", guardian.id)
      .eq("receives_notifications", true)
      .eq("students.enrollment_status", "active");
    if (linkedError) throw new Error("Unable to verify linked students");
    if (!linkedCount) return json({ error: "No eligible linked student" }, 409);
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
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
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
  try {
    const input = await body(request);
    const database = db();
    if (path.endsWith("/validate") || path.endsWith("/enroll")) {
      const invitation = input["invitation"];
      if (typeof invitation !== "string" || !invitationPattern.test(invitation))
        return json({ valid: false }, 400);
      const tokenHash = sha256(invitation);
      if (path.endsWith("/validate")) {
        const { data, error } = await database
          .from("guardian_notification_invitations")
          .select("institution_id,guardian_id")
          .eq("token_hash", tokenHash)
          .is("consumed_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (error) throw new Error("Unable to validate invitation");
        if (!data) return json({ valid: false });
        const [
          { data: institution, error: institutionError },
          { data: guardian, error: guardianError },
          { data: relationships, error: relationshipError },
        ] = await Promise.all([
          database
            .from("institutions")
            .select("name,status")
            .eq("id", data.institution_id)
            .maybeSingle(),
          database
            .from("parents")
            .select("active,communication_consent")
            .eq("id", data.guardian_id)
            .eq("institution_id", data.institution_id)
            .maybeSingle(),
          database
            .from("guardian_current_relationships")
            .select("student_id,students!inner(name,enrollment_status,institution_id)")
            .eq("institution_id", data.institution_id)
            .eq("parent_id", data.guardian_id)
            .eq("receives_notifications", true),
        ]);
        if (institutionError || guardianError || relationshipError)
          throw new Error("Unable to verify invitation context");
        const students = (relationships ?? [])
          .filter(
            (relationship) =>
              linkedStudent(relationship.students)?.enrollment_status === "active" &&
              linkedStudent(relationship.students)?.institution_id === data.institution_id,
          )
          .map((relationship) => linkedStudent(relationship.students)?.name)
          .filter((name): name is string => typeof name === "string");
        if (
          institution?.status !== "active" ||
          !guardian?.active ||
          !guardian.communication_consent ||
          students.length === 0
        )
          return json({ valid: false });
        return json({
          valid: true,
          institution: institution.name,
          students: [...new Set(students)],
          consentVersion: GUARDIAN_NOTIFICATION_CONSENT_VERSION,
        });
      }
      const fid = input["installationId"];
      if (
        input["consent"] !== true ||
        input["consentVersion"] !== GUARDIAN_NOTIFICATION_CONSENT_VERSION
      )
        return json({ error: "Current notification consent required" }, 400);
      if (typeof fid !== "string" || !fidPattern.test(fid))
        return json({ error: "Invalid device" }, 400);
      const secret = randomBytes(32).toString("base64url");
      const { data, error } = await database.rpc(
        "consume_guardian_notification_invitation_with_consent",
        {
          p_token_hash: tokenHash,
          p_fid: fid,
          p_device_secret_hash: sha256(secret),
          p_project_id: "attendai-41f64",
          p_consent_version: GUARDIAN_NOTIFICATION_CONSENT_VERSION,
        },
      );
      if (error || !data) return json({ error: "Invitation unavailable" }, 410);
      return json({ enabled: true }, 201, { "set-cookie": deviceCookie(secret) });
    }
    const secret = cookie(request);
    if (!secret) return json({ enabled: false }, 401);
    const { data: device, error: deviceError } = await database
      .from("guardian_notification_installations")
      .select(
        "id,institution_id,guardian_id,active,permission_state,firebase_project_id,revoked_at",
      )
      .eq("device_secret_hash", sha256(secret))
      .maybeSingle();
    if (deviceError || !device || !device.active || device.revoked_at)
      return json({ enabled: false }, 401);
    const { data: activeConsent, error: consentError } = await database
      .from("guardian_notification_consents")
      .select("id")
      .eq("institution_id", device.institution_id)
      .eq("installation_id", device.id)
      .eq("status", "accepted")
      .eq("consent_version", GUARDIAN_NOTIFICATION_CONSENT_VERSION)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    if (consentError) throw new Error("Unable to verify guardian notification consent");
    if (path === "/api/guardian/notifications/status")
      return json({
        enabled: Boolean(activeConsent) && device.firebase_project_id === "attendai-41f64",
        permission: device.permission_state,
        migrationRequired: device.firebase_project_id !== "attendai-41f64",
        consentRequired: !activeConsent,
      });
    if (!activeConsent && !path.endsWith("/permission") && !path.endsWith("/revoke"))
      return json({ error: "New guardian notification consent required" }, 403);
    if (path.endsWith("/test-acknowledge")) {
      const testId = input["testId"];
      if (typeof testId !== "string" || !uuid.test(testId))
        return json({ error: "Invalid test" }, 400);
      const { data: test, error: testError } = await database
        .from("controlled_push_tests")
        .select("id,status,display_acknowledged_at")
        .eq("id", testId)
        .eq("institution_id", device.institution_id)
        .eq("guardian_id", device.guardian_id)
        .eq("installation_id", device.id)
        .maybeSingle();
      if (testError || !test || test.status !== "provider_accepted")
        return json({ error: "Test unavailable" }, 404);
      if (!test.display_acknowledged_at) {
        const { error } = await database
          .from("controlled_push_tests")
          .update({ display_acknowledged_at: new Date().toISOString() })
          .eq("id", test.id)
          .eq("institution_id", device.institution_id)
          .is("display_acknowledged_at", null);
        if (error) throw new Error("Unable to acknowledge test notification");
      }
      return json({ acknowledged: true });
    }
    if (path.endsWith("/event-status") || path.endsWith("/acknowledge")) {
      const eventId = input["communicationId"];
      if (typeof eventId !== "string" || !uuid.test(eventId))
        return json({ error: "Invalid event" }, 400);
      const { data: dispatch, error: dispatchError } = await database
        .from("communication_dispatches")
        .select("id,status,display_acknowledged_at")
        .eq("communication_id", eventId)
        .eq("installation_id", device.id)
        .eq("guardian_id", device.guardian_id)
        .eq("institution_id", device.institution_id)
        .maybeSingle();
      if (dispatchError || !dispatch || dispatch.status !== "provider_accepted")
        return json({ error: "Event unavailable" }, 404);
      if (path.endsWith("/acknowledge")) {
        if (!dispatch.display_acknowledged_at) {
          const { error } = await database
            .from("communication_dispatches")
            .update({ display_acknowledged_at: new Date().toISOString() })
            .eq("id", dispatch.id)
            .eq("institution_id", device.institution_id)
            .is("display_acknowledged_at", null);
          if (error) throw new Error("Unable to acknowledge notification");
        }
        return json({ acknowledged: true });
      }
      const { data: communication, error: communicationError } = await database
        .from("communications")
        .select("student_id,metadata")
        .eq("id", eventId)
        .eq("institution_id", device.institution_id)
        .eq("parent_id", device.guardian_id)
        .maybeSingle();
      if (communicationError || !communication) return json({ error: "Event unavailable" }, 404);
      if (
        (communication.metadata as Record<string, unknown> | null)?.["purpose"] ===
        "period-attendance"
      ) {
        const { data, error } = await database.rpc("period_guardian_event_status", {
          p_communication: eventId,
          p_installation: device.id,
        });
        if (error) throw new Error("Unable to verify period notification access");
        if (!data) return json({ error: "Event unavailable" }, 404);
        const statuses: Record<string, string> = {
          present: "Present",
          absent: "Absent",
          approved_leave: "Approved Leave",
        };
        const facts = data.facts as { subject: string; period: string; status: string }[];
        return json({
          message: `${data.date}: ${facts.map((f) => `${f.subject}, ${f.period}: ${statuses[f.status] ?? "unavailable"}`).join("; ")}`,
          kind: data.kind,
        });
      }
      // A historical dispatch is not continuing authority to view a student's records.
      const [guardianResult, relationshipResult, institutionResult, studentResult] =
        await Promise.all([
          database
            .from("parents")
            .select("active,communication_consent")
            .eq("id", device.guardian_id)
            .eq("institution_id", device.institution_id)
            .maybeSingle(),
          database
            .from("guardian_current_relationships")
            .select("receives_notifications")
            .eq("parent_id", device.guardian_id)
            .eq("student_id", communication.student_id)
            .eq("institution_id", device.institution_id)
            .maybeSingle(),
          database
            .from("institutions")
            .select("status")
            .eq("id", device.institution_id)
            .maybeSingle(),
          database
            .from("students")
            .select("enrollment_status")
            .eq("id", communication.student_id)
            .eq("institution_id", device.institution_id)
            .maybeSingle(),
        ]);
      if (
        [guardianResult, relationshipResult, institutionResult, studentResult].some(
          (result) => result.error,
        )
      )
        throw new Error("Unable to verify current guardian access");
      if (
        !guardianResult.data?.active ||
        !guardianResult.data?.communication_consent ||
        !relationshipResult.data?.receives_notifications ||
        institutionResult.data?.status !== "active" ||
        studentResult.data?.enrollment_status !== "active"
      )
        return json({ error: "Event unavailable" }, 404);
      const sessionId = (communication.metadata as Record<string, unknown> | null)?.[
        "attendance_session_id"
      ];
      if (typeof sessionId !== "string" || !uuid.test(sessionId))
        return json({ error: "Event unavailable" }, 404);
      const { data: attendance, error: attendanceError } = await database
        .from("attendance_records")
        .select("status")
        .eq("institution_id", device.institution_id)
        .eq("student_id", communication.student_id)
        .eq("session_id", sessionId)
        .maybeSingle();
      if (attendanceError) throw new Error("Unable to verify attendance");
      return json({ currentStatus: attendance?.status ?? "unavailable" });
    }
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
      const { error: consentError } = await database
        .from("guardian_notification_consents")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("institution_id", device.institution_id)
        .eq("installation_id", device.id)
        .eq("status", "accepted");
      if (consentError) throw new Error("Unable to revoke notification consent");
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
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    console.error(
      "[guardian-notifications] device operation failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "Guardian notification operation unavailable" }, 503);
  }
}
