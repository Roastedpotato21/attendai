// Read-only preflight. No enqueue, consent changes, provider POSTs, or retries.
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";
import { renderSmsTemplate } from "../src/lib/server/sms-template.ts";
import { normalizeSmsPhone } from "../src/lib/server/communication-worker.ts";

const env = process.env;
if (new URL(env.SUPABASE_URL).hostname !== "elebygmdftfjgecauyiq.supabase.co")
  throw new Error("Unexpected development project");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function read(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
const guardian = await read(
  db.from("parents").select("*").eq("name", "Attendance Test Guardian").single(),
);
const student = await read(
  db
    .from("students")
    .select("*")
    .eq("name", "Student One")
    .eq("institution_id", guardian.institution_id)
    .single(),
);
const institution = await read(
  db.from("institutions").select("name,status").eq("id", guardian.institution_id).single(),
);
const link = await read(
  db
    .from("student_parents")
    .select("receives_notifications")
    .eq("institution_id", guardian.institution_id)
    .eq("student_id", student.id)
    .eq("parent_id", guardian.id)
    .maybeSingle(),
);
const attendance = await read(
  db
    .from("attendance_records")
    .select("session_id,status,attendance_sessions!inner(date,status)")
    .eq("institution_id", guardian.institution_id)
    .eq("student_id", student.id)
    .eq("attendance_sessions.date", "2026-10-05")
    .maybeSingle(),
);
const phone = normalizeSmsPhone(guardian.phone);
const templates = await read(
  db
    .from("sms_templates")
    .select("*")
    .eq("institution_id", guardian.institution_id)
    .eq("channel", "sms")
    .eq("event_type", "absence-alert")
    .eq("active", true),
);
const template =
  templates.find((t) => t.language === guardian.language) ??
  templates.find((t) => t.language === "en");
let intendedBody;
try {
  intendedBody = renderSmsTemplate(template, {
    student_name: student.name,
    guardian_name: guardian.name,
    institution_name: institution.name,
    attendance_date: "2026-10-05",
  });
} catch {
  /* reported below */
}
const history = await read(
  db
    .from("communications")
    .select(
      "id,message_status,provider_message_id,communication_jobs(status,attempts,provider_request_started_at)",
    )
    .eq("institution_id", guardian.institution_id)
    .eq("student_id", student.id)
    .eq("parent_id", guardian.id)
    .eq("type", "sms")
    .contains("metadata", { attendance_session_id: attendance?.session_id ?? "missing" }),
);
const rate = await read(
  db
    .from("communication_rate_limits")
    .select("max_per_parent_per_window,window_length")
    .eq("institution_id", guardian.institution_id)
    .maybeSingle(),
);
// Ask PostgreSQL to interpret the configured interval; no assumptions about its format.
const { data: rateAllowed, error: rateError } = await db.rpc("sms_trial_rate_available", {
  p_institution: guardian.institution_id,
  p_guardian: guardian.id,
});
const credentials = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
let account;
if (credentials) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`,
    {
      headers: {
        authorization:
          "Basic " +
          Buffer.from(env.TWILIO_ACCOUNT_SID + ":" + env.TWILIO_AUTH_TOKEN).toString("base64"),
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  const data = await response.json();
  account = { httpStatus: response.status, type: data.type, status: data.status };
}
const origin = "https://attendai.attendai-expresspotato44.workers.dev";
const callbackUrl = origin + "/api/webhooks/twilio/status";
const callbackResponse = await fetch(callbackUrl, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: "MessageSid=SMpreflight-invalid&MessageStatus=delivered",
  signal: AbortSignal.timeout(20000),
});
const probe = { MessageSid: "SMpreflight-invalid", MessageStatus: "delivered" };
const signedResponse = credentials
  ? await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": twilio.getExpectedTwilioSignature(
          env.TWILIO_AUTH_TOKEN,
          callbackUrl,
          probe,
        ),
      },
      body: new URLSearchParams(probe),
      signal: AbortSignal.timeout(20000),
    })
  : null;
// Unsigned probe fails signature validation (403). Signed, nonexistent SID
// reaches database validation (400) and must never create a history record.
const callbackReady =
  env.TWILIO_WEBHOOK_PUBLIC_URL === callbackUrl &&
  callbackResponse.status === 403 &&
  signedResponse?.status === 400;
const checks = {
  consent:
    guardian.active && guardian.communication_consent && guardian.preferred_channel === "sms",
  receivesNotifications: link?.receives_notifications === true,
  sameTenant:
    student.parent_id === guardian.id &&
    student.enrollment_status === "active" &&
    institution.status === "active",
  currentAbsence:
    attendance?.status === "absent" && attendance.attendance_sessions.status === "submitted",
  recipientPolicy:
    Boolean(phone) &&
    (env.SMS_LIVE_RECIPIENT_ALLOWLIST ?? "")
      .split(",")
      .map((p) => p.trim())
      .includes(phone),
  template: Boolean(intendedBody),
  idempotency: history.length === 0,
  rateLimit: !rateError && rateAllowed === true,
  providerCredentials: credentials && account?.httpStatus === 200,
  // Product-trial docs cannot establish permission for this +91 destination.
  providerPermitsDestination:
    account?.status === "active" &&
    account?.type === "Full" &&
    env.SMS_PROVIDER_DESTINATION_VERIFIED === "true",
  callback: callbackReady,
};
const report = {
  provider: "Twilio",
  guardian: guardian.name,
  student: student.name,
  attendanceDate: "2026-10-05",
  recipient: phone ? phone.slice(0, 3) + "******" + phone.slice(-4) : "invalid",
  checks,
  intendedBody,
  providerApiBody: account?.type === "Trial" ? "sms_appointment_reminders" : intendedBody,
  bodySemantics:
    account?.type === "Trial"
      ? "Fixed provider appointment example; does not carry the absence details."
      : "Attendance absence alert",
  account,
  rateLimit: rate ?? { max_per_parent_per_window: 3, window_length: "1 hour" },
  existingSmsHistory: history,
  callbackStatus: callbackResponse.status,
  signedUnknownSidStatus: signedResponse?.status,
  passed: Object.values(checks).every(Boolean),
  attempted: false,
  providerRequests: 0,
};
console.log("CONTROLLED SMS PREFLIGHT");
console.log(JSON.stringify(report, null, 2));
console.log(
  report.passed
    ? "CONTROLLED SMS PREFLIGHT PASSED"
    : "CONTROLLED SMS PREFLIGHT FAILED — " +
        Object.entries(checks)
          .filter(([, pass]) => !pass)
          .map(([name]) => name)
          .join(", "),
);
process.exitCode = report.passed ? 0 : 2;
