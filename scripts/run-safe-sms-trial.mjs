// Operator tool: send performs ONE HTTP call, never retries. All output is masked.
import { createClient } from "@supabase/supabase-js";
const executionKey = "fast2sms-20261012-student-one-oct02-v1";
const action = process.argv[2];
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
if (new URL(process.env.SUPABASE_URL).hostname !== "elebygmdftfjgecauyiq.supabase.co")
  throw new Error("Unexpected project");
async function read(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
async function endpoint(path, body) {
  const r = await fetch(
    "https://attendai.attendai-expresspotato44.workers.dev/api/internal/communications/fast2sms/" +
      path,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: {
        Authorization: "Bearer " + process.env.COMMUNICATION_WORKER_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const raw = await r.text();
  // Never print phone numbers accidentally included in provider descriptions.
  console.log(
    JSON.stringify({
      httpStatus: r.status,
      response: raw.replace(/\+?\d{10,15}/g, "[redacted-number]"),
    }),
  );
}
if (action === "prepare") {
  const trial = await read(
    db.rpc("prepare_safe_sms_trial", {
      p_execution_key: executionKey,
      p_session: "066cf231-6482-48b3-9cb5-f3cc4c93b227",
      p_student: "c2262eaf-d1a6-48bf-a406-857ac57c823c",
      p_guardian: "8e8bedcb-c46a-4642-b165-b0a29946d7cf",
    }),
  );
  console.log(JSON.stringify(trial));
} else if (action === "preflight" || action === "send") {
  await endpoint("trial", { executionKey, action });
} else if (action === "inspect" || action === "report") {
  const trial = await read(
    db
      .from("sms_controlled_trials")
      .select("communication_id,job_id")
      .eq("execution_key", executionKey)
      .single(),
  );
  if (action === "report") {
    await endpoint("report", { communicationId: trial.communication_id });
  } else {
    const row = await read(
      db
        .from("communications")
        .select(
          "id,message_status,provider_name,provider_message_id,body,error_details,communication_jobs(id,status,attempts,max_attempts,provider_request_started_at),sms_dispatches(id,provider,status,provider_message_id,provider_status,http_status,provider_code,error_message,submitted_at,finished_at)",
        )
        .eq("id", trial.communication_id)
        .single(),
    );
    console.log(JSON.stringify(row).replace(/\+?\d{10,15}/g, "[redacted-number]"));
  }
} else throw new Error("Choose prepare, preflight, send, inspect or report");
