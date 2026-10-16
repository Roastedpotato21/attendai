import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import {
  Fast2SmsProvider,
  fast2SmsNumber,
  parseFast2SmsReport,
  fetchFast2SmsReport,
} from "../src/lib/server/fast2sms-provider.ts";
import { TwilioProvider } from "../src/lib/server/sms-provider.ts";
import { handleFast2SmsRequest } from "../src/lib/server/fast2sms-endpoint.ts";
import { processCommunicationJobs } from "../src/lib/server/communication-worker.ts";
import { handleControlledSmsTrial } from "../src/lib/server/controlled-sms-trial.ts";
import { readFast2SmsAccount } from "../src/lib/server/fast2sms-account.ts";
import { handleSmsTransportTest } from "../src/lib/server/sms-transport-test.ts";

process.env.FAST2SMS_API_KEY = "unit-fast-secret";
test("controlled send rejects an unconfigured or mismatched execution before touching data", async () => {
  delete process.env.SMS_TRIAL_EXECUTION_KEY;
  const request = () =>
    new Request("https://example.invalid/trial", {
      method: "POST",
      body: JSON.stringify({ action: "send", executionKey: "other" }),
    });
  assert.equal((await handleControlledSmsTrial(request())).status, 403);
  process.env.SMS_TRIAL_EXECUTION_KEY = "expected";
  assert.equal((await handleControlledSmsTrial(request())).status, 403);
});
const input = {
  recipient: "+919876543210",
  body: "Student absent 2026-10-05",
  communicationId: "test-communication",
};
const provider = new Fast2SmsProvider();
let calls = [];
let reply;
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  if (reply instanceof Error) throw reply;
  return reply();
};

test("Quick SMS uses one authenticated POST, a single Indian number and the rendered body", async () => {
  reply = () => Response.json({ return: true, request_id: "request-1" });
  const before = calls.length;
  const result = await provider.send(input);
  assert.equal(calls.length, before + 1);
  assert.equal(result.providerId, "request-1");
  assert.equal(result.status, "queued");
  assert.equal(calls.at(-1).url, "https://www.fast2sms.com/dev/bulkV2");
  assert.equal(calls.at(-1).options.method, "POST");
  assert.equal(calls.at(-1).options.redirect, "manual");
  assert.equal(calls.at(-1).options.headers.Authorization, "unit-fast-secret");
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    route: "q",
    numbers: "9876543210",
    message: input.body,
    sms_details: "1",
    udf1: input.communicationId,
  });
});

test("explicit rejection persists code and sanitized detail with no retry", async () => {
  reply = () =>
    Response.json({
      return: false,
      status_code: 412,
      message: "unit-fast-secret rejected +919876543210",
    });
  const before = calls.length;
  const result = await provider.send(input);
  assert.equal(result.errorClass, "permanent");
  assert.equal(result.providerCode, "412");
  assert.equal(result.httpStatus, 200);
  assert.doesNotMatch(result.message, /unit-fast-secret|9876543210/);
  assert.equal(calls.length, before + 1);
});

test("Fast2SMS account restriction 999 is preserved as safe response evidence", async () => {
  reply = () =>
    Response.json(
      {
        status_code: 999,
        message: "You need to complete one transaction of 100 INR or more before using API route.",
      },
      { status: 400 },
    );
  const before = calls.length;
  const result = await provider.send(input);
  assert.equal(calls.length, before + 1);
  assert.equal(result.httpStatus, 400);
  assert.equal(result.providerCode, "999");
  assert.match(result.safeResponseBody, /complete one transaction of 100 INR/);
});

test("missing request ID, malformed response, 5xx and network errors remain unconfirmed", async () => {
  for (const response of [
    () => Response.json({ return: true }),
    () => new Response("bad json"),
    () => Response.json({ return: false }, { status: 503 }),
    new Error("private details"),
  ]) {
    reply = response;
    const before = calls.length;
    const result = await provider.send(input);
    assert.equal(result.errorClass, "ambiguous");
    assert.doesNotMatch(result.message, /private details/);
    assert.equal(calls.length, before + 1);
  }
});

test("invalid destinations and retired Twilio never make a provider request", async () => {
  const before = calls.length;
  for (const phone of [
    "+12025550123",
    "9876543210",
    "+915876543210",
    "+919876543210,+919876543211",
  ]) {
    assert.equal(fast2SmsNumber(phone), null);
    assert.equal((await provider.send({ ...input, recipient: phone })).ok, false);
  }
  assert.equal((await new TwilioProvider().send()).ok, false);
  delete process.env.FAST2SMS_API_KEY;
  assert.equal((await provider.send(input)).ok, false);
  process.env.FAST2SMS_API_KEY = "unit-fast-secret";
  assert.equal(calls.length, before);
});

test("diagnostics retain HTTP and sanitized body on parse and stream failures", async () => {
  reply = () => new Response("unit-fast-secret +919876543210 invalid json", { status: 502 });
  let result = await provider.send(input);
  assert.equal(result.httpStatus, 502);
  assert.equal(result.diagnostics.stage, "parse_json");
  assert.doesNotMatch(JSON.stringify(result), /unit-fast-secret|9876543210/);
  reply = () => ({
    status: 403,
    text: async () => {
      throw new Error("unit-fast-secret body error");
    },
  });
  result = await provider.send(input);
  assert.equal(result.httpStatus, 403);
  assert.equal(result.diagnostics.stage, "read_body");
  assert.doesNotMatch(JSON.stringify(result), /unit-fast-secret/);
  reply = new TypeError("unit-fast-secret outbound failure");
  result = await provider.send(input);
  assert.equal(result.diagnostics.stage, "fetch");
  assert.match(result.diagnostics.error, /outbound failure/);
});

test("account diagnostics use only wallet POST and logs GET and expose safe error 999", async () => {
  reply = () =>
    Response.json(
      { return: false, status_code: 999, message: "minimum transaction required" },
      { status: 400 },
    );
  for (const action of ["wallet", "logs"]) {
    const result = await readFast2SmsAccount(
      new Request("https://example.invalid/account", {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    );
    assert.equal((await result.json()).httpStatus, 400);
    assert.equal(calls.at(-1).options.method, action === "wallet" ? "POST" : "GET");
    assert.match(
      calls.at(-1).url,
      action === "wallet" ? /\/dev\/wallet$/ : /\/dev\/sms_logs\?from=2026-10-11&to=2026-10-12/,
    );
  }
  const before = calls.length;
  assert.equal(
    (
      await readFast2SmsAccount(
        new Request("https://example.invalid/account", {
          method: "POST",
          body: '{"action":"send"}',
        }),
      )
    ).status,
    400,
  );
  assert.equal(calls.length, before);
});

const reportPayload = (status, requestId = "request-1", mobile = 9876543210) => ({
  success: true,
  data: [{ request_id: requestId, route: "q", delivery_status: [{ mobile, status }] }],
});
test("delivery reports bind request and recipient, and never call pending delivered", () => {
  for (const status of ["Delivered", "Failed", "Pending", "Sent", "unexpected"])
    assert.equal(
      parseFast2SmsReport(reportPayload(status), "request-1", input.recipient).status,
      status === "Delivered" ? "delivered" : status === "Failed" ? "failed" : "pending",
    );
  assert.equal(
    parseFast2SmsReport(reportPayload("Delivered", "other"), "request-1", input.recipient).status,
    "pending",
  );
  assert.equal(
    parseFast2SmsReport(
      reportPayload("Delivered", "request-1", 9876543211),
      "request-1",
      input.recipient,
    ).status,
    "pending",
  );
});
test("report lookup uses official GET API only", async () => {
  reply = () => Response.json(reportPayload("Delivered"));
  assert.equal((await fetchFast2SmsReport("request-1", input.recipient)).status, "delivered");
  assert.equal(calls.at(-1).url, "https://www.fast2sms.com/dev/dlr/request-1");
  assert.equal(calls.at(-1).options.body, undefined);
});
test("operator endpoints require authorization and reveal secret presence only", async () => {
  process.env.COMMUNICATION_WORKER_SECRET = "unit-worker";
  const url = "https://example.invalid/api/internal/communications/fast2sms/readiness";
  assert.equal((await handleFast2SmsRequest(new Request(url, { method: "POST" }))).status, 401);
  const response = await handleFast2SmsRequest(
    new Request(url, { method: "POST", headers: { authorization: "Bearer unit-worker" } }),
  );
  const text = await response.text();
  assert.equal(JSON.parse(text).secretPresent, true);
  assert.doesNotMatch(text, /unit-fast-secret/);
});
test("dedicated transport test rejects a mismatched execution before database access", async () => {
  const response = await handleSmsTransportTest(
    new Request("https://example.invalid/transport-test", {
      method: "POST",
      body: JSON.stringify({ action: "send", executionKey: "not-authorized" }),
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Transport test is not authorized");
});
test("controlled-only scheduler leaves all jobs untouched", async () => {
  process.env.SMS_CONTROLLED_ONLY = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-only";
  const before = calls.length;
  assert.deepEqual(await processCommunicationJobs(), {
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
  });
  assert.equal(calls.length, before);
});
test("Fast2SMS secret has no public VITE binding or browser import", () => {
  const files = fs
    .readdirSync("src", { recursive: true })
    .filter((path) => /\.(ts|tsx)$/.test(path));
  for (const path of files) {
    const text = fs.readFileSync("src/" + path, "utf8");
    assert.doesNotMatch(text, /VITE_FAST2SMS/);
    if (!path.replaceAll("\\", "/").startsWith("lib/server/"))
      assert.doesNotMatch(text, /FAST2SMS_API_KEY/);
  }
});
