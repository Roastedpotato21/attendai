// Read-only account/Worker metadata and a non-persisting historical log query.
// Credentials remain in memory and are never printed or copied.
import fs from "node:fs";
import path from "node:path";
const config = fs.readFileSync(
  path.join(process.env.APPDATA, "xdg.config/.wrangler/config/default.toml"),
  "utf8",
);
const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error("Existing Wrangler authentication is unavailable");
async function api(url, body) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + url, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(25000),
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}
const accounts = await api("/accounts");
if (!accounts.payload.success) {
  console.log(
    JSON.stringify({
      source: "Cloudflare",
      httpStatus: accounts.status,
      codes: accounts.payload.errors?.map((e) => e.code),
      result: "Account listing unavailable",
    }),
  );
  process.exit(2);
}
for (const account of accounts.payload.result) {
  const scripts = await api(`/accounts/${account.id}/workers/scripts`);
  const worker = scripts.payload.result?.find((s) => s.id === "attendai");
  if (!worker) continue;
  console.log(
    JSON.stringify({
      worker: worker.id,
      created: worker.created_on,
      modified: worker.modified_on,
      logpush: worker.logpush,
      observability: worker.observability,
    }),
  );
  const settings = await api(`/accounts/${account.id}/workers/scripts/attendai/settings`);
  console.log(
    JSON.stringify({
      source: "Worker settings",
      httpStatus: settings.status,
      observability: settings.payload.result?.observability ?? null,
      logpush: settings.payload.result?.logpush ?? null,
    }),
  );
  const telemetry = await api(`/accounts/${account.id}/workers/observability/telemetry/query`, {
    queryId: "attendai-oct5-readonly",
    dry: true,
    view: "events",
    limit: 2000,
    timeframe: { from: Date.parse("2026-10-05T08:40:00Z"), to: Date.parse("2026-10-05T09:10:00Z") },
    parameters: {
      filters: [{ key: "$metadata.service", operation: "eq", type: "string", value: "attendai" }],
    },
  });
  const result = telemetry.payload.result;
  // Only whitelisted diagnostic fragments are returned, never raw logs/headers.
  const evidence =
    JSON.stringify(result ?? {}).match(
      /\b(?:SM[a-fA-F0-9]{32}|httpStatus[=: ]+\d{3}|providerCode[=: ]+\d+|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)\b/g,
    ) ?? [];
  console.log(
    JSON.stringify({
      source: "October 5 Worker telemetry",
      httpStatus: telemetry.status,
      success: telemetry.payload.success,
      errors: telemetry.payload.errors?.map((e) => ({
        code: e.code,
        message: String(e.message ?? "")
          .split(token)
          .join("[redacted]"),
      })),
      resultKeys: Object.keys(result ?? {}),
      events: Array.isArray(result?.events)
        ? result.events.length
        : result?.events
          ? Object.keys(result.events)
          : null,
      statistics: result?.statistics,
      evidence,
    }),
  );
}
