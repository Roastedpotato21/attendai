// Read-only evidence collection. No provider sends or database mutations.
import { createClient } from "@supabase/supabase-js";
const env = process.env;
if (new URL(env.SUPABASE_URL).hostname !== "elebygmdftfjgecauyiq.supabase.co")
  throw new Error("Unexpected project");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: communication, error } = await db
  .from("communications")
  .select(
    "id,institution_id,parent_id,student_id,message_status,provider_name,provider_message_id,provider_event_id,error_details,body,created_at,processed_at,metadata,communication_jobs(id,status,attempts,last_error,provider_request_started_at,created_at,updated_at,completed_at,payload),sms_dispatches(provider,status,provider_message_id,http_status,provider_code)",
  )
  .eq("id", "8529906c-bc04-4041-828d-94afb5293a68")
  .single();
if (error) throw new Error("Unable to read historical communication");
const { data: parent, error: parentError } = await db
  .from("parents")
  .select("phone")
  .eq("id", communication.parent_id)
  .eq("institution_id", communication.institution_id)
  .single();
if (parentError) throw new Error("Unable to read controlled recipient");
const sid = env.TWILIO_ACCOUNT_SID;
const token = env.TWILIO_AUTH_TOKEN;
if (!sid || !token) throw new Error("Twilio read credentials missing");
const safe = (value) =>
  String(value ?? "")
    .split(token)
    .join("[redacted]")
    .split(sid)
    .join("[account]")
    .replace(/\+?\d{10,15}/g, "[recipient]");
const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
async function read(label, url, select) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Basic " + Buffer.from(sid + ":" + token).toString("base64") },
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    return {
      label,
      httpStatus: response.status,
      ...(response.ok ? select(data) : { errorCode: data.code, message: safe(data.message) }),
    };
  } catch {
    return { label, error: "Evidence endpoint unavailable" };
  }
}
const results = await Promise.all([
  read(
    "all account messages (includes unsent records)",
    base + "/Messages.json?PageSize=1000",
    (d) => ({
      hasMore: Boolean(d.next_page_uri),
      totalOnPage: d.messages.length,
      matchingTimeWindow: d.messages
        .filter(
          (m) =>
            Math.abs(Date.parse(m.date_created) - Date.parse("2026-10-05T08:48:39Z")) <
            60 * 60 * 1000,
        )
        .map((m) => ({
          sid: m.sid,
          status: m.status,
          created: m.date_created,
          sent: m.date_sent,
          errorCode: m.error_code,
          error: safe(m.error_message),
          destinationMatches: m.to === parent.phone,
          senderMatches: m.from === env.TWILIO_PHONE_NUMBER,
        })),
    }),
  ),
  read(
    "legacy October 5 notification/error logs",
    base + "/Notifications.json?MessageDate=2026-10-05&PageSize=1000",
    (d) => ({
      hasMore: Boolean(d.next_page_uri),
      notifications: d.notifications.map((n) => ({
        sid: n.sid,
        date: n.message_date,
        errorCode: n.error_code,
        message: safe(n.message_text),
        requestMethod: n.request_method,
      })),
    }),
  ),
  read("account identity", base + ".json", (d) => ({
    accountMatches: d.sid === sid,
    type: d.type,
    status: d.status,
    created: d.date_created,
  })),
  read(
    "recipient messages",
    base + "/Messages.json?PageSize=1000&To=" + encodeURIComponent(parent.phone),
    (d) => ({
      hasMore: Boolean(d.next_page_uri),
      messages: d.messages.map((m) => ({
        sid: m.sid,
        status: m.status,
        date: m.date_created,
        errorCode: m.error_code,
      })),
    }),
  ),
  read(
    "October 5-7 outbound SMS usage",
    base +
      "/Usage/Records.json?Category=sms-outbound&StartDate=2026-10-05&EndDate=2026-10-07&PageSize=1000",
    (d) => ({
      hasMore: Boolean(d.next_page_uri),
      records: d.usage_records.map((r) => ({
        category: r.category,
        start: r.start_date,
        end: r.end_date,
        count: r.count,
        usage: r.usage,
        unit: r.usage_unit,
      })),
    }),
  ),
  read(
    "October 5 request alerts",
    "https://monitor.twilio.com/v1/Alerts?StartDate=2026-10-05T08%3A40%3A00Z&EndDate=2026-10-05T09%3A10%3A00Z&PageSize=1000",
    (d) => ({
      hasMore: Boolean(d.meta?.next_page_url),
      alerts: d.alerts.map((a) => ({
        sid: a.sid,
        generated: a.date_generated,
        errorCode: a.error_code,
        resourceSid: a.resource_sid,
        text: safe(a.alert_text),
      })),
    }),
  ),
  read(
    "account audit events since October 5",
    "https://monitor.twilio.com/v1/Events?StartDate=2026-10-05T00%3A00%3A00Z&PageSize=1000",
    (d) => ({
      hasMore: Boolean(d.meta?.next_page_url),
      events: d.events.map((e) => ({
        sid: e.sid,
        date: e.event_date,
        type: e.event_type,
        resourceType: e.resource_type,
      })),
    }),
  ),
]);
const { data: callbacks, error: callbackError } = await db
  .from("communication_webhook_events")
  .select("provider_name,provider_event_id,event_type,normalized_status,received_at")
  .eq("communication_id", communication.id)
  .eq("institution_id", communication.institution_id);
const { data: audit, error: auditError } = await db
  .from("audit_logs")
  .select("id,action,entity_type,entity_id,created_at,metadata")
  .eq("institution_id", communication.institution_id)
  .or(`entity_id.eq.${communication.id},entity_id.eq.185d512d-2e26-4a43-a2e5-d0fbbbcd5cdb`);
const { data: student } = await db
  .from("students")
  .select("name")
  .eq("id", communication.student_id)
  .eq("institution_id", communication.institution_id)
  .single();
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      communication: {
        ...communication,
        error_details: safe(communication.error_details),
        communication_jobs: communication.communication_jobs.map((j) => ({
          ...j,
          last_error: safe(j.last_error),
        })),
      },
      callbacks: callbackError ? "unavailable" : callbacks,
      relatedAudit: auditError
        ? "unavailable"
        : audit?.map((row) => ({
            id: row.id,
            action: safe(row.action),
            entityType: row.entity_type,
            created: row.created_at,
            metadataKeys: Object.keys(row.metadata ?? {}),
            messageSids: JSON.stringify(row.metadata).match(/\bSM[a-fA-F0-9]{32}\b/g) ?? [],
          })),
      student: student?.name,
      configuredSender: env.TWILIO_PHONE_NUMBER ? safe(env.TWILIO_PHONE_NUMBER) : "NONE",
      destination: parent.phone.slice(0, 3) + "******" + parent.phone.slice(-4),
      evidence: results,
      providerSendRequests: 0,
      historicalRecordsChanged: 0,
    },
    null,
    2,
  ),
);
