/** One online FCM test to the designated guardian device, without an attendance claim. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  sendControlledDeliveryTest,
  verifyFcmAdminAuthentication,
} from "../src/lib/server/fcm-provider.ts";

const sending = process.argv.includes("--send");
if (!sending && !process.argv.includes("--preflight"))
  throw new Error("Choose --preflight or --send");
if (process.env.FIREBASE_PROJECT_ID !== "attendai-41f64")
  throw new Error("Unexpected Firebase project");
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
  throw new Error("Designated guardian is unavailable or lacks consent");
const guardian = guardians[0];
const { data: institution, error: institutionError } = await db
  .from("institutions")
  .select("status")
  .eq("id", guardian.institution_id)
  .single();
if (institutionError || institution?.status !== "active")
  throw new Error("Guardian institution is unavailable");
const { data: devices, error: deviceError } = await db
  .from("guardian_notification_installations")
  .select(
    "id,firebase_installation_id,permission_state,firebase_project_id,revoked_at,last_seen_at",
  )
  .eq("institution_id", guardian.institution_id)
  .eq("guardian_id", guardian.id)
  .eq("active", true);
if (deviceError || devices?.length !== 1) throw new Error("Exactly one active device required");
const device = devices[0];
const { data: consent, error: consentError } = await db
  .from("guardian_notification_consents")
  .select("id")
  .eq("institution_id", guardian.institution_id)
  .eq("installation_id", device.id)
  .eq("status", "accepted")
  .eq("consent_version", "2026-10-16.1")
  .is("revoked_at", null)
  .maybeSingle();
if (
  consentError ||
  !consent ||
  !device.firebase_installation_id ||
  device.permission_state !== "granted" ||
  device.firebase_project_id !== "attendai-41f64" ||
  device.revoked_at ||
  !(Date.parse(device.last_seen_at) >= Date.now() - 90 * 86400000)
)
  throw new Error("Device is not eligible for a controlled test");
console.log("Online FCM preflight passed: one consented guardian and one eligible device.");
if (!sending) process.exit(0);

await verifyFcmAdminAuthentication();
const marker = resolve(".tmp/fcm-online-20261016.json");
mkdirSync(resolve(".tmp"), { recursive: true });
const testId = randomUUID();
writeFileSync(
  marker,
  JSON.stringify({ testId, status: "reserved", reservedAt: new Date().toISOString() }),
  { flag: "wx", mode: 0o600 },
);
const result = await sendControlledDeliveryTest({
  installationId: device.firebase_installation_id,
  testId,
  mode: "online",
});
const status = result.ok ? "provider_accepted" : result.kind;
writeFileSync(
  marker,
  JSON.stringify({
    testId,
    status,
    providerMessageId: result.ok ? result.providerId : undefined,
    code: result.ok ? undefined : result.code,
    finishedAt: new Date().toISOString(),
  }),
);
console.log(
  JSON.stringify({
    status,
    providerAccepted: result.ok,
    providerMessageIdStored: result.ok,
    deviceDisplayConfirmed: "UNKNOWN",
    testId,
  }),
);
if (!result.ok) process.exitCode = 1;
