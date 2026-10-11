import "./lib/error-capture";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleCommunicationWorkerRequest } from "./lib/server/communication-worker-endpoint";
import { handleTwilioStatusWebhook } from "./lib/server/communication-webhooks";
import {
  handleGuardianNotificationAdmin,
  handleGuardianNotificationDevice,
} from "./lib/server/guardian-notifications";
import {
  handleStaffInvitationRequest,
  handleStaffManagementRequest,
} from "./lib/server/staff-invitations";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (new URL(request.url).pathname === "/api/internal/communications/process") {
        return handleCommunicationWorkerRequest(request);
      }
      if (new URL(request.url).pathname === "/api/admin/guardian-notifications") {
        return handleGuardianNotificationAdmin(request);
      }
      if (new URL(request.url).pathname.startsWith("/api/guardian/notifications/")) {
        return handleGuardianNotificationDevice(request);
      }
      if (new URL(request.url).pathname === "/api/admin/staff-invitations") {
        return handleStaffInvitationRequest(request);
      }
      if (new URL(request.url).pathname === "/api/admin/staff") {
        return handleStaffManagementRequest(request);
      }
      if (new URL(request.url).pathname === "/api/webhooks/twilio/status") {
        if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
        const configuredUrl = process.env["TWILIO_WEBHOOK_PUBLIC_URL"];
        if (!configuredUrl) return new Response("Webhook is not configured", { status: 503 });
        let expected: URL;
        try {
          expected = new URL(configuredUrl);
        } catch {
          return new Response("Webhook is not configured", { status: 503 });
        }
        if (
          expected.protocol !== "https:" ||
          expected.pathname !== "/api/webhooks/twilio/status" ||
          expected.search
        ) {
          return new Response("Webhook is not configured", { status: 503 });
        }
        if (
          !(request.headers.get("content-type") ?? "")
            .toLowerCase()
            .startsWith("application/x-www-form-urlencoded")
        ) {
          return new Response("Unsupported callback content type", { status: 415 });
        }
        const body = await request.text();
        const form = new URLSearchParams(body);
        const params: Record<string, string> = {};
        for (const [key, value] of form) {
          if (Object.hasOwn(params, key))
            return new Response("Duplicate callback field", { status: 400 });
          params[key] = value;
        }
        const callbackUrl = configuredUrl + new URL(request.url).search;
        try {
          await handleTwilioStatusWebhook({
            url: callbackUrl,
            signature: request.headers.get("x-twilio-signature"),
            params,
          });
          return new Response(null, { status: 204 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "webhook rejected";
          const status = message === "invalid Twilio webhook signature" ? 403 : 400;
          console.warn("[communication-webhook] rejected", { status, reason: message });
          return new Response("Webhook rejected", { status });
        }
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
