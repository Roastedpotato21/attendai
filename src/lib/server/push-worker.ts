/** FCM outbox worker. The scheduler calls this only with an explicit live gate. */
import { createClient } from "@supabase/supabase-js";
import { GUARDIAN_NOTIFICATION_CONSENT_VERSION } from "../guardian-consent.ts";
import {
  isFreshAttendanceSession,
  type AttendanceSessionFreshness,
} from "./attendance-freshness.ts";
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
  institutionName: string;
};

export type PushWorkerStore = {
  claim: (limit: number) => Promise<PushJob[]>;
  claimSpecific?: (jobId: string) => Promise<PushJob[]>;
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
    async claimSpecific(jobId) {
      const { data, error } = await db.rpc("claim_specific_push_job", { p_job: jobId });
      if (error) throw new Error("Unable to claim controlled push job");
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
          .select("status,attendance_sessions!inner(date,created_at,status,institution_id)")
          .eq("institution_id", job.institution_id)
          .eq("student_id", communication["student_id"])
          .eq("session_id", metadata["attendance_session_id"])
          .maybeSingle(),
        db
          .from("guardian_notification_installations")
          .select(
            "id,firebase_installation_id,guardian_notification_consents!inner(status,consent_version,revoked_at)",
          )
          .eq("institution_id", job.institution_id)
          .eq("guardian_id", communication["parent_id"])
          .eq("active", true)
          .is("revoked_at", null)
          .eq("firebase_project_id", "attendai-41f64")
          .eq("permission_state", "granted")
          .eq("guardian_notification_consents.status", "accepted")
          .eq(
            "guardian_notification_consents.consent_version",
            GUARDIAN_NOTIFICATION_CONSENT_VERSION,
          )
          .is("guardian_notification_consents.revoked_at", null)
          .gte("last_seen_at", new Date(Date.now() - 90 * 86400000).toISOString()),
        db.from("institutions").select("name").eq("id", job.institution_id).maybeSingle(),
      ]);
      if (relationshipError || attendanceError || installationError || institutionError)
        throw new Error("Unable to verify push eligibility");
      const sessionRelation = attendance?.attendance_sessions as unknown;
      const session = (Array.isArray(sessionRelation) ? sessionRelation[0] : sessionRelation) as
        AttendanceSessionFreshness | undefined;
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
        session?.institution_id === job.institution_id &&
        isFreshAttendanceSession(session) &&
        metadata["purpose"] === "absence-alert";
      return {
        communication,
        guardian,
        student,
        eligible,
        installations: (installations ?? []) as Installation[],
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

export function renderPushPayload(loaded: Loaded): { title: string; body: string } {
  const metadata = (loaded.communication["metadata"] ?? {}) as Record<string, unknown>;
  const dateValue = String(metadata["attendance_date"] ?? "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(
        new Date(`${dateValue}T12:00:00Z`),
      )
    : "today";
  const body = `Dear Parent, ${String(loaded.student["name"] ?? "your student")} was marked absent on ${date}. Please contact ${loaded.institutionName} if you believe this is incorrect.`;
  return { title: "Attendance Alert", body: body.slice(0, 350) };
}

export async function processPushJobs(
  limit = 20,
  dependencies: {
    store?: PushWorkerStore;
    send?: (input: PushInput, dryRun?: boolean) => Promise<PushResult>;
    verify?: () => Promise<void>;
    targetJobId?: string;
    requireSingleInstallation?: boolean;
  } = {},
): Promise<{ claimed: number; completed: number; retried: number; failed: number }> {
  if (!dependencies.store) {
    if (!dependencies.targetJobId && process.env["FCM_DELIVERY_MODE"] !== "live")
      return { claimed: 0, completed: 0, retried: 0, failed: 0 };
    await (dependencies.verify ?? verifyFcmAdminAuthentication)();
  }
  const store = dependencies.store ?? supabaseStore();
  const send = dependencies.send ?? sendGuardianNotification;
  const jobs = dependencies.targetJobId
    ? await (store.claimSpecific?.(dependencies.targetJobId) ??
        Promise.reject(new Error("Specific claim unavailable")))
    : await store.claim(limit);
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
      if (dependencies.requireSingleInstallation && loaded.installations.length !== 1) {
        await store.complete(job, true);
        throw new Error("Controlled push requires exactly one eligible installation");
      }
      const message = renderPushPayload(loaded);
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
