/** FCM outbox worker. The scheduler calls this only with an explicit live gate. */
import { createClient } from "@supabase/supabase-js";
import { renderSmsTemplate, type SmsTemplate } from "./sms-template.ts";
import {
  sendGuardianNotification,
  verifyFcmAdminAuthentication,
  type PushInput,
  type PushResult,
} from "./fcm-provider.ts";

type PushJob = {
  id: string;
  institution_id: string;
  communication_id: string;
  lease_owner: string;
  idempotency_key: string;
};
type Installation = { id: string; firebase_installation_id: string };
type Loaded = {
  communication: Record<string, unknown>;
  guardian: Record<string, unknown>;
  student: Record<string, unknown>;
  eligible: boolean;
  installations: Installation[];
  template: SmsTemplate | undefined;
  institutionName: string;
};

export type PushWorkerStore = {
  claim: (limit: number) => Promise<PushJob[]>;
  load: (job: PushJob) => Promise<Loaded | null>;
  begin: (job: PushJob, installation: Installation) => Promise<string>;
  finish: (job: PushJob, installation: Installation, result: PushResult) => Promise<boolean>;
  complete: (job: PushJob, suppressed: boolean) => Promise<string>;
};

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function supabaseStore(): PushWorkerStore {
  const db = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async claim(limit) {
      const { data, error } = await db.rpc("claim_push_jobs", { p_limit: limit });
      if (error) throw new Error("Unable to claim push jobs");
      return (data ?? []) as PushJob[];
    },
    async load(job) {
      const { data, error } = await db
        .from("communications")
        .select(
          "id,institution_id,student_id,parent_id,type,message_status,metadata,students!inner(name,institution_id,enrollment_status),parents!inner(name,language,active,communication_consent,institution_id)",
        )
        .eq("id", job.communication_id)
        .eq("institution_id", job.institution_id)
        .maybeSingle();
      if (error) throw new Error("Unable to load push communication");
      if (!data) return null;
      const communication = data as Record<string, unknown>;
      const guardian = communication["parents"] as Record<string, unknown>;
      const student = communication["students"] as Record<string, unknown>;
      const metadata = (communication["metadata"] ?? {}) as Record<string, unknown>;
      const [
        { data: relationship, error: relationshipError },
        { data: attendance, error: attendanceError },
        { data: installations, error: installationError },
        { data: institution, error: institutionError },
        { data: templates, error: templateError },
      ] = await Promise.all([
        db
          .from("student_parents")
          .select("receives_notifications")
          .eq("institution_id", job.institution_id)
          .eq("student_id", communication["student_id"])
          .eq("parent_id", communication["parent_id"])
          .maybeSingle(),
        db
          .from("attendance_records")
          .select("status")
          .eq("institution_id", job.institution_id)
          .eq("student_id", communication["student_id"])
          .eq("session_id", metadata["attendance_session_id"])
          .maybeSingle(),
        db
          .from("guardian_notification_installations")
          .select("id,firebase_installation_id")
          .eq("institution_id", job.institution_id)
          .eq("guardian_id", communication["parent_id"])
          .eq("active", true)
          .eq("firebase_project_id", "attendai-41f64")
          .eq("permission_state", "granted")
          .gte("last_seen_at", new Date(Date.now() - 90 * 86400000).toISOString()),
        db.from("institutions").select("name").eq("id", job.institution_id).maybeSingle(),
        db
          .from("sms_templates")
          .select("id,institution_id,event_type,channel,language,content,approved_variables,active")
          .eq("institution_id", job.institution_id)
          .eq("event_type", "absence-alert")
          .eq("channel", "sms")
          .eq("active", true)
          .limit(5),
      ]);
      if (
        relationshipError ||
        attendanceError ||
        installationError ||
        institutionError ||
        templateError
      )
        throw new Error("Unable to verify push eligibility");
      const language = String(guardian["language"] ?? "en");
      const template = (templates?.find((candidate) => candidate.language === language) ??
        templates?.find((candidate) => candidate.language === "en")) as SmsTemplate | undefined;
      const eligible =
        communication["type"] === "push" &&
        communication["institution_id"] === job.institution_id &&
        guardian["institution_id"] === job.institution_id &&
        student["institution_id"] === job.institution_id &&
        student["enrollment_status"] === "active" &&
        guardian["active"] === true &&
        guardian["communication_consent"] === true &&
        relationship?.receives_notifications === true &&
        attendance?.status === "absent" &&
        metadata["purpose"] === "absence-alert";
      return {
        communication,
        guardian,
        student,
        eligible,
        installations: (installations ?? []) as Installation[],
        template,
        institutionName: String(institution?.name ?? "the institution"),
      };
    },
    async begin(job, installation) {
      const { data, error } = await db.rpc("begin_push_dispatch", {
        p_job: job.id,
        p_owner: job.lease_owner,
        p_installation: installation.id,
      });
      if (error) throw new Error("Unable to fence FCM dispatch");
      return String(data);
    },
    async finish(job, installation, result) {
      const status = result.ok
        ? "provider_accepted"
        : result.kind === "retryable"
          ? "pending"
          : result.kind === "invalid_device"
            ? "invalid_device"
            : result.kind === "unconfirmed"
              ? "unconfirmed"
              : "failed";
      const { data, error } = await db.rpc("finish_push_dispatch", {
        p_job: job.id,
        p_owner: job.lease_owner,
        p_installation: installation.id,
        p_status: status,
        p_provider_id: result.ok ? result.providerId : null,
        p_code: result.ok ? null : result.code,
      });
      return !error && data === true;
    },
    async complete(job, suppressed) {
      const { data, error } = await db.rpc("complete_push_job", {
        p_job: job.id,
        p_owner: job.lease_owner,
        p_suppressed: suppressed,
      });
      if (error) throw new Error("Unable to complete push job");
      return String(data);
    },
  };
}

function payload(loaded: Loaded): { title: string; body: string } {
  const metadata = (loaded.communication["metadata"] ?? {}) as Record<string, unknown>;
  const dateValue = String(metadata["attendance_date"] ?? "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(
        new Date(`${dateValue}T12:00:00Z`),
      )
    : "today";
  let body = `${String(loaded.student["name"] ?? "Your student")} was marked absent on ${date}. Please contact the institution if this is incorrect.`;
  if (loaded.template) {
    try {
      body = renderSmsTemplate(loaded.template, {
        institution_name: loaded.institutionName,
        guardian_name: String(loaded.guardian["name"] ?? ""),
        student_name: String(loaded.student["name"] ?? ""),
        attendance_date: dateValue,
      });
    } catch {
      /* Keep a minimal English fallback. */
    }
  }
  return { title: "Attendance Alert", body: body.slice(0, 350) };
}

export async function processPushJobs(
  limit = 20,
  dependencies: {
    store?: PushWorkerStore;
    send?: (input: PushInput, dryRun?: boolean) => Promise<PushResult>;
    verify?: () => Promise<void>;
  } = {},
): Promise<{ claimed: number; completed: number; retried: number; failed: number }> {
  if (!dependencies.store) {
    if (process.env["FCM_DELIVERY_MODE"] !== "live")
      return { claimed: 0, completed: 0, retried: 0, failed: 0 };
    await (dependencies.verify ?? verifyFcmAdminAuthentication)();
  }
  const store = dependencies.store ?? supabaseStore();
  const send = dependencies.send ?? sendGuardianNotification;
  const jobs = await store.claim(limit);
  const summary = { claimed: jobs.length, completed: 0, retried: 0, failed: 0 };
  for (const job of jobs) {
    try {
      const loaded = await store.load(job);
      if (!loaded?.eligible) {
        const status = await store.complete(job, true);
        if (status === "lease_lost") throw new Error("Push job lease lost");
        summary.completed++;
        continue;
      }
      const message = payload(loaded);
      for (const installation of loaded.installations) {
        const fence = await store.begin(job, installation);
        if (fence === "lease_lost") throw new Error("Push job lease lost");
        if (fence !== "send") continue;
        const result = await send({
          installationId: installation.firebase_installation_id,
          title: message.title,
          body: message.body,
          communicationId: job.communication_id,
          idempotencyKey: `${job.idempotency_key}:${installation.id}`,
        });
        if (!(await store.finish(job, installation, result)))
          throw new Error("Push dispatch result could not be persisted");
      }
      const status = await store.complete(job, false);
      if (status === "lease_lost") throw new Error("Push job lease lost");
      if (status === "queued") summary.retried++;
      else if (status === "failed" || status === "unconfirmed") summary.failed++;
      else summary.completed++;
    } catch (error) {
      // The lease expires; an uncertain send becomes unconfirmed, never replayed.
      summary.failed++;
      console.error("[push-worker] job failed", {
        jobId: job.id,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return summary;
}
