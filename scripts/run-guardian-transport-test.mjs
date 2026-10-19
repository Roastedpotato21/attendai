/** One accountless guardian transport test, with no attendance claim. */
import { createClient } from "@supabase/supabase-js";
import {
  sendGuardianTransportTest,
  verifyFcmAdminAuthentication,
} from "../src/lib/server/fcm-provider.ts";

const mode = process.argv.slice(2);
if (mode.length !== 1 || !["--preflight", "--validate", "--send", "--status"].includes(mode[0]))
  throw new Error("Choose exactly one of --preflight, --validate, --send, or --status");
if (process.env.FIREBASE_PROJECT_ID !== "attendai-41f64")
  throw new Error("Wrong Firebase project; no send attempted");
const appUrl = new URL(process.env.ATTENDAI_APP_URL);
if (appUrl.protocol !== "https:") throw new Error("HTTPS application URL required");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: guardians, error: guardianError } = await db
  .from("parents")
  .select("id,institution_id,active,communication_consent")
  .eq("name", "Attendance Test Guardian");
if (
  guardianError ||
  guardians?.length !== 1 ||
  !guardians[0].active ||
  !guardians[0].communication_consent
)
  throw new Error("Designated guardian is unavailable or communication consent is off");
const guardian = guardians[0];
const executionKey = "guardian-transport-20261016-v1";
if (mode[0] === "--status") {
  const { data, error } = await db
    .from("controlled_push_tests")
    .select(
      "status,provider,provider_message_id,submitted_at,completed_at,failure_code,failure_reason,display_acknowledged_at",
    )
    .eq("institution_id", guardian.institution_id)
    .eq("guardian_id", guardian.id)
    .eq("execution_key", executionKey)
    .maybeSingle();
  if (error) throw new Error("Could not read the controlled test result");
  console.log(
    JSON.stringify({
      testReserved: Boolean(data),
      status: data?.status ?? "not_started",
      provider: data?.provider ?? "fcm",
      submittedAt: data?.submitted_at ?? null,
      failureReason: data?.failure_reason ?? null,
      providerAccepted: data?.status === "provider_accepted",
      providerMessageIdStored: Boolean(data?.provider_message_id),
      deviceReceiptAcknowledged: Boolean(data?.display_acknowledged_at),
      acknowledgedAt: data?.display_acknowledged_at ?? null,
    }),
  );
  process.exit(0);
}
const [institutionResult, relationshipResult, deviceResult, consentResult] = await Promise.all([
  db.from("institutions").select("status").eq("id", guardian.institution_id).maybeSingle(),
  db
    .from("student_parents")
    .select(
      "student_id,receives_notifications,students!inner(name,institution_id,enrollment_status)",
    )
    .eq("institution_id", guardian.institution_id)
    .eq("parent_id", guardian.id),
  db
    .from("guardian_notification_installations")
    .select(
      "id,firebase_installation_id,active,permission_state,firebase_project_id,revoked_at,last_seen_at",
    )
    .eq("institution_id", guardian.institution_id)
    .eq("guardian_id", guardian.id)
    .eq("active", true),
  db
    .from("guardian_notification_consents")
    .select("installation_id,status,consent_version,revoked_at")
    .eq("institution_id", guardian.institution_id)
    .eq("guardian_id", guardian.id),
]);
if (consentResult.error)
  throw new Error("Guardian notification consent records are unavailable; no FCM call attempted");
if (institutionResult.error || relationshipResult.error || deviceResult.error)
  throw new Error("Guardian transport preflight could not verify tenant, relationship and device");
if (institutionResult.data?.status !== "active") throw new Error("Institution is inactive");
const eligibleStudents = (relationshipResult.data ?? []).filter(
  (row) =>
    row.students?.name === "Student One" &&
    row.students?.institution_id === guardian.institution_id &&
    row.students?.enrollment_status === "active" &&
    row.receives_notifications === true,
);
if (eligibleStudents.length !== 1) throw new Error("Student One relationship is unavailable");
const studentName = eligibleStudents[0].students.name;
const devices = deviceResult.data ?? [];
const eligibleDevices = devices.filter(
  (device) =>
    device.active &&
    !device.revoked_at &&
    device.permission_state === "granted" &&
    device.firebase_project_id === "attendai-41f64" &&
    Date.parse(device.last_seen_at) >= Date.now() - 90 * 86400000 &&
    (consentResult.data ?? []).some(
      (consent) =>
        consent.installation_id === device.id &&
        consent.status === "accepted" &&
        !consent.revoked_at &&
        consent.consent_version === "2026-10-16.1",
    ),
);
if (eligibleDevices.length === 0) throw new Error("NO ACTIVE GUARDIAN DEVICE");
if (eligibleDevices.length > 1)
  throw new Error("MULTIPLE ACTIVE DEVICES — SELECT ONE BEFORE TESTING");
const device = eligibleDevices[0];
const body = `Notifications are enabled for ${studentName}. No attendance action is required.`;
console.log(
  JSON.stringify({
    guardian: "Attendance Test Guardian",
    student: studentName,
    deviceCount: 1,
    project: "attendai-41f64",
    communicationConsent: true,
    receivesNotifications: true,
    guardianNotificationConsent: true,
    title: "AttendAI Notification Test",
    body,
  }),
);
if (mode[0] === "--preflight") process.exit(0);

// An existing reservation fences all repeat runs, including uncertain outcomes.
const { data: priorTest, error: priorError } = await db
  .from("controlled_push_tests")
  .select("id")
  .eq("execution_key", executionKey)
  .maybeSingle();
if (priorError) throw new Error("Could not verify the one-attempt execution fence");
if (priorTest) throw new Error("The one authorized test was already reserved; no send attempted");

const { data: activePolicies, error: policyError } = await db
  .from("policy_versions")
  .select("policy_type,version")
  .eq("active", true);
if (
  policyError ||
  activePolicies?.length !== 2 ||
  activePolicies.some((row) => row.version !== "2026-10-15.1")
)
  throw new Error("Staff policy migration and matching application release required");
for (const path of ["/privacy", "/terms", "/guardian-notifications"]) {
  const response = await fetch(new URL(path, appUrl), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path} is not deployed; no send attempted`);
}
await verifyFcmAdminAuthentication();
const validation = await sendGuardianTransportTest(
  {
    installationId: device.firebase_installation_id,
    testId: "00000000-0000-4000-8000-000000000023",
    studentName,
  },
  true,
);
if (!validation.ok)
  throw new Error(
    `FCM validation failed: ${validation.safeReason ?? validation.code}; no send attempted`,
  );
console.log("FCM TEST PREFLIGHT PASSED");
if (mode[0] === "--validate") process.exit(0);

const { data: trial, error: insertError } = await db
  .from("controlled_push_tests")
  .insert({
    institution_id: guardian.institution_id,
    guardian_id: guardian.id,
    student_id: eligibleStudents[0].student_id,
    installation_id: device.id,
    execution_key: executionKey,
    status: "sending",
    provider: "fcm",
    submitted_at: new Date().toISOString(),
    ttl_seconds: 300,
  })
  .select("id")
  .single();
if (insertError || !trial)
  throw new Error("The one authorized test was already reserved; no send attempted");
const result = await sendGuardianTransportTest({
  installationId: device.firebase_installation_id,
  testId: trial.id,
  studentName,
});
const status = result.ok
  ? "provider_accepted"
  : result.kind === "unconfirmed"
    ? "unconfirmed"
    : "failed";
const { error: updateError } = await db
  .from("controlled_push_tests")
  .update({
    status,
    provider_message_id: result.ok ? result.providerId : null,
    completed_at: new Date().toISOString(),
    failure_code: result.ok ? null : result.code,
    failure_reason: result.ok ? null : (result.safeReason ?? result.code),
  })
  .eq("id", trial.id)
  .eq("institution_id", guardian.institution_id)
  .eq("status", "sending");
if (updateError)
  throw new Error("Provider outcome could not be stored; reconcile without resending");
console.log(
  JSON.stringify({
    providerAccepted: result.ok,
    providerMessageIdStored: result.ok,
    deviceDisplayObserved: "UNKNOWN",
    status,
    failureReason: result.ok ? null : (result.safeReason ?? result.code),
  }),
);
if (!result.ok) process.exitCode = 1;
