import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration is missing");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: guardians, error } = await db
  .from("parents")
  .select("id,institution_id,name,active,communication_consent")
  .eq("name", "Attendance Test Guardian");
if (error) throw new Error(`Guardian lookup failed: ${error.message}`);
if (guardians.length !== 1) {
  console.log(`Controlled guardian matches: ${guardians.length}; no invitation created.`);
  process.exit(1);
}
const guardian = guardians[0];
const { data: devices, error: deviceError } = await db
  .from("guardian_notification_installations")
  .select("id,active,permission_state,firebase_project_id,revoked_at,last_seen_at")
  .eq("institution_id", guardian.institution_id)
  .eq("guardian_id", guardian.id);
if (deviceError) throw new Error("Device lookup failed");
const { data: consents, error: consentError } = await db
  .from("guardian_notification_consents")
  .select("installation_id,status,consent_version,revoked_at")
  .eq("institution_id", guardian.institution_id)
  .eq("guardian_id", guardian.id);
if (consentError) throw new Error("Guardian notification consent migration is unavailable");
const suitable = devices.filter(
  (device) =>
    device.active &&
    !device.revoked_at &&
    device.firebase_project_id === "attendai-41f64" &&
    device.permission_state === "granted" &&
    Date.parse(device.last_seen_at) >= Date.now() - 90 * 86400000 &&
    consents.some(
      (consent) =>
        consent.installation_id === device.id &&
        consent.status === "accepted" &&
        !consent.revoked_at &&
        consent.consent_version === "2026-10-16.1",
    ),
);
console.log(
  JSON.stringify({
    guardian: guardian.name,
    guardianActive: guardian.active,
    communicationConsent: guardian.communication_consent,
    suitableDeviceCount: suitable.length,
    oldProjectDeviceCount: devices.filter((device) => device.firebase_project_id === "siri-1b57c")
      .length,
  }),
);
if (process.argv.includes("--attendance")) {
  const { data: relationships, error: relationshipError } = await db
    .from("student_parents")
    .select("student_id,receives_notifications,students!inner(name,enrollment_status)")
    .eq("institution_id", guardian.institution_id)
    .eq("parent_id", guardian.id);
  if (relationshipError)
    throw new Error(`Relationship lookup failed: ${relationshipError.message}`);
  const studentOne = relationships.filter((row) => row.students?.name === "Student One");
  console.log(
    JSON.stringify({
      studentOneMatches: studentOne.length,
      receivesNotifications: studentOne[0]?.receives_notifications ?? null,
    }),
  );
  if (studentOne.length === 1) {
    const studentId = studentOne[0].student_id;
    const { data: absences, error: absenceError } = await db
      .from("attendance_records")
      .select("session_id,status,attendance_sessions!inner(date,status,institution_id)")
      .eq("institution_id", guardian.institution_id)
      .eq("student_id", studentId)
      .eq("status", "absent")
      .order("created_at", { ascending: false })
      .limit(20);
    if (absenceError) throw new Error(`Attendance lookup failed: ${absenceError.message}`);
    for (const absence of absences) {
      const { count, error: communicationError } = await db
        .from("communications")
        .select("id", { count: "exact", head: true })
        .eq("institution_id", guardian.institution_id)
        .eq("student_id", studentId)
        .eq("parent_id", guardian.id)
        .eq("type", "push")
        .contains("metadata", { attendance_session_id: absence.session_id });
      if (communicationError)
        throw new Error(`Dispatch lookup failed: ${communicationError.message}`);
      console.log(
        JSON.stringify({
          student: "Student One",
          date: absence.attendance_sessions?.date,
          sessionStatus: absence.attendance_sessions?.status,
          currentStatus: absence.status,
          priorPushCommunications: count,
        }),
      );
    }
  }
}
if (!process.argv.includes("--invite") && !process.argv.includes("--check-invitation"))
  process.exit(0);
if (suitable.length !== 0 || !guardian.active || !guardian.communication_consent)
  throw new Error("Guardian is not eligible for a new controlled enrollment link");
const appUrl = process.env.ATTENDAI_APP_URL;
if (!appUrl || new URL(appUrl).protocol !== "https:") throw new Error("HTTPS app URL is required");
const { data: creator, error: creatorError } = await db
  .from("profile_roles")
  .select(
    "profile_id,profiles!profile_roles_profile_id_fkey!inner(status),profile_institutions!profile_roles_membership_fkey!inner(status),institutions!inner(status)",
  )
  .eq("institution_id", guardian.institution_id)
  .in("role_code", ["admin", "staff"])
  .eq("profiles.status", "active")
  .eq("profile_institutions.status", "active")
  .eq("institutions.status", "active")
  .limit(1)
  .maybeSingle();
if (creatorError || !creator) throw new Error("No authorized staff creator found");
const { count: studentCount, error: studentError } = await db
  .from("student_parents")
  .select("student_id,students!inner(name,enrollment_status,institution_id)", {
    count: "exact",
    head: true,
  })
  .eq("parent_id", guardian.id)
  .eq("institution_id", guardian.institution_id)
  .eq("receives_notifications", true)
  .eq("students.name", "Student One")
  .eq("students.enrollment_status", "active")
  .eq("students.institution_id", guardian.institution_id);
if (studentError || studentCount !== 1)
  throw new Error("The eligible Student One relationship is unavailable");
const { count: invitationCount, error: pendingError } = await db
  .from("guardian_notification_invitations")
  .select("id", { count: "exact", head: true })
  .eq("institution_id", guardian.institution_id)
  .eq("guardian_id", guardian.id)
  .is("consumed_at", null)
  .is("revoked_at", null)
  .gt("expires_at", new Date().toISOString());
if (pendingError || invitationCount)
  throw new Error("An enrollment invitation is already pending or could not be checked");
if (!process.argv.includes("--invite")) {
  console.log(
    JSON.stringify({
      invitationEligibility: "PASS",
      authorizedStaff: true,
      eligibleStudent: "Student One",
    }),
  );
  process.exit(0);
}
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const { error: inviteError } = await db.from("guardian_notification_invitations").insert({
  institution_id: guardian.institution_id,
  guardian_id: guardian.id,
  token_hash: tokenHash,
  created_by: creator.profile_id,
  expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
});
if (inviteError) throw new Error("Enrollment invitation could not be created");
const link = new URL("/guardian-notifications", appUrl);
link.hash = `invite=${token}`;
console.log(`GUARDIAN DEVICE ENROLLMENT REQUIRED — ${link}`);
