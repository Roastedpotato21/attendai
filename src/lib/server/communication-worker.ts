/**
 * Phase 3B server-only outbox worker.
 *
 * Deploy this module in a trusted scheduled worker (or invoke it from a
 * protected scheduler). It intentionally uses non-VITE environment variables
 * and is never imported by a browser route.
 */
import { createClient } from "@supabase/supabase-js";

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
  | { ok: true; provider: string; providerId: string; status: "queued" | "sent" }
  | { ok: false; errorClass: "transient" | "permanent"; message: string };

type Communication = Record<string, unknown>;

export type CommunicationWorkerStore = {
  claim: (limit: number) => Promise<Job[]>;
  load: (job: Job) => Promise<{
    communication: Communication;
    parent: Communication;
    student: Communication;
  } | null>;
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
          "id, institution_id, type, metadata, students!inner(name), parents!inner(name, phone, language, communication_consent, active)",
        )
        .eq("id", job.communication_id)
        .eq("institution_id", job.institution_id)
        .single();
      if (error || !data) return null;
      const communication = data as Communication;
      const parent = communication["parents"] as Communication | undefined;
      const student = communication["students"] as Communication | undefined;
      if (!parent || !student) return null;
      return { communication, parent, student };
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
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return /^\d{11,15}$/.test(normalized) ? `+${normalized}` : null;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function localizedSms(
  language: Language,
  parentName: string,
  studentName: string,
  date: string,
): string {
  const messages: Record<Language, string> = {
    en: `Dear ${parentName}, ${studentName} was marked absent on ${date}. Please contact the school. -AttendAI`,
    hi: `प्रिय ${parentName}, ${studentName} को ${date} को अनुपस्थित दर्ज किया गया। कृपया स्कूल से संपर्क करें। -AttendAI`,
    te: `${parentName} గారు, ${studentName} ${date}న గైర్హాజరుగా నమోదు అయ్యారు. దయచేసి పాఠశాలను సంప్రదించండి. -AttendAI`,
    ta: `${parentName}, ${studentName} ${date} அன்று வரவில்லை என பதிவு செய்யப்பட்டது. பள்ளியைத் தொடர்புகொள்ளவும். -AttendAI`,
    kn: `${parentName}, ${studentName} ${date} ರಂದು ಗೈರುಹಾಜರಾಗಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ಶಾಲೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ. -AttendAI`,
  };
  return messages[language] ?? messages.en;
}

async function twilioRequest(path: string, parameters: Record<string, string>): Promise<Delivery> {
  try {
    const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
    const authToken = requireEnv("TWILIO_AUTH_TOKEN");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${path}`,
      {
        signal: AbortSignal.timeout(20_000),
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        },
        body: new URLSearchParams(parameters).toString(),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      message?: string;
    };
    if (!response.ok) {
      return {
        ok: false,
        errorClass: isTransientStatus(response.status) ? "transient" : "permanent",
        message: `Twilio ${response.status}: ${payload.message ?? "request rejected"}`,
      };
    }
    if (!payload.sid)
      return { ok: false, errorClass: "transient", message: "Twilio response had no SID" };
    return {
      ok: true,
      provider: "twilio",
      providerId: payload.sid,
      status: payload.status === "queued" ? "queued" : "sent",
    };
  } catch (error) {
    return {
      ok: false,
      errorClass:
        error instanceof Error && error.message.endsWith("is not configured")
          ? "permanent"
          : "transient",
      message: "provider configuration or network request failed",
    };
  }
}

export async function deliver(
  job: Job,
  communication: Record<string, unknown>,
  parent: Record<string, unknown>,
): Promise<Delivery> {
  if (!parent["communication_consent"] || !parent["active"])
    return { ok: false, errorClass: "permanent", message: "parent is not eligible" };
  try {
    const recipient = normalizePhone(String(parent["phone"] ?? ""));
    if (!recipient)
      return { ok: false, errorClass: "permanent", message: "invalid parent phone number" };
    const language = String(parent["language"] ?? "en") as Language;
    const metadata = (communication["metadata"] ?? {}) as { attendance_date?: string };

    if (job.channel === "sms") {
      return twilioRequest("Messages.json", {
        From: requireEnv("TWILIO_PHONE_NUMBER"),
        To: recipient,
        StatusCallback: requireEnv("TWILIO_WEBHOOK_PUBLIC_URL"),
        Body: localizedSms(
          language,
          String(parent["name"] ?? "Parent"),
          String(communication["student_name"] ?? "Student"),
          metadata.attendance_date ?? "today",
        ),
      });
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

function retryAt(attempt: number): string {
  // Capped exponential backoff: 1, 2, then 4 minutes. Bound prevents storms.
  const minutes = Math.min(4, 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + minutes * 60_000).toISOString();
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
        const result =
          !loaded || !loaded.parent["communication_consent"] || !loaded.parent["active"]
            ? {
                ok: false as const,
                errorClass: "permanent" as const,
                message: "communication is missing or no longer eligible",
              }
            : await deliverJob(
                job,
                { ...loaded.communication, student_name: loaded.student["name"] },
                loaded.parent,
              );

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
