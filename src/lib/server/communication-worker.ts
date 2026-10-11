/**
 * Phase 3B server-only outbox worker.
 *
 * Deploy this module in a trusted scheduled worker (or invoke it from a
 * protected scheduler). It intentionally uses non-VITE environment variables
 * and is never imported by a browser route.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";
import { createClient } from "@supabase/supabase-js";
import { renderSmsTemplate, type SmsTemplate } from "./sms-template.ts";

type Channel = "sms" | "whatsapp" | "voice";
type Language = "en" | "hi" | "te" | "ta" | "kn";

type Job = {
  id: string;
  institution_id: string;
  communication_id: string;
  channel: Channel;
  attempts: number;
  max_attempts: number;
  lease_owner: string;
};

type Delivery =
  | {
      ok: true;
      provider: string;
      providerId: string;
      status: "queued" | "sent" | "failed" | "undelivered";
      body?: string;
      templateId?: string;
      recipient?: string;
    }
  | { ok: false; errorClass: "transient" | "permanent" | "ambiguous"; message: string };

type Communication = Record<string, unknown>;

// Twilio's SMS trial accepts this identifier as Body, not custom message text.
const TWILIO_TRIAL_SMS_BODY = "sms_appointment_reminders";
const TWILIO_API_HOST = "api.twilio.com";
const TWILIO_REQUEST_TIMEOUT_MS = 20_000;

type TwilioRequestTrace = {
  path: string;
  created: boolean;
  bodyBytesWritten: number;
  bodySent: boolean;
};

type UndiciRequest = { origin?: string | URL; method?: string; path?: string };
const twilioTraceContext = new AsyncLocalStorage<TwilioRequestTrace>();
const twilioUndiciRequests = new WeakMap<object, TwilioRequestTrace>();

// Undici reports socket writes without exposing request headers or body to logs.
// A per-request async context keeps concurrent worker jobs' traces separate.
channel("undici:request:create").subscribe((event) => {
  const request = (event as { request?: UndiciRequest }).request;
  const trace = twilioTraceContext.getStore();
  if (
    trace &&
    request &&
    request.method === "POST" &&
    String(request.origin) === `https://${TWILIO_API_HOST}` &&
    request.path === trace.path
  ) {
    trace.created = true;
    twilioUndiciRequests.set(request, trace);
  }
});
channel("undici:request:bodyChunkSent").subscribe((event) => {
  const { request, chunk } = event as { request?: object; chunk?: Uint8Array | string };
  const trace = request && twilioUndiciRequests.get(request);
  if (trace && chunk)
    trace.bodyBytesWritten +=
      typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
});
channel("undici:request:bodySent").subscribe((event) => {
  const request = (event as { request?: object }).request;
  const trace = request && twilioUndiciRequests.get(request);
  if (trace) trace.bodySent = true;
});

function safeDiagnosticToken(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value) ? value : null;
}

function twilioFailureDetails(
  started: number,
  trace: TwilioRequestTrace,
  details: { status?: number; code?: unknown; error?: unknown } = {},
): string {
  const error = details.error;
  const cause = error instanceof Error ? error.cause : undefined;
  const errorCode =
    error && typeof error === "object" && "code" in error ? safeDiagnosticToken(error.code) : null;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause ? safeDiagnosticToken(cause.code) : null;
  const providerCode =
    typeof details.code === "number" && Number.isSafeInteger(details.code)
      ? String(details.code)
      : safeDiagnosticToken(details.code);
  return [
    `endpoint=${TWILIO_API_HOST}`,
    `elapsedMs=${Date.now() - started}`,
    `timeoutMs=${TWILIO_REQUEST_TIMEOUT_MS}`,
    `bodyBytesWrittenObserved=${trace.created ? trace.bodyBytesWritten : "unknown"}`,
    `bodyFullySent=${trace.created ? trace.bodySent : "unknown"}`,
    details.status === undefined ? null : `httpStatus=${details.status}`,
    providerCode ? `providerCode=${providerCode}` : null,
    error instanceof Error ? `errorName=${safeDiagnosticToken(error.name) ?? "unknown"}` : null,
    errorCode ? `errorCode=${errorCode}` : null,
    cause instanceof Error ? `causeName=${safeDiagnosticToken(cause.name) ?? "unknown"}` : null,
    causeCode ? `causeCode=${causeCode}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export type CommunicationWorkerStore = {
  claim: (limit: number) => Promise<Job[]>;
  load: (job: Job) => Promise<{
    communication: Communication;
    parent: Communication;
    student: Communication;
    attendanceEligible?: boolean | undefined;
    guardianEligible?: boolean | undefined;
    institutionName?: string | undefined;
    template?: SmsTemplate | undefined;
  } | null>;
  beginDispatch?: (job: Job) => Promise<boolean>;
  finish: (job: Job, result: Delivery) => Promise<boolean>;
};

export type CommunicationWorkerDependencies = {
  store?: CommunicationWorkerStore;
  deliverJob?: typeof deliver;
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

function serverDb() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function supabaseStore(): CommunicationWorkerStore {
  const db = serverDb();
  return {
    async claim(limit) {
      const { data, error } = await db.rpc("claim_communication_jobs", { p_limit: limit });
      if (error) throw new Error(`claim communication jobs: ${error.message}`);
      return (data ?? []) as Job[];
    },
    async load(job) {
      const { data, error } = await db
        .from("communications")
        .select(
          "id, institution_id, student_id, parent_id, type, metadata, students!inner(name, institution_id, enrollment_status), parents!inner(name, phone, language, preferred_channel, communication_consent, active, institution_id)",
        )
        .eq("id", job.communication_id)
        .eq("institution_id", job.institution_id)
        .single();
      if (error || !data) return null;
      const communication = data as Communication;
      const parent = communication["parents"] as Communication | undefined;
      const student = communication["students"] as Communication | undefined;
      if (
        !parent ||
        !student ||
        communication["type"] !== job.channel ||
        parent["institution_id"] !== job.institution_id ||
        student["institution_id"] !== job.institution_id ||
        student["enrollment_status"] !== "active"
      )
        return null;
      const { data: relationship, error: relationshipError } = await db
        .from("student_parents")
        .select("receives_notifications")
        .eq("student_id", communication["student_id"])
        .eq("parent_id", communication["parent_id"])
        .eq("institution_id", job.institution_id)
        .maybeSingle();
      if (relationshipError) throw new Error("Unable to verify guardian relationship");
      const guardianEligible =
        relationship?.receives_notifications === true &&
        parent["preferred_channel"] === job.channel;
      let template: SmsTemplate | undefined;
      let institutionName: string | undefined;
      if (job.channel === "sms") {
        const language = typeof parent["language"] === "string" ? parent["language"] : "en";
        const { data: selected, error: templateError } = await db
          .from("sms_templates")
          .select(
            "id, institution_id, event_type, channel, language, content, approved_variables, active",
          )
          .eq("institution_id", job.institution_id)
          .eq("event_type", "absence-alert")
          .eq("channel", "sms")
          .in("language", language === "en" ? ["en"] : [language, "en"])
          .eq("active", true)
          .limit(2);
        if (templateError) throw new Error("Unable to load SMS template");
        template = (selected?.find((candidate) => candidate.language === language) ??
          selected?.find((candidate) => candidate.language === "en")) as SmsTemplate | undefined;
        const { data: institution, error: institutionError } = await db
          .from("institutions")
          .select("name")
          .eq("id", job.institution_id)
          .single();
        if (institutionError || !institution) throw new Error("Unable to load institution name");
        institutionName = institution.name;
      }
      const metadata = communication["metadata"] as Record<string, unknown> | undefined;
      let attendanceEligible: boolean | undefined;
      if (metadata?.["purpose"] === "absence-alert") {
        const { data: attendance, error: attendanceError } = await db
          .from("attendance_records")
          .select("status")
          .eq("session_id", metadata["attendance_session_id"])
          .eq("student_id", communication["student_id"])
          .eq("institution_id", job.institution_id)
          .maybeSingle();
        if (attendanceError)
          throw new Error("Unable to verify attendance before notification delivery");
        attendanceEligible = attendance?.status === "absent";
      }
      return {
        communication,
        parent,
        student,
        attendanceEligible,
        guardianEligible,
        institutionName,
        template,
      };
    },
    async beginDispatch(job) {
      const { data, error } = await db.rpc("mark_sms_dispatch_started", {
        p_job: job.id,
        p_owner: job.lease_owner,
      });
      if (error) throw new Error("Unable to fence SMS dispatch");
      return data === true;
    },
    async finish(job, result) {
      const { data, error } = await db.rpc("finish_communication_job", {
        p_job: job.id,
        p_owner: job.lease_owner,
        p_result: result,
      });
      return !error && data === true;
    },
  };
}

export function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const normalized = digits.length === 10 ? "91" + digits : digits;
  return /^\d{11,15}$/.test(normalized) ? "+" + normalized : null;
}

export function normalizeSmsPhone(value: string): string | null {
  if (!/^\+[0-9 ()-]+$/.test(value)) return null;
  const compact = value.replace(/[ ()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

async function twilioRequest(path: string, parameters: Record<string, string>): Promise<Delivery> {
  const started = Date.now();
  const accountPath = `/2010-04-01/Accounts/${process.env["TWILIO_ACCOUNT_SID"] ?? ""}/${path}`;
  const trace: TwilioRequestTrace = {
    path: accountPath,
    created: false,
    bodyBytesWritten: 0,
    bodySent: false,
  };
  try {
    const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
    const authToken = requireEnv("TWILIO_AUTH_TOKEN");
    const response = await twilioTraceContext.run(trace, () =>
      fetch(`https://${TWILIO_API_HOST}` + accountPath, {
        signal: AbortSignal.timeout(TWILIO_REQUEST_TIMEOUT_MS),
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(accountSid + ":" + authToken),
        },
        body: new URLSearchParams(parameters).toString(),
      }),
    );
    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      code?: number | string;
    };
    if (!response.ok) {
      // Only an explicit 429 proves that Twilio rejected the request before
      // accepting a message. A timeout, 408 or 5xx has an uncertain outcome.
      return {
        ok: false,
        errorClass:
          response.status === 429
            ? "transient"
            : response.status === 408 || response.status >= 500
              ? "ambiguous"
              : "permanent",
        message:
          "Twilio HTTP " +
          response.status +
          " (" +
          twilioFailureDetails(started, trace, { status: response.status, code: payload.code }) +
          ")",
      };
    }
    if (!payload.sid || !payload.sid.startsWith("SM")) {
      return {
        ok: false,
        errorClass: "ambiguous",
        message:
          "Twilio outcome lacks a message SID (" +
          twilioFailureDetails(started, trace, { status: response.status }) +
          ")",
      };
    }
    return {
      ok: true,
      provider: "twilio",
      providerId: payload.sid,
      status:
        payload.status === "queued"
          ? "queued"
          : payload.status === "failed"
            ? "failed"
            : payload.status === "undelivered"
              ? "undelivered"
              : "sent",
    };
  } catch (error) {
    return {
      ok: false,
      errorClass:
        error instanceof Error && error.message.endsWith("is not configured")
          ? "permanent"
          : "ambiguous",
      message:
        error instanceof Error && error.message.endsWith("is not configured")
          ? "provider configuration is incomplete"
          : "Twilio outcome unknown; manual reconciliation required (" +
            twilioFailureDetails(started, trace, { error }) +
            ")",
    };
  }
}

export async function deliver(
  job: Job,
  communication: Record<string, unknown>,
  parent: Record<string, unknown>,
  template?: SmsTemplate,
  institutionName?: string,
): Promise<Delivery> {
  if (!parent["communication_consent"] || !parent["active"])
    return { ok: false, errorClass: "permanent", message: "parent is not eligible" };
  try {
    const recipient =
      job.channel === "sms"
        ? normalizeSmsPhone(String(parent["phone"] ?? ""))
        : normalizePhone(String(parent["phone"] ?? ""));
    if (!recipient)
      return { ok: false, errorClass: "permanent", message: "invalid parent phone number" };
    const language = String(parent["language"] ?? "en") as Language;
    const metadata = (communication["metadata"] ?? {}) as {
      attendance_date?: string;
      purpose?: string;
    };

    if (job.channel === "sms") {
      // A configured Twilio token never implicitly enables paid delivery.
      const mode = process.env["SMS_DELIVERY_MODE"];
      if (mode !== "live" && mode !== "simulate")
        return { ok: false, errorClass: "permanent", message: "SMS delivery is disabled" };
      if (
        metadata["purpose"] !== "absence-alert" ||
        !template ||
        template.institution_id !== job.institution_id ||
        (template.language !== language && template.language !== "en") ||
        !institutionName
      )
        return { ok: false, errorClass: "permanent", message: "approved SMS template is missing" };
      let body: string;
      try {
        body = renderSmsTemplate(template, {
          institution_name: institutionName,
          guardian_name: String(parent["name"] ?? ""),
          student_name: String(communication["student_name"] ?? ""),
          attendance_date: String(metadata.attendance_date ?? ""),
        });
      } catch {
        return {
          ok: false,
          errorClass: "permanent",
          message: "SMS template variables are invalid",
        };
      }
      if (mode === "simulate") {
        return {
          ok: true,
          provider: "twilio-simulated",
          providerId: "SMsimulated" + crypto.randomUUID().replace(/-/g, ""),
          status: "queued",
          body,
          templateId: template.id,
          recipient,
        };
      }
      const recipients = (process.env["SMS_LIVE_RECIPIENT_ALLOWLIST"] ?? "")
        .split(",")
        .map((value) => value.trim());
      if (!recipients.includes(recipient))
        return {
          ok: false,
          errorClass: "permanent",
          message: "recipient is not authorized for live SMS",
        };
      const trial = process.env["TWILIO_TRIAL_MODE"] === "true";
      if (recipient.startsWith("+91") && !trial && process.env["SMS_INDIA_DLT_READY"] !== "true")
        return {
          ok: false,
          errorClass: "permanent",
          message: "India SMS registration is not verified",
        };
      const callback = new URL(requireEnv("TWILIO_WEBHOOK_PUBLIC_URL"));
      if (callback.protocol !== "https:" || !communication["id"])
        return { ok: false, errorClass: "permanent", message: "SMS callback URL is invalid" };
      callback.searchParams.set("communication_id", String(communication["id"]));
      const providerBody = trial ? TWILIO_TRIAL_SMS_BODY : body;
      const parameters = {
        To: recipient,
        StatusCallback: callback.toString(),
        Body: providerBody,
        ...(trial ? {} : { From: requireEnv("TWILIO_PHONE_NUMBER") }),
      };
      const result = await twilioRequest("Messages.json", parameters);
      // Store the actual API Body. The template ID retains the intended AttendAI message.
      return result.ok
        ? { ...result, body: providerBody, templateId: template.id, recipient }
        : result;
    }
    if (job.channel === "whatsapp") {
      const contentSid = process.env[`TWILIO_WHATSAPP_CONTENT_SID_${language.toUpperCase()}`];
      if (!contentSid)
        return {
          ok: false,
          errorClass: "permanent",
          message: `missing approved WhatsApp template for ${language}`,
        };
      return twilioRequest("Messages.json", {
        From: `whatsapp:${requireEnv("TWILIO_WHATSAPP_FROM")}`,
        To: `whatsapp:${recipient}`,
        StatusCallback: requireEnv("TWILIO_WEBHOOK_PUBLIC_URL"),
        ContentSid: contentSid,
        ContentVariables: JSON.stringify({
          1: String(parent["name"] ?? "Parent"),
          2: String(communication["student_name"] ?? "Student"),
          3: metadata.attendance_date ?? "today",
        }),
      });
    }

    // A conversational voice implementation requires bidirectional audio,
    // STT, and constrained AI orchestration. It must not masquerade as one
    // until that runtime is provisioned.
    return {
      ok: false,
      errorClass: "permanent",
      message: "conversational voice runtime is not configured",
    };
  } catch {
    return { ok: false, errorClass: "permanent", message: "provider configuration is incomplete" };
  }
}

export async function processCommunicationJobs(
  limit = 20,
  dependencies: CommunicationWorkerDependencies = {},
): Promise<{ claimed: number; completed: number; retried: number; failed: number }> {
  const store = dependencies.store ?? supabaseStore();
  const deliverJob = dependencies.deliverJob ?? deliver;
  const jobs = await store.claim(limit);
  const summary = { claimed: jobs.length, completed: 0, retried: 0, failed: 0 };

  await Promise.all(
    jobs.map(async (job) => {
      const started = Date.now();
      try {
        const loaded = await store.load(job);
        const metadata = loaded?.communication["metadata"] as Record<string, unknown> | undefined;
        const result =
          !loaded ||
          !loaded.parent["communication_consent"] ||
          !loaded.parent["active"] ||
          loaded.guardianEligible !== true ||
          (metadata?.["purpose"] === "absence-alert" && loaded.attendanceEligible !== true)
            ? {
                ok: false as const,
                errorClass: "permanent" as const,
                message: "communication is missing or no longer eligible",
              }
            : await (async () => {
                if (
                  job.channel === "sms" &&
                  process.env["SMS_DELIVERY_MODE"] === "live" &&
                  deliverJob === deliver
                ) {
                  if (!store.beginDispatch || !(await store.beginDispatch(job))) {
                    throw new Error("SMS dispatch could not be fenced before provider request");
                  }
                }
                return deliverJob(
                  job,
                  { ...loaded.communication, student_name: loaded.student["name"] },
                  loaded.parent,
                  loaded.template,
                  loaded.institutionName,
                );
              })();

        if (!(await store.finish(job, result))) {
          throw new Error("communication result persistence failed or lease lost");
        }
        if (result.ok) summary.completed++;
        else if (result.errorClass === "transient" && job.attempts < job.max_attempts)
          summary.retried++;
        else summary.failed++;
        console.info("[communication-worker] processed", {
          jobId: job.id,
          channel: job.channel,
          attempt: job.attempts,
          provider: result.ok ? result.provider : "none",
          latencyMs: Date.now() - started,
          ok: result.ok,
        });
      } catch (error) {
        // A crashed job retains its lease. The database reclaims it after the
        // stale-lease window; other jobs in this bounded batch still proceed.
        summary.failed++;
        console.error("[communication-worker] job error", {
          jobId: job.id,
          channel: job.channel,
          attempt: job.attempts,
          latencyMs: Date.now() - started,
          reason: error instanceof Error ? error.message : "unknown worker error",
        });
      }
    }),
  );
  return summary;
}
