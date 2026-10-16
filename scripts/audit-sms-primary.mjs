// Read-only live readiness audit. Never POSTs to an SMS provider.
import { createClient } from "@supabase/supabase-js";
const env = process.env;
if (new URL(env.SUPABASE_URL).hostname !== "elebygmdftfjgecauyiq.supabase.co")
  throw new Error("Unexpected development project");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const mask = (phone) => (phone ? phone.slice(0, 3) + "******" + phone.slice(-4) : null);
const safe = (value) => String(value ?? "").replace(/\+\d{8,15}/g, mask);
async function read(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
const guardian = await read(
  db
    .from("parents")
    .select("id,institution_id,name,phone,active,communication_consent,preferred_channel,language")
    .eq("name", "Attendance Test Guardian")
    .single(),
);
const student = await read(
  db
    .from("students")
    .select("id,institution_id,name,parent_id,enrollment_status")
    .eq("name", "Student One")
    .eq("institution_id", guardian.institution_id)
    .single(),
);
const links = await read(
  db
    .from("student_parents")
    .select("institution_id,receives_notifications")
    .eq("student_id", student.id)
    .eq("parent_id", guardian.id),
);
const attendance = await read(
  db
    .from("attendance_records")
    .select("session_id,institution_id,status,attendance_sessions!inner(date,status)")
    .eq("student_id", student.id)
    .eq("attendance_sessions.date", "2026-10-05"),
);
const templates = await read(
  db
    .from("sms_templates")
    .select("id,language,content,approved_variables,active")
    .eq("institution_id", guardian.institution_id)
    .eq("channel", "sms"),
);
const history = await read(
  db
    .from("communications")
    .select(
      "id,type,message_status,sms_status,provider_name,provider_message_id,error_details,body,metadata,communication_jobs(id,channel,status,attempts,max_attempts,last_error,provider_request_started_at)",
    )
    .eq("student_id", student.id)
    .eq("parent_id", guardian.id)
    .order("created_at", { ascending: false })
    .limit(15),
);
const limits = await read(
  db
    .from("communication_rate_limits")
    .select("max_per_parent_per_window,window_length")
    .eq("institution_id", guardian.institution_id),
);
console.log(
  JSON.stringify(
    {
      guardian: { ...guardian, phone: mask(guardian.phone) },
      student,
      links,
      attendance,
      templates,
      limits,
      history: history.map((row) => ({
        ...row,
        error_details: safe(row.error_details),
        communication_jobs: row.communication_jobs.map((j) => ({
          ...j,
          last_error: safe(j.last_error),
        })),
      })),
      config: {
        provider: env.NOTIFICATION_PROVIDER,
        smsMode: env.SMS_DELIVERY_MODE,
        trial: env.TWILIO_TRIAL_MODE,
        allowlisted: (env.SMS_LIVE_RECIPIENT_ALLOWLIST ?? "")
          .split(",")
          .map((x) => x.trim())
          .includes(guardian.phone),
        callback: env.TWILIO_WEBHOOK_PUBLIC_URL,
        twilioCredentialsPresent: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
        alternativeProviderKeys: Object.keys(env).filter((k) =>
          /MSG91|VONAGE|PLIVO|TEXTLOCAL|FAST2SMS|SNS/.test(k),
        ),
      },
    },
    null,
    2,
  ),
);
if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
  const base = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;
  async function twilio(url, select) {
    const response = await fetch(url, {
      headers: {
        authorization:
          "Basic " +
          Buffer.from(env.TWILIO_ACCOUNT_SID + ":" + env.TWILIO_AUTH_TOKEN).toString("base64"),
      },
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    console.log(
      JSON.stringify({
        twilioRead: url.replace(env.TWILIO_ACCOUNT_SID, "[account]").split("?")[0],
        httpStatus: response.status,
        ...(response.ok ? select(data) : { code: data.code, message: safe(data.message) }),
      }),
    );
  }
  await twilio(base + ".json", (d) => ({
    type: d.type,
    status: d.status,
    created: d.date_created,
  }));
  await twilio(base + "/IncomingPhoneNumbers.json?PageSize=100", (d) => ({
    senders: d.incoming_phone_numbers.map((n) => ({
      number: mask(n.phone_number),
      sms: n.capabilities?.sms,
      configured: n.phone_number === env.TWILIO_PHONE_NUMBER,
    })),
  }));
  await twilio(base + "/OutgoingCallerIds.json?PageSize=100", (d) => ({
    verifiedRecipientMatch: d.outgoing_caller_ids.some((n) => n.phone_number === guardian.phone),
    verifiedCount: d.outgoing_caller_ids.length,
  }));
  await twilio(
    base + "/Messages.json?PageSize=20&To=" + encodeURIComponent(guardian.phone),
    (d) => ({
      messages: d.messages.map((m) => ({
        sid: m.sid,
        status: m.status,
        errorCode: m.error_code,
        errorMessage: safe(m.error_message),
        date: m.date_created,
      })),
    }),
  );
}
