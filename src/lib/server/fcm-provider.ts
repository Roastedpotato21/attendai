/** Trusted-server FCM HTTP v1 adapter. Browser bundles must never import this. */
import { readFileSync } from "node:fs";

export type PushFailure = {
  ok: false;
  kind: "retryable" | "invalid_device" | "permanent" | "unconfirmed";
  code: string;
};
export type PushResult = { ok: true; providerId: string } | PushFailure;
export type PushInput = {
  installationId: string;
  title: string;
  body: string;
  communicationId: string;
  idempotencyKey: string;
};

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
const projectId = "attendai-41f64";
// Six hours fits the current attendance freshness rule. Operators may choose
// one to 24 hours; invalid values fail closed before any provider request.
const configuredAttendanceTtl = Number(process.env["ATTENDANCE_PUSH_TTL_SECONDS"] ?? 6 * 60 * 60);
if (
  !Number.isInteger(configuredAttendanceTtl) ||
  configuredAttendanceTtl < 3600 ||
  configuredAttendanceTtl > 86400
)
  throw new Error("ATTENDANCE_PUSH_TTL_SECONDS must be 3600-86400");
export const ATTENDANCE_PUSH_TTL_SECONDS = configuredAttendanceTtl;
export const OFFLINE_TEST_TTL_SECONDS = 5 * 60;
const tokenEndpoint = "https://oauth2.googleapis.com/token";
let cachedToken: { value: string; expiresAt: number } | undefined;

const retryableCodes = new Set([
  "messaging/server-unavailable",
  "messaging/internal-error",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded",
  "messaging/topics-message-rate-exceeded",
]);
const invalidDeviceCodes = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-recipient",
]);

export function classifyFcmError(error: unknown): PushFailure {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown";
  if (retryableCodes.has(code)) return { ok: false, kind: "retryable", code };
  if (invalidDeviceCodes.has(code)) return { ok: false, kind: "invalid_device", code };
  if (code === "unknown") return { ok: false, kind: "unconfirmed", code: "unknown" };
  return { ok: false, kind: "permanent", code };
}

function serviceAccount(): ServiceAccount {
  try {
    const secret = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
    const path = process.env["GOOGLE_APPLICATION_CREDENTIALS"];
    const parsed = JSON.parse(
      secret ?? (path ? readFileSync(path, "utf8") : ""),
    ) as Partial<ServiceAccount>;
    if (
      parsed.project_id !== projectId ||
      !parsed.client_email?.endsWith(`@${projectId}.iam.gserviceaccount.com`) ||
      !parsed.private_key?.includes("-----BEGIN PRIVATE KEY-----")
    )
      throw new Error("FCM credential project mismatch");
    return parsed as ServiceAccount;
  } catch {
    throw new Error("FCM server authentication is invalid");
  }
}

function base64url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const account = serviceAccount();
  const rawKey = account.private_key.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  const binaryKey = Uint8Array.from(atob(rawKey), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenEndpoint,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64url(signature)}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("FCM server authentication is invalid");
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token || !Number.isFinite(data.expires_in) || Number(data.expires_in) < 60)
    throw new Error("FCM server authentication is invalid");
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
  };
  return cachedToken.value;
}

export async function verifyFcmAdminAuthentication(): Promise<void> {
  if (process.env["FIREBASE_PROJECT_ID"] !== projectId)
    throw new Error("FCM project is not verified");
  await accessToken();
}

function errorCode(body: unknown, status: number): string {
  const error = body && typeof body === "object" && "error" in body ? body.error : null;
  const details = error && typeof error === "object" && "details" in error ? error.details : null;
  const fcmCode = Array.isArray(details)
    ? details.find((detail) => detail && typeof detail === "object" && "errorCode" in detail)
        ?.errorCode
    : undefined;
  if (fcmCode === "UNREGISTERED") return "messaging/registration-token-not-registered";
  // INVALID_ARGUMENT also covers payload errors; it does not prove the device is stale.
  if (fcmCode === "INVALID_ARGUMENT") return "messaging/invalid-argument";
  if (fcmCode === "QUOTA_EXCEEDED" || status === 429) return "messaging/message-rate-exceeded";
  if (status >= 500) return "messaging/server-unavailable";
  return "messaging/fcm-http-error";
}

export async function sendGuardianNotification(
  input: PushInput,
  dryRun = false,
): Promise<PushResult> {
  if (
    !input.installationId ||
    input.installationId.length > 256 ||
    !input.title ||
    input.title.length > 100 ||
    !input.body ||
    input.body.length > 350 ||
    !/^[0-9a-f-]{36}$/i.test(input.communicationId) ||
    !input.idempotencyKey ||
    input.idempotencyKey.length > 300
  )
    return { ok: false, kind: "permanent", code: "invalid_payload" };
  try {
    if (process.env["FIREBASE_PROJECT_ID"] !== projectId)
      throw new Error("FCM project is not verified");
    const link = new URL("/guardian-notifications", process.env["ATTENDAI_APP_URL"]);
    link.searchParams.set("event", input.communicationId);
    if (link.protocol !== "https:") throw new Error("HTTPS app URL is required");
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          validate_only: dryRun,
          message: {
            fid: input.installationId,
            notification: { title: input.title, body: input.body },
            data: { communicationId: input.communicationId },
            webpush: {
              fcm_options: { link: link.toString() },
              headers: { Urgency: "high", TTL: String(ATTENDANCE_PUSH_TTL_SECONDS) },
              notification: {
                tag: input.communicationId,
                icon: new URL("/favicon.ico", link).toString(),
              },
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const result = (await response.json()) as { name?: string };
    if (!response.ok) return classifyFcmError({ code: errorCode(result, response.status) });
    if (!result.name?.startsWith(`projects/${projectId}/messages/`))
      return { ok: false, kind: "unconfirmed", code: "unknown" };
    return { ok: true, providerId: result.name };
  } catch (error) {
    return classifyFcmError(error);
  }
}

/** One explicitly controlled test message. Never contains an attendance claim. */
export async function sendControlledDeliveryTest(
  input: {
    installationId: string;
    testId: string;
    mode: "online" | "offline" | "guardian";
    studentName?: string;
  },
  dryRun = false,
): Promise<PushResult> {
  const studentName = input.studentName?.trim().replace(/\s+/g, " ");
  if (
    !input.installationId ||
    input.installationId.length > 256 ||
    !/^[0-9a-f-]{36}$/i.test(input.testId) ||
    (input.mode === "guardian" && (!studentName || studentName.length > 120))
  )
    return { ok: false, kind: "permanent", code: "invalid_payload" };
  try {
    if (process.env["FIREBASE_PROJECT_ID"] !== projectId)
      throw new Error("FCM project is not verified");
    const link = new URL("/guardian-notifications", process.env["ATTENDAI_APP_URL"]);
    link.searchParams.set("test", input.mode);
    link.searchParams.set("id", input.testId);
    if (link.protocol !== "https:") throw new Error("HTTPS app URL is required");
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          validate_only: dryRun,
          message: {
            fid: input.installationId,
            notification: {
              title:
                input.mode === "guardian"
                  ? "AttendAI Notification Test"
                  : `AttendAI ${input.mode === "online" ? "Online Push" : "Offline Delivery"} Test`,
              body:
                input.mode === "guardian"
                  ? `Notifications are enabled for ${studentName}. No attendance action is required.`
                  : input.mode === "online"
                    ? "This is a test notification. No attendance action is required."
                    : "This test checks delayed notification delivery after internet reconnects.",
            },
            data: { testId: input.testId, testMode: input.mode },
            webpush: {
              fcm_options: { link: link.toString() },
              headers: { Urgency: "high", TTL: String(OFFLINE_TEST_TTL_SECONDS) },
              notification: {
                tag: `${input.mode}-test-${input.testId}`,
                icon: new URL("/favicon.ico", link).toString(),
              },
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const result = (await response.json()) as { name?: string };
    if (!response.ok) return classifyFcmError({ code: errorCode(result, response.status) });
    if (!result.name?.startsWith(`projects/${projectId}/messages/`))
      return { ok: false, kind: "unconfirmed", code: "unknown" };
    return { ok: true, providerId: result.name };
  } catch (error) {
    return classifyFcmError(error);
  }
}

export function sendOfflineDeliveryTest(input: {
  installationId: string;
  testId: string;
}): Promise<PushResult> {
  return sendControlledDeliveryTest({ ...input, mode: "offline" });
}

export function sendGuardianTransportTest(
  input: {
    installationId: string;
    testId: string;
    studentName: string;
  },
  dryRun = false,
): Promise<PushResult> {
  return sendControlledDeliveryTest({ ...input, mode: "guardian" }, dryRun);
}
