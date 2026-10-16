import { createClient } from "@supabase/supabase-js";
import { fetchFast2SmsReport } from "./fast2sms-provider.ts";
import { workerAuthorized } from "./worker-auth.ts";
import { handleControlledSmsTrial } from "./controlled-sms-trial.ts";
import { readFast2SmsAccount } from "./fast2sms-account.ts";
import { handleSmsTransportTest } from "./sms-transport-test.ts";

/** Operator-only readiness, delivery reports and one explicitly configured trial. */
export async function handleFast2SmsRequest(request: Request): Promise<Response> {
  if (
    !workerAuthorized(
      request.method,
      request.headers.get("authorization"),
      process.env["COMMUNICATION_WORKER_SECRET"],
    )
  )
    return new Response("Unauthorized", { status: 401 });
  const headers = { "Cache-Control": "no-store" };
  if (new URL(request.url).pathname.endsWith("/account")) return readFast2SmsAccount(request);
  if (new URL(request.url).pathname.endsWith("/transport-test"))
    return handleSmsTransportTest(request);
  if (new URL(request.url).pathname.endsWith("/trial")) return handleControlledSmsTrial(request);
  if (new URL(request.url).pathname.endsWith("/readiness")) {
    return Response.json(
      {
        provider: process.env["SMS_PROVIDER"] ?? "fast2sms",
        priority: "PRIMARY",
        route: "q",
        secretPresent: Boolean(process.env["FAST2SMS_API_KEY"]),
        deliveryMode: process.env["SMS_DELIVERY_MODE"] ?? "disabled",
        controlledOnly: process.env["SMS_CONTROLLED_ONLY"] === "true",
        projectHost: process.env["SUPABASE_URL"]
          ? new URL(process.env["SUPABASE_URL"]!).hostname
          : null,
        twilioActiveForSms: false,
        fcmRequired: false,
      },
      { headers },
    );
  }
  if (!new URL(request.url).pathname.endsWith("/report"))
    return new Response("Not Found", { status: 404 });
  try {
    const input = await request.json();
    if (
      typeof input?.communicationId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(input.communicationId)
    )
      return new Response("Invalid communication", { status: 400 });
    const db = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data, error } = await db
      .from("communications")
      .select("id,institution_id,provider_message_id,parent_phone")
      .eq("id", input.communicationId)
      .eq("provider_name", "fast2sms")
      .eq("type", "sms")
      .single();
    if (error || !data?.provider_message_id || !data.parent_phone)
      return new Response("No accepted Fast2SMS dispatch", { status: 409 });
    const report = await fetchFast2SmsReport(data.provider_message_id, data.parent_phone);
    const result = await db.rpc("apply_fast2sms_report", {
      p_request_id: data.provider_message_id,
      p_status: report.status,
      p_description: report.description,
    });
    if (result.error) throw new Error("Report persistence failed");
    return Response.json({ report, persisted: result.data }, { headers });
  } catch {
    return Response.json(
      { error: "Delivery report unavailable; no SMS was sent or retried" },
      { status: 503, headers },
    );
  }
}
