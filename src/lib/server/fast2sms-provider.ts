import type { SmsDelivery, SmsProvider } from "./sms-provider.ts";
import { redactFast2Sms } from "./fast2sms-account.ts";

const origin = "https://www.fast2sms.com";
export function fast2SmsNumber(recipient: string): string | null {
  return /^\+91[6-9]\d{9}$/.test(recipient) ? recipient.slice(3) : null;
}

function safeMessage(value: unknown, secret: string): string {
  const text = Array.isArray(value)
    ? value.join("; ")
    : String(value ?? "Provider rejected request");
  return text
    .split(secret)
    .join("[redacted]")
    .replace(/\+?\d{10,15}/g, "[recipient]")
    .replace(/[\r\n]/g, " ")
    .slice(0, 400);
}

export class Fast2SmsProvider implements SmsProvider {
  readonly name = "fast2sms";
  validate(recipient: string): string | null {
    if (!process.env["FAST2SMS_API_KEY"]) return "Fast2SMS server credential is missing";
    if (!fast2SmsNumber(recipient)) return "Fast2SMS requires an Indian mobile number";
    return null;
  }
  async send(input: {
    recipient: string;
    body: string;
    communicationId: string;
  }): Promise<SmsDelivery> {
    const invalid = this.validate(input.recipient);
    if (invalid) return { ok: false, errorClass: "permanent", message: invalid };
    const secret = process.env["FAST2SMS_API_KEY"]!;
    const started = Date.now();
    let httpStatus: number | undefined;
    let safeResponseBody: string | undefined;
    let stage = "fetch";
    try {
      // One POST, no redirects, retries, batch recipients or scheduled sends.
      const response = await fetch(origin + "/dev/bulkV2", {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: secret,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          route: "q",
          numbers: fast2SmsNumber(input.recipient),
          message: input.body,
          sms_details: "1",
          udf1: input.communicationId,
        }),
      });
      httpStatus = response.status;
      stage = "read_body";
      const raw = await response.text();
      safeResponseBody = redactFast2Sms(raw).slice(0, 4096);
      stage = "parse_json";
      const payload = JSON.parse(raw);
      stage = "provider_response";
      const evidence = {
        httpStatus,
        safeResponseBody,
        diagnostics: {
          stage,
          elapsedMs: Date.now() - started,
          contentType: response.headers.get("content-type"),
        },
      };
      if (
        response.ok &&
        payload?.return === true &&
        typeof payload.request_id === "string" &&
        /^[A-Za-z0-9_-]{1,200}$/.test(payload.request_id)
      ) {
        return {
          ok: true,
          provider: this.name,
          providerId: payload.request_id,
          status: "queued",
          ...evidence,
        };
      }
      // A valid API rejection is terminal, including rate limits for this trial.
      // Malformed success, timeouts and server errors cannot prove non-delivery.
      const rejected =
        payload?.return === false && response.status < 500 && response.status !== 408;
      return {
        ok: false,
        errorClass: rejected ? "permanent" : "ambiguous",
        ...evidence,
        ...(typeof payload?.status_code === "number" || typeof payload?.status_code === "string"
          ? { providerCode: String(payload.status_code) }
          : {}),
        ...(typeof payload?.request_id === "string" &&
        /^[A-Za-z0-9_-]{1,200}$/.test(payload.request_id)
          ? { providerId: payload.request_id }
          : {}),
        message: rejected
          ? safeMessage(payload.message, secret)
          : "Fast2SMS outcome unknown; manual reconciliation required",
      };
    } catch (error) {
      return {
        ok: false,
        errorClass: "ambiguous",
        message: "Fast2SMS outcome unknown; manual reconciliation required",
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(safeResponseBody === undefined ? {} : { safeResponseBody }),
        diagnostics: {
          stage,
          elapsedMs: Date.now() - started,
          error: redactFast2Sms(
            error instanceof Error ? `${error.name}: ${error.message}` : "Unknown transport error",
          ).slice(0, 1000),
        },
      };
    }
  }
}

export type Fast2SmsReport = { status: "pending" | "delivered" | "failed"; description: string };
/** Match both request and recipient; never infer delivery from HTTP success. */
export function parseFast2SmsReport(
  payload: unknown,
  requestId: string,
  recipient: string,
): Fast2SmsReport {
  const pending: Fast2SmsReport = {
    status: "pending",
    description: "Delivery report pending or unrecognized",
  };
  if (
    !payload ||
    typeof payload !== "object" ||
    !("success" in payload) ||
    payload.success !== true ||
    !("data" in payload) ||
    !Array.isArray(payload.data)
  )
    return pending;
  const rows = payload.data.filter((row) => row?.request_id === requestId && row?.route === "q");
  const details = rows
    .flatMap((row) => (Array.isArray(row.delivery_status) ? row.delivery_status : []))
    .filter((row) => String(row?.mobile) === fast2SmsNumber(recipient));
  if (details.length !== 1) return pending;
  const status = String(details[0].status).toLowerCase();
  if (status === "delivered")
    return { status: "delivered", description: "Provider delivery report confirms delivered" };
  if (["failed", "undelivered", "blocked", "dnd"].includes(status))
    return { status: "failed", description: "Provider delivery report: " + status };
  return pending;
}

export async function fetchFast2SmsReport(
  requestId: string,
  recipient: string,
): Promise<Fast2SmsReport> {
  const secret = process.env["FAST2SMS_API_KEY"];
  if (!secret || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId))
    throw new Error("Fast2SMS report configuration is invalid");
  const response = await fetch(origin + "/dev/dlr/" + encodeURIComponent(requestId), {
    headers: { Authorization: secret, Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Fast2SMS delivery report unavailable");
  return parseFast2SmsReport(await response.json(), requestId, recipient);
}
