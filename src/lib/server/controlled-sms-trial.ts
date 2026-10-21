import { createClient } from "@supabase/supabase-js";
import { processCommunicationJobs, normalizeSmsPhone } from "./communication-worker.ts";
import { fast2SmsNumber } from "./fast2sms-provider.ts";
import { renderSmsTemplate, type SmsTemplate } from "./sms-template.ts";

/** Called only after Worker bearer authentication. The deployed execution key
 * selects one durable, single-attempt job; the scheduler remains disabled. */
export async function handleControlledSmsTrial(request: Request): Promise<Response> {
  const input = await request.json().catch(() => null);
  const key = process.env["SMS_TRIAL_EXECUTION_KEY"];
  if (!key || input?.executionKey !== key || !["preflight", "send"].includes(input?.action))
    return new Response("Trial is not authorized", { status: 403 });
  const db = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const trialResult = await db
    .from("sms_controlled_trials")
    .select("*")
    .eq("execution_key", key)
    .single();
  const trial = trialResult.data;
  if (trialResult.error || !trial) return new Response("Trial not prepared", { status: 409 });
  const [p, s, i, link, a, job, templates, history, rate, settings] = await Promise.all([
    db
      .from("parents")
      .select("name,phone,language,active,communication_consent,preferred_channel")
      .eq("id", trial.parent_id)
      .eq("institution_id", trial.institution_id)
      .single(),
    db
      .from("students")
      .select("name,parent_id,enrollment_status")
      .eq("id", trial.student_id)
      .eq("institution_id", trial.institution_id)
      .single(),
    db.from("institutions").select("name,status").eq("id", trial.institution_id).single(),
    db
      .from("guardian_current_relationships")
      .select("receives_notifications")
      .eq("parent_id", trial.parent_id)
      .eq("student_id", trial.student_id)
      .eq("institution_id", trial.institution_id)
      .single(),
    db
      .from("attendance_records")
      .select("status,attendance_sessions!inner(date,status)")
      .eq("session_id", trial.session_id)
      .eq("student_id", trial.student_id)
      .eq("institution_id", trial.institution_id)
      .single(),
    db
      .from("communication_jobs")
      .select("id,status,attempts,max_attempts,provider_request_started_at")
      .eq("id", trial.job_id)
      .eq("communication_id", trial.communication_id)
      .eq("institution_id", trial.institution_id)
      .single(),
    db
      .from("sms_templates")
      .select("*")
      .eq("institution_id", trial.institution_id)
      .eq("channel", "sms")
      .eq("event_type", "absence-alert")
      .eq("active", true),
    db
      .from("communications")
      .select(
        "id,message_status,provider_message_id,metadata,communication_jobs(status,attempts,provider_request_started_at),sms_dispatches(id)",
      )
      .eq("institution_id", trial.institution_id)
      .eq("student_id", trial.student_id)
      .eq("parent_id", trial.parent_id)
      .eq("type", "sms")
      .contains("metadata", { attendance_session_id: trial.session_id }),
    db.rpc("sms_trial_rate_available", {
      p_institution: trial.institution_id,
      p_guardian: trial.parent_id,
    }),
    db
      .from("notification_channel_settings")
      .select("sms_enabled")
      .eq("institution_id", trial.institution_id)
      .maybeSingle(),
  ]);
  if ([p, s, i, link, a, job, templates, history, rate, settings].some((result) => result.error))
    return new Response("Unable to verify trial eligibility", { status: 503 });
  const session = a.data?.attendance_sessions as unknown as { date: string; status: string };
  const phone = normalizeSmsPhone(p.data?.phone ?? "");
  const template =
    templates.data?.find((t) => t.language === p.data?.language) ??
    templates.data?.find((t) => t.language === "en");
  let message = "";
  try {
    message = renderSmsTemplate(template as SmsTemplate, {
      student_name: s.data!.name,
      guardian_name: p.data!.name,
      institution_name: i.data!.name,
      attendance_date: session.date,
    });
  } catch {
    /* Fail the template check without exposing private payloads. */
  }
  const previous = history.data!.filter((c) => c.id !== trial.communication_id);
  const current = history.data!.find((c) => c.id === trial.communication_id);
  const safeHistory = previous.every(
    (c) =>
      c.message_status === "failed" &&
      !c.provider_message_id &&
      c.sms_dispatches.length === 0 &&
      c.communication_jobs.length > 0 &&
      c.communication_jobs.every(
        (j) => j.status === "cancelled" && j.attempts === 0 && !j.provider_request_started_at,
      ),
  );
  const age = (Date.now() - Date.parse(session.date + "T00:00:00Z")) / 86400000;
  const checks = {
    currentAbsence:
      a.data?.status === "absent" &&
      session.status === "submitted" &&
      session.date !== "2026-10-05" &&
      age >= 0 &&
      age < 15,
    relationship:
      s.data?.parent_id === trial.parent_id &&
      s.data?.enrollment_status === "active" &&
      i.data?.status === "active",
    consent:
      p.data?.active === true &&
      p.data.communication_consent === true &&
      p.data.preferred_channel === "sms",
    receivesNotifications: link.data?.receives_notifications === true,
    phone: Boolean(phone && fast2SmsNumber(phone)),
    recipientAllowlist: (process.env["SMS_LIVE_RECIPIENT_ALLOWLIST"] ?? "")
      .split(",")
      .map((x) => x.trim())
      .includes(phone ?? "invalid"),
    priorSmsRisk: safeHistory,
    duplicateProtection: Boolean(
      current &&
      current.message_status === "queued" &&
      !current.provider_message_id &&
      current.sms_dispatches.length === 0 &&
      job.data?.status === "pending" &&
      job.data.attempts === 0 &&
      job.data.max_attempts === 1 &&
      !job.data.provider_request_started_at,
    ),
    rateLimit: rate.data === true,
    policy: settings.data?.sms_enabled !== false,
    template: Boolean(message),
    provider: (process.env["SMS_PROVIDER"] ?? "fast2sms") === "fast2sms",
    secret: Boolean(process.env["FAST2SMS_API_KEY"]),
  };
  const preflight = {
    guardian: p.data?.name,
    student: s.data?.name,
    attendanceDate: session.date,
    recipient: phone ? phone.slice(0, 3) + "******" + phone.slice(-4) : "invalid",
    message,
    provider: "Fast2SMS",
    route: "q",
    checks,
    passed: Object.values(checks).every(Boolean),
    communicationId: trial.communication_id,
    jobId: trial.job_id,
  };
  if (!preflight.passed || input.action === "preflight")
    return Response.json(
      { preflight },
      { status: preflight.passed ? 200 : 409, headers: { "Cache-Control": "no-store" } },
    );
  const summary = await processCommunicationJobs(1, {
    trialJobId: trial.job_id,
    authorizedLiveTrial: true,
  });
  // A lost HTTP response is resolved by inspecting this persisted job, never by resending.
  return Response.json(
    { preflight, summary, communicationId: trial.communication_id },
    { headers: { "Cache-Control": "no-store" } },
  );
}
