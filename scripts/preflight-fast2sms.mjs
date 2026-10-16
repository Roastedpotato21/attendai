// Read-only preflight. No enqueue, consent changes, provider POSTs, or retries.
import { createClient } from "@supabase/supabase-js";
import { fast2SmsNumber } from "../src/lib/server/fast2sms-provider.ts";
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
      "id,message_status,provider_name,provider_message_id,error_details,communication_jobs(status,attempts,provider_request_started_at),sms_dispatches(provider,status,provider_message_id,http_status,provider_code)",
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
const origin = "https://attendai.attendai-expresspotato44.workers.dev";
const response = await fetch(origin + "/api/internal/communications/fast2sms/readiness", {
  method: "POST",
  headers: { authorization: "Bearer " + env.COMMUNICATION_WORKER_SECRET },
  signal: AbortSignal.timeout(20000),
});
const deployed = response.ok ? await response.json() : {};
// No historical row is altered. A different attendance date's rejection is not evidence.
const uncertain = history.some(
  (row) =>
    row.message_status === "unconfirmed" ||
    row.communication_jobs.some(
      (job) =>
        job.provider_request_started_at &&
        row.message_status !== "failed" &&
        !row.provider_message_id,
    ),
);
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
  provider: deployed.provider === "fast2sms" && deployed.twilioActiveForSms === false,
  secret: deployed.secretPresent === true,
  deployedProject: deployed.projectHost === "elebygmdftfjgecauyiq.supabase.co",
  phoneFormat: Boolean(phone && fast2SmsNumber(phone)),
  duplicateSafety: !uncertain && history.length === 0,
  liveDeliveryEnabled: deployed.deliveryMode === "live",
};
const report = {
  provider: "Fast2SMS",
  smsPriority: "PRIMARY",
  route: "Quick SMS / non-DLT (q)",
  secret: deployed.secretPresent ? "PRESENT" : "MISSING",
  guardian: guardian.name,
  student: student.name,
  attendanceDate: "2026-10-05",
  currentAttendance: attendance?.status,
  recipient: phone ? phone.slice(0, 3) + "******" + phone.slice(-4) : "invalid",
  renderedMessage: intendedBody,
  characters: intendedBody?.length,
  oldTwilioAttempt: uncertain
    ? "DUPLICATE SAFETY BLOCKER: October 5 outcome remains uncertain"
    : "Existing history requires explicit reconciliation",
  twilioActiveForNewSms: deployed.twilioActiveForSms,
  fcmRequired: deployed.fcmRequired,
  checks,
  deployed,
  existingSmsHistory: history,
  rateLimit: rate ?? { max_per_parent_per_window: 3, window_length: "1 hour" },
  passed: Object.values(checks).every(Boolean),
  attempted: false,
  providerRequests: 0,
};
console.log("FAST2SMS CONTROLLED PREFLIGHT");
console.log(JSON.stringify(report, null, 2));
console.log(
  report.passed
    ? "FAST2SMS CONTROLLED PREFLIGHT PASSED"
    : "FAST2SMS CONTROLLED PREFLIGHT FAILED: " +
        Object.entries(checks)
          .filter(([, pass]) => !pass)
          .map(([name]) => name)
          .join(", "),
);
process.exitCode = report.passed ? 0 : 2;
