/** Exactly one designated guardian, student, device and existing absence. */
import { createClient } from "@supabase/supabase-js";
import { processPushJobs, renderPushPayload } from "../src/lib/server/push-worker.ts";
import {
  verifyFcmAdminAuthentication,
  sendGuardianNotification,
} from "../src/lib/server/fcm-provider.ts";
import { randomUUID } from "node:crypto";
import { isFreshAttendanceSession } from "../src/lib/server/attendance-freshness.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration is missing");
if (process.env.FIREBASE_PROJECT_ID !== "attendai-41f64") throw new Error("Wrong Firebase project");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: guardians, error: guardianError } = await db
  .from("parents")
  .select("id,institution_id,name,active,communication_consent,language")
  .eq("name", "Attendance Test Guardian");
if (
  guardianError ||
  guardians?.length !== 1 ||
  !guardians[0].active ||
  !guardians[0].communication_consent
)
  throw new Error("Controlled guardian is unavailable");
const guardian = guardians[0];
const { data: relationships, error: relationshipError } = await db
  .from("student_parents")
  .select("student_id,receives_notifications,students!inner(name,institution_id,enrollment_status)")
  .eq("institution_id", guardian.institution_id)
  .eq("parent_id", guardian.id);
if (relationshipError) throw new Error("Relationship lookup failed");
const matching = relationships.filter(
  (row) =>
    row.students?.name === "Student One" &&
    row.students?.institution_id === guardian.institution_id &&
    row.students?.enrollment_status === "active" &&
    row.receives_notifications === true,
);
if (matching.length !== 1) throw new Error("Student One relationship is unavailable");
const student = matching[0];
const { data: devices, error: deviceError } = await db
  .from("guardian_notification_installations")
  .select(
    "id,firebase_installation_id,active,permission_state,firebase_project_id,revoked_at,last_seen_at",
  )
  .eq("institution_id", guardian.institution_id)
  .eq("guardian_id", guardian.id)
  .eq("active", true);
if (deviceError) throw new Error("Device lookup failed");
const { data: consents, error: consentError } = await db
  .from("guardian_notification_consents")
  .select("installation_id,status,consent_version,revoked_at")
  .eq("institution_id", guardian.institution_id)
  .eq("guardian_id", guardian.id);
if (consentError) throw new Error("Guardian notification consent check failed");
const suitable = devices.filter(
  (device) =>
    device.firebase_project_id === "attendai-41f64" &&
    device.permission_state === "granted" &&
    !device.revoked_at &&
    Date.parse(device.last_seen_at) >= Date.now() - 90 * 86400000 &&
    (consents ?? []).some(
      (consent) =>
        consent.installation_id === device.id &&
        consent.status === "accepted" &&
        !consent.revoked_at &&
        consent.consent_version === "2026-10-16.1",
    ),
);
if (suitable.length !== 1)
  throw new Error("Exactly one active consented current-project device required");
const { data: absences, error: attendanceError } = await db
  .from("attendance_records")
  .select("session_id,status,attendance_sessions!inner(date,status,institution_id,created_at)")
  .eq("institution_id", guardian.institution_id)
  .eq("student_id", student.student_id)
  .eq("status", "absent")
  .order("created_at", { ascending: false })
  .limit(20);
if (attendanceError) throw new Error("Attendance lookup failed");
let candidate;
for (const row of absences) {
  const session = row.attendance_sessions;
  if (
    session.status !== "submitted" ||
    session.institution_id !== guardian.institution_id ||
    !isFreshAttendanceSession(session)
  )
    continue;
  const { count, error } = await db
    .from("communications")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", guardian.institution_id)
    .eq("student_id", student.student_id)
    .eq("parent_id", guardian.id)
    .eq("type", "push")
    .contains("metadata", { attendance_session_id: row.session_id });
  if (error) throw new Error("FCM duplicate check failed");
  if (count === 0) {
    candidate = row;
    break;
  }
}
if (!candidate) throw new Error("No recent safe unsent existing absence found; no send attempted");
const { data: institution, error: institutionError } = await db
  .from("institutions")
  .select("name")
  .eq("id", guardian.institution_id)
  .maybeSingle();
if (institutionError) throw new Error("Message rendering inputs unavailable");
const message = renderPushPayload({
  communication: {
    metadata: {
      attendance_date: candidate.attendance_sessions.date,
    },
  },
  guardian,
  student: student.students,
  institutionName: institution?.name ?? "the institution",
});
const preflight = `ONLINE FCM PREFLIGHT\nGuardian: Attendance Test Guardian\nStudent: Student One\nAttendance date: ${candidate.attendance_sessions.date}\nDevice count: 1\nFirebase project: attendai-41f64\nConsent: PASS\nreceives_notifications: PASS\nCurrent absence: PASS\nIdempotency: PASS\nMessage title: ${message.title}\nMessage body: ${message.body}`;
if (!process.argv.includes("--send")) {
  console.log(preflight);
  process.exit(0);
}
const { data: activePolicies, error: policyError } = await db
  .from("policy_versions")
  .select("policy_type,version")
  .eq("active", true);
if (
  policyError ||
  activePolicies?.length !== 2 ||
  activePolicies.some((row) => row.version !== "2026-10-15.1")
)
  throw new Error("Policy migration and matching content must be deployed before the trial");
const privacyResponse = await fetch(new URL("/privacy", process.env.ATTENDAI_APP_URL));
if (!privacyResponse.ok || !(await privacyResponse.text()).includes("2026-10-15.1"))
  throw new Error("Production application update is not deployed; no send attempted");
await verifyFcmAdminAuthentication();
const validation = await sendGuardianNotification(
  {
    installationId: suitable[0].firebase_installation_id,
    title: message.title,
    body: message.body,
    communicationId: randomUUID(),
    idempotencyKey: "controlled-attendance-validation-only",
  },
  true,
);
if (!validation.ok) throw new Error(`FCM validation failed: ${validation.code}; no send attempted`);
console.log("FCM CONTROLLED PREFLIGHT PASSED");
if (!isFreshAttendanceSession(candidate.attendance_sessions))
  throw new Error("Attendance is now too old for a safe alert; no send attempted");
const { data: queued, error: queueError } = await db.rpc("enqueue_existing_absence_push", {
  p_session: candidate.session_id,
  p_student: student.student_id,
  p_guardian: guardian.id,
  p_installation: suitable[0].id,
});
if (queueError || queued?.length !== 1)
  throw new Error("Atomic trial enqueue rejected; no send attempted");
console.log(`${preflight}\nRate limit: PASS`);
const result = await processPushJobs(1, {
  targetJobId: queued[0].job_id,
  requireSingleInstallation: true,
});
const [{ data: communication }, { data: job }, { data: dispatch }] = await Promise.all([
  db
    .from("communications")
    .select("message_status,provider_message_id")
    .eq("id", queued[0].communication_id)
    .maybeSingle(),
  db.from("communication_jobs").select("status").eq("id", queued[0].job_id).maybeSingle(),
  db
    .from("communication_dispatches")
    .select("status,provider_message_id,display_acknowledged_at")
    .eq("communication_id", queued[0].communication_id)
    .eq("installation_id", suitable[0].id)
    .maybeSingle(),
]);
console.log(
  JSON.stringify({
    providerAccepted: dispatch?.status === "provider_accepted",
    providerMessageIdStored: Boolean(dispatch?.provider_message_id),
    communicationStatus: communication?.message_status ?? "UNKNOWN",
    jobStatus: job?.status ?? "UNKNOWN",
    dispatchStatus: dispatch?.status ?? "UNKNOWN",
    deviceDisplayConfirmed: dispatch?.display_acknowledged_at ? "YES" : "UNKNOWN",
    claimed: result.claimed,
    completed: result.completed,
    retried: result.retried,
    failed: result.failed,
  }),
);
