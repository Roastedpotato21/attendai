/** Server-only Twilio delivery callback handling for Phase 3B. */
import { createClient } from "@supabase/supabase-js";

type Callback = { url: string; signature: string | null; params: Record<string, string> };

function db() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normalizeStatus(
  value: string | undefined,
): "queued" | "sent" | "delivered" | "read" | "failed" {
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
    case "undelivered":
      return "failed";
    default:
      throw new Error("unsupported provider status");
  }
}

/** Twilio signs URL + alphabetically ordered form fields with HMAC-SHA1. */
export async function verifyTwilioSignature(callback: Callback): Promise<boolean> {
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!token || !callback.signature) return false;
  const expectedPayload =
    callback.url +
    Object.keys(callback.params)
      .sort()
      .map((key) => `${key}${callback.params[key] ?? ""}`)
      .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expectedPayload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(raw)));
  if (expected.length !== callback.signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++)
    mismatch |= expected.charCodeAt(index) ^ callback.signature.charCodeAt(index);
  return mismatch === 0;
}

/**
 * Call only after reading the raw form body at the API boundary. The callback
 * never accepts an institution ID: tenant resolution comes from the stored
 * Twilio SID, after a valid signature is verified.
 */
export async function handleTwilioStatusWebhook(
  callback: Callback,
): Promise<{ duplicate: boolean; status: string }> {
  if (!(await verifyTwilioSignature(callback))) throw new Error("invalid Twilio webhook signature");
  const providerId = callback.params["MessageSid"] ?? callback.params["CallSid"];
  if (!providerId) throw new Error("Twilio callback has no provider SID");
  const provider = "twilio";
  const status = normalizeStatus(callback.params["MessageStatus"] ?? callback.params["CallStatus"]);
  const { data, error } = await db().rpc("apply_communication_callback", {
    p_sid: providerId,
    p_status: status,
  });
  if (error) throw new Error("callback persistence rejected");
  return data as { duplicate: boolean; status: string };
}
