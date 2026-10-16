/** Run only after the designated tester confirms the single enrolled device is offline. */
import { createClient } from "@supabase/supabase-js";
import {
  sendOfflineDeliveryTest,
  OFFLINE_TEST_TTL_SECONDS,
} from "../src/lib/server/fcm-provider.ts";

if (!process.argv.includes("--confirmed-offline"))
  throw new Error("Human confirmation that the designated test device is offline is required");
if (process.env.FIREBASE_PROJECT_ID !== "attendai-41f64") throw new Error("Wrong Firebase project");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: activePolicies, error: policyError } = await db
  .from("policy_versions")
  .select("policy_type,version")
  .eq("active", true);
if (
  policyError ||
  activePolicies?.length !== 2 ||
  activePolicies.some((row) => row.version !== "2026-10-15.1")
)
  throw new Error("Policy migration must be deployed before offline trial");
const privacyResponse = await fetch(new URL("/privacy", process.env.ATTENDAI_APP_URL));
if (!privacyResponse.ok || !(await privacyResponse.text()).includes("2026-10-15.1"))
  throw new Error("Production application update is not deployed; no send attempted");
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
  throw new Error("Controlled guardian is unavailable");
const guardian = guardians[0];
const { data: devices, error: deviceError } = await db
  .from("guardian_notification_installations")
  .select(
    "id,firebase_installation_id,active,permission_state,firebase_project_id,revoked_at,last_seen_at",
  )
  .eq("institution_id", guardian.institution_id)
  .eq("guardian_id", guardian.id)
  .eq("active", true);
if (deviceError) throw new Error("Device check failed");
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
if (devices.length !== 1 || suitable.length !== 1)
  throw new Error("Exactly one active current-project device is required");
const executionKey = "offline-reconnect-2026-10-15-attendance-test-guardian-v1";
const { data: trial, error: insertError } = await db
  .from("controlled_push_tests")
  .insert({
    institution_id: guardian.institution_id,
    guardian_id: guardian.id,
    installation_id: suitable[0].id,
    execution_key: executionKey,
    status: "sending",
    ttl_seconds: OFFLINE_TEST_TTL_SECONDS,
  })
  .select("id")
  .single();
if (insertError || !trial)
  throw new Error("Test already used or could not be recorded; no send attempted");
console.log(
  "OFFLINE TEST PREFLIGHT: one device; attendai-41f64; TTL 300 seconds; no attendance claim",
);
const result = await sendOfflineDeliveryTest({
  installationId: suitable[0].firebase_installation_id,
  testId: trial.id,
});
const status = result.ok
  ? "provider_accepted"
  : result.kind === "unconfirmed"
    ? "unconfirmed"
    : "failed";
const { error: updateError } = await db
  .from("controlled_push_tests")
  .update({ status, provider_message_id: result.ok ? result.providerId : null })
  .eq("id", trial.id)
  .eq("institution_id", guardian.institution_id)
  .eq("status", "sending");
if (updateError)
  throw new Error("Provider result persistence failed; reconcile manually without resending");
console.log(
  JSON.stringify({
    status,
    providerAccepted: result.ok,
    providerMessageIdStored: result.ok,
    ttlSeconds: OFFLINE_TEST_TTL_SECONDS,
    displayConfirmed: "UNKNOWN",
  }),
);
