/** Server-only Twilio delivery callbacks. Database writes follow SDK validation. */
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";

type Callback = { url: string; signature: string | null; params: Record<string, string> };

function db() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normalizeStatus(
  value: string | undefined,
): "queued" | "sent" | "delivered" | "read" | "failed" | "undelivered" {
  switch (value?.toLowerCase()) {
    case "queued":
      return "queued";
    case "accepted":
    case "sending":
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
      return "failed";
    case "undelivered":
      return "undelivered";
    default:
      throw new Error("unsupported provider status");
  }
}

/** Twilio's official SDK handles canonical URL and form-field signatures. */
export async function verifyTwilioSignature(callback: Callback): Promise<boolean> {
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!token || !callback.signature) return false;
  try {
    if (new URL(callback.url).protocol !== "https:") return false;
    return twilio.validateRequest(token, callback.signature, callback.url, callback.params);
  } catch {
    return false;
  }
}

/** Resolve the tenant from the stored provider SID, never an untrusted tenant ID. */
export async function handleTwilioStatusWebhook(
  callback: Callback,
): Promise<{ duplicate: boolean; status: string }> {
  if (!(await verifyTwilioSignature(callback))) throw new Error("invalid Twilio webhook signature");
  const providerId = callback.params["MessageSid"];
  if (!providerId) throw new Error("Twilio callback has no message SID");
  const status = normalizeStatus(callback.params["MessageStatus"] ?? callback.params["SmsStatus"]);
  const communicationId = new URL(callback.url).searchParams.get("communication_id");
  const { data, error } = await db().rpc("apply_communication_callback", {
    p_sid: providerId,
    p_status: status,
    p_communication_id: communicationId,
  });
  if (error) throw new Error("callback persistence rejected");
  return data as { duplicate: boolean; status: string };
}
