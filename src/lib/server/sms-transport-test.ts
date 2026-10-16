import { createClient } from "@supabase/supabase-js";
import { Fast2SmsProvider, fast2SmsNumber, fetchFast2SmsReport } from "./fast2sms-provider.ts";
import { normalizeSmsPhone } from "./communication-worker.ts";

const executionKey = "attendai-fast2sms-transport-20261012-v1";
const message = "AttendAI SMS test. No attendance action is required.";
const guardianName = "Attendance Test Guardian";

type TestRecord = {
  id: string;
  institution_id: string;
  parent_id: string;
  recipient: string;
  body: string;
  status: "prepared" | "sending" | "accepted" | "rejected" | "unconfirmed";
  request_count: number;
  provider_request_id: string | null;
  provider_accepted: boolean | null;
  http_status: number | null;
  provider_code: string | null;
  safe_response_body: string | null;
  delivery_status: "unknown" | "pending" | "delivered" | "failed";
};

function database() {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function masked(phone: string | null): string {
  return phone ? `${phone.slice(0, 3)}******${phone.slice(-4)}` : "invalid";
}

/** Internal bearer protected, one recipient, one durable execution key, one POST. */
export async function handleSmsTransportTest(request: Request): Promise<Response> {
  const input = await request.json().catch(() => null);
  if (
    input?.executionKey !== executionKey ||
    !["preflight", "send", "inspect"].includes(input?.action)
  )
    return new Response("Transport test is not authorized", { status: 403 });

  const db = database();
  const [guardians, existingResult] = await Promise.all([
    db
      .from("parents")
      .select("id,name,institution_id,phone,active,communication_consent,preferred_channel")
      .eq("name", guardianName)
      .limit(2),
    db.from("sms_transport_tests").select("*").eq("execution_key", executionKey).maybeSingle(),
  ]);
  if (guardians.error || existingResult.error)
    return new Response("Transport test state unavailable", { status: 503 });
  const guardian = guardians.data?.length === 1 ? guardians.data[0] : null;
  const phone = guardian ? normalizeSmsPhone(guardian.phone) : null;
  const existing = existingResult.data as TestRecord | null;
  const institution = guardian
    ? await db
        .from("institutions")
        .select("name,status")
        .eq("id", guardian.institution_id)
        .maybeSingle()
    : null;
  const links = guardian
    ? await db
        .from("student_parents")
        .select("receives_notifications,students!inner(id,enrollment_status,institution_id)")
        .eq("parent_id", guardian.id)
        .eq("institution_id", guardian.institution_id)
        .eq("receives_notifications", true)
        .eq("students.enrollment_status", "active")
    : null;
  const recent = guardian
    ? await db
        .from("sms_transport_tests")
        .select("id,status,request_count")
        .eq("parent_id", guardian.id)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    : null;
  if (institution?.error || links?.error || recent?.error)
    return new Response("Transport test eligibility unavailable", { status: 503 });

  const allowlist = (process.env["SMS_LIVE_RECIPIENT_ALLOWLIST"] ?? "")
    .split(",")
    .map((value) => normalizeSmsPhone(value.trim()))
    .filter(Boolean);
  const savedTargetMatches = Boolean(
    !existing ||
    (guardian &&
      existing.parent_id === guardian.id &&
      existing.institution_id === guardian.institution_id &&
      existing.recipient === phone &&
      existing.body === message),
  );
  const checks = {
    allowlist: Boolean(phone && allowlist.includes(phone)),
    consent: guardian?.active === true && guardian.communication_consent === true,
    phone: Boolean(phone && fast2SmsNumber(phone)),
    apiKey: Boolean(process.env["FAST2SMS_API_KEY"]),
    institution: institution?.data?.status === "active",
    receivesNotifications: links?.data?.some((row) => row.receives_notifications) === true,
    guardianUnique: guardian !== null,
    rateLimit: Boolean(
      existing ? recent?.data?.every((row) => row.id === existing.id) : recent?.data?.length === 0,
    ),
    idempotency: savedTargetMatches && Boolean(!existing || existing.status === "prepared"),
    requestUnused: Boolean(!existing || existing.request_count === 0),
    provider: (process.env["SMS_PROVIDER"] ?? "fast2sms") === "fast2sms",
  };
  const preflight = {
    guardian: guardian?.name ?? "not found or not unique",
    institution: institution?.data?.name ?? null,
    provider: "Fast2SMS",
    route: "Quick SMS / q",
    recipient: masked(phone),
    allowlist: checks.allowlist ? "PASS" : "FAIL",
    consent: checks.consent ? "PASS" : "FAIL",
    phone: checks.phone ? "VALID" : "INVALID",
    apiKey: checks.apiKey ? "PRESENT" : "MISSING",
    message,
    attendanceInvolved: false,
    twilio: false,
    fcm: false,
    checks,
    passed: Object.values(checks).every(Boolean),
    testId: existing?.id ?? null,
    providerStatus: existing?.status ?? null,
    providerRequestId: existing?.provider_request_id ?? null,
    deliveryStatus: existing?.delivery_status ?? "unknown",
  };

  if (input.action === "inspect")
    return Response.json(
      { preflight, persisted: existing ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  if (!preflight.passed || input.action === "preflight")
    return Response.json(
      { preflight },
      { status: preflight.passed ? 200 : 409, headers: { "Cache-Control": "no-store" } },
    );

  // This RPC rechecks the recipient and consent in a transaction, enforces the
  // 24-hour rate limit and creates a record that has no attendance/job FK.
  const prepared = await db.rpc("prepare_sms_transport_test", {
    p_execution_key: executionKey,
    p_institution: guardian!.institution_id,
    p_parent: guardian!.id,
    p_recipient: phone!,
    p_body: message,
  });
  if (prepared.error || !prepared.data)
    return Response.json(
      { preflight, error: "Unable to prepare the dedicated test safely" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  const record = prepared.data as TestRecord;
  const reserved = await db.rpc("begin_sms_transport_test", { p_id: record.id });
  if (reserved.error || reserved.data !== true)
    return Response.json(
      { preflight, error: "This test has already used its single request" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );

  // Never retry this call. The durable reservation prevents a second POST even
  // if the Worker loses its response or the process stops unexpectedly.
  const result = await new Fast2SmsProvider().send({
    recipient: phone!,
    body: message,
    communicationId: record.id,
  });
  const accepted = result.ok ? true : result.errorClass === "permanent" ? false : null;
  const persisted = await db.rpc("finish_sms_transport_test", {
    p_id: record.id,
    p_http_status: result.httpStatus ?? null,
    p_safe_response_body: result.safeResponseBody ?? null,
    p_provider_code: result.ok ? null : "providerCode" in result ? result.providerCode : null,
    p_request_id: result.ok ? result.providerId : null,
    p_accepted: accepted,
    p_provider_error: result.ok ? null : "message" in result ? result.message : null,
    p_diagnostics: result.diagnostics ?? null,
  });
  if (persisted.error || persisted.data !== true)
    return Response.json(
      {
        preflight,
        testId: record.id,
        error: "Provider call completed; durable response update failed. Do not retry.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );

  let deliveryStatus: "pending" | "delivered" | "failed" | "unknown" = accepted
    ? "pending"
    : "unknown";
  if (result.ok) {
    try {
      const report = await fetchFast2SmsReport(result.providerId, phone!);
      deliveryStatus = report.status;
      await db.rpc("apply_sms_transport_test_report", {
        p_id: record.id,
        p_request_id: result.providerId,
        p_status: report.status,
      });
    } catch {
      // Acceptance remains distinct from delivery; follow-up is read-only.
    }
  }
  return Response.json(
    {
      preflight,
      testId: record.id,
      provider: "Fast2SMS",
      route: "q",
      recipient: masked(phone),
      httpStatus: result.httpStatus ?? null,
      providerCode: result.ok ? null : "providerCode" in result ? result.providerCode : null,
      safeResponse: result.safeResponseBody ?? (result.ok ? "Accepted" : result.message),
      accepted,
      requestId: result.ok ? result.providerId : null,
      requestIdStored: result.ok,
      deliveryStatus,
      requestCount: 1,
      twilioRequests: 0,
      fcmRequests: 0,
      attendanceModified: false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
