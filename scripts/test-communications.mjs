import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  deliver,
  normalizePhone,
  processCommunicationJobs,
} from "../src/lib/server/communication-worker.ts";
import {
  communicationWorkerBatchSize,
  handleCommunicationWorkerRequest,
} from "../src/lib/server/communication-worker-endpoint.ts";
import { runCommunicationSchedule } from "../src/lib/server/communication-scheduler.ts";
import { verifyTwilioSignature } from "../src/lib/server/communication-webhooks.ts";
import { workerAuthorized } from "../src/lib/server/worker-auth.ts";
import {
  attendanceConversationSchema,
  interpretAttendanceConversation,
  unparsedAttendanceConversation,
} from "../src/lib/server/voice-interpretation.ts";

// Never load .env. All provider traffic is replaced here, including AI traffic.
Object.assign(process.env, {
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "test-only",
  TWILIO_PHONE_NUMBER: "+15005550006",
  TWILIO_WHATSAPP_FROM: "+15005550006",
  TWILIO_WEBHOOK_PUBLIC_URL: "https://example.invalid/api/webhooks/twilio/status",
  OPENAI_API_KEY: "test-only",
});
const job = { channel: "sms" };
const parent = {
  phone: "98765 43210",
  name: "Parent",
  language: "en",
  active: true,
  communication_consent: true,
};
const communication = { student_name: "Student", metadata: { attendance_date: "2099-01-01" } };
let calls = [];
let response = () => new Response(JSON.stringify({ sid: "SMtest", status: "queued" }));
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  return response();
};

test("SMS normalizes phone, localizes content and returns provider identity", async () => {
  assert.equal(normalizePhone(parent.phone), "+919876543210");
  assert.equal(normalizePhone("bad"), null);
  for (const language of ["en", "hi", "te", "ta", "kn"]) {
    const result = await deliver(job, communication, { ...parent, language });
    assert.deepEqual(result, {
      ok: true,
      provider: "twilio",
      providerId: "SMtest",
      status: "queued",
    });
    const form = new URLSearchParams(calls.at(-1).options.body);
    assert.equal(form.get("To"), "+919876543210");
    assert.ok(form.get("Body").includes("Student"));
    assert.ok(form.get("Body").includes("2099-01-01"));
    assert.equal(form.get("StatusCallback"), process.env.TWILIO_WEBHOOK_PUBLIC_URL);
  }
});

test("provider HTTP errors, timeouts and network failures have bounded retry classification", async () => {
  for (const status of [408, 429, 500, 503, 400, 401, 403, 422]) {
    response = () => new Response("{}", { status });
    const result = await deliver(job, communication, parent);
    assert.equal(
      result.errorClass,
      status === 408 || status === 429 || status >= 500 ? "transient" : "permanent",
    );
  }
  for (const failure of [
    new TypeError("network failure"),
    new DOMException("timeout", "TimeoutError"),
  ]) {
    response = () => {
      throw failure;
    };
    assert.equal((await deliver(job, communication, parent)).errorClass, "transient");
  }
});

test("invalid recipient, revoked consent and missing configuration never fake delivery", async () => {
  const before = calls.length;
  assert.equal(
    (await deliver(job, communication, { ...parent, phone: "bad" })).errorClass,
    "permanent",
  );
  assert.equal(
    (await deliver(job, communication, { ...parent, communication_consent: false })).errorClass,
    "permanent",
  );
  delete process.env.TWILIO_WHATSAPP_CONTENT_SID_EN;
  assert.equal(
    (await deliver({ channel: "whatsapp" }, communication, parent)).errorClass,
    "permanent",
  );
  assert.equal(calls.length, before);
});

test("WhatsApp selects configured language SID with no SMS fallback", async () => {
  response = () => new Response(JSON.stringify({ sid: "SMwhatsapp", status: "sent" }));
  for (const language of ["en", "hi", "te", "ta", "kn"]) {
    process.env[`TWILIO_WHATSAPP_CONTENT_SID_${language.toUpperCase()}`] = `HX${language}`;
    const result = await deliver({ channel: "whatsapp" }, communication, { ...parent, language });
    assert.equal(result.providerId, "SMwhatsapp");
    const form = new URLSearchParams(calls.at(-1).options.body);
    assert.equal(form.get("ContentSid"), `HX${language}`);
    assert.equal(form.get("To"), "whatsapp:+919876543210");
    assert.equal(form.has("Body"), false);
  }
  response = () => new Response("{}", { status: 400 });
  assert.equal(
    (await deliver({ channel: "whatsapp" }, communication, parent)).errorClass,
    "permanent",
  );
});

test("Twilio signatures bind URL and every sorted field", async () => {
  const url = process.env.TWILIO_WEBHOOK_PUBLIC_URL;
  const params = { MessageSid: "SMtest", MessageStatus: "delivered", institution_id: "untrusted" };
  const signature = createHmac("sha1", "test-only")
    .update(
      url +
        Object.keys(params)
          .sort()
          .map((k) => k + params[k])
          .join(""),
    )
    .digest("base64");
  assert.equal(await verifyTwilioSignature({ url, params, signature }), true);
  for (const invalid of [null, "invalid", signature.replace(/^./, "!")])
    assert.equal(await verifyTwilioSignature({ url, params, signature: invalid }), false);
  assert.equal(
    await verifyTwilioSignature({ url, params: { ...params, institution_id: "other" }, signature }),
    false,
  );
});

test("internal endpoint authorization requires POST and exact bearer token", () => {
  assert.equal(workerAuthorized("POST", "Bearer test", "test"), true);
  for (const header of [null, "", "Bearer wrong", "test"])
    assert.equal(workerAuthorized("POST", header, "test"), false);
  assert.equal(workerAuthorized("GET", "Bearer test", "test"), false);
  assert.equal(workerAuthorized("POST", "Bearer test", undefined), false);
});

function queuedJob(id, attempts = 1, maxAttempts = 3) {
  return {
    id,
    institution_id: "institution-test",
    communication_id: `communication-${id}`,
    channel: "sms",
    attempts,
    max_attempts: maxAttempts,
    lease_owner: `lease-${id}`,
  };
}

function mockStore(initialJobs = []) {
  const state = new Map(
    initialJobs.map((job) => [job.id, { job, status: "pending", result: null }]),
  );
  return {
    state,
    async claim(limit) {
      const claimed = [];
      for (const item of state.values()) {
        if (item.status !== "pending" || claimed.length >= limit) continue;
        item.status = "processing";
        claimed.push(item.job);
      }
      return claimed;
    },
    async load() {
      return {
        communication,
        parent,
        student: { name: "Student" },
      };
    },
    async finish(job, result) {
      const item = state.get(job.id);
      if (!item || item.status !== "processing") return false;
      item.result = result;
      item.status = result.ok
        ? "completed"
        : result.errorClass === "transient" && job.attempts < job.max_attempts
          ? "pending"
          : "dead_letter";
      return true;
    },
  };
}

test("worker endpoint rejects missing/invalid secrets without touching the queue", async () => {
  let runs = 0;
  const processJobs = async () => {
    runs++;
    return { claimed: 0, completed: 0, retried: 0, failed: 0 };
  };
  for (const authorization of [undefined, "Bearer wrong", "secret-without-bearer"]) {
    const headers = authorization ? { authorization } : undefined;
    const response = await handleCommunicationWorkerRequest(
      new Request("https://example.invalid/api/internal/communications/process", {
        method: "POST",
        headers,
      }),
      { expectedSecret: "scheduler-secret", processJobs },
    );
    assert.equal(response.status, 401);
  }
  assert.equal(runs, 0);
});

test("valid endpoint auth uses a clamped bounded batch and emits run fields", async () => {
  assert.equal(communicationWorkerBatchSize("not-a-number"), 20);
  assert.equal(communicationWorkerBatchSize("0"), 20);
  assert.equal(communicationWorkerBatchSize("500"), 50);
  let receivedLimit = 0;
  const response = await handleCommunicationWorkerRequest(
    new Request("https://example.invalid/api/internal/communications/process", {
      method: "POST",
      headers: { authorization: "Bearer scheduler-secret" },
    }),
    {
      expectedSecret: "scheduler-secret",
      batchSize: 7,
      runId: "run-test",
      processJobs: async (limit) => {
        receivedLimit = limit;
        return { claimed: 1, completed: 1, retried: 0, failed: 0 };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(receivedLimit, 7);
  const body = await response.json();
  assert.deepEqual(
    { ...body, durationMs: 0 },
    {
      runId: "run-test",
      claimed: 1,
      completed: 1,
      retried: 0,
      failed: 0,
      durationMs: 0,
    },
  );
  assert.ok(body.durationMs >= 0);
});

test("overlapping worker invocations claim different jobs and never reclaim completed jobs", async () => {
  const store = mockStore([queuedJob("one"), queuedJob("two")]);
  const deliverJob = async (job) => ({
    ok: true,
    provider: "mock",
    providerId: `mock-${job.id}`,
    status: "queued",
  });
  const [first, second] = await Promise.all([
    processCommunicationJobs(1, { store, deliverJob }),
    processCommunicationJobs(1, { store, deliverJob }),
  ]);
  assert.equal(first.claimed, 1);
  assert.equal(second.claimed, 1);
  assert.deepEqual(
    [...store.state.values()].map((item) => item.status),
    ["completed", "completed"],
  );
  assert.equal((await processCommunicationJobs(2, { store, deliverJob })).claimed, 0);
});

test("empty queues finish quickly without delivery or new records", async () => {
  const store = mockStore();
  let deliveries = 0;
  const started = Date.now();
  const result = await processCommunicationJobs(20, {
    store,
    deliverJob: async () => {
      deliveries++;
      throw new Error("must not run");
    },
  });
  assert.deepEqual(result, { claimed: 0, completed: 0, retried: 0, failed: 0 });
  assert.equal(deliveries, 0);
  assert.equal(store.state.size, 0);
  assert.ok(Date.now() - started < 1000);
});

test("one crashed job does not abort other jobs and remains leased for stale recovery", async () => {
  const store = mockStore([queuedJob("good-a"), queuedJob("crash"), queuedJob("good-b")]);
  const result = await processCommunicationJobs(3, {
    store,
    deliverJob: async (job) => {
      if (job.id === "crash") throw new Error("mock provider crash");
      return { ok: true, provider: "mock", providerId: `mock-${job.id}`, status: "sent" };
    },
  });
  assert.deepEqual(result, { claimed: 3, completed: 2, retried: 0, failed: 1 });
  assert.equal(store.state.get("crash").status, "processing");
  assert.equal(store.state.get("good-b").status, "completed");
});

test("transient and permanent provider results take bounded queue paths", async () => {
  const transientStore = mockStore([queuedJob("transient", 1, 3)]);
  const transient = await processCommunicationJobs(1, {
    store: transientStore,
    deliverJob: async () => ({ ok: false, errorClass: "transient", message: "mock timeout" }),
  });
  assert.equal(transient.retried, 1);
  assert.equal(transientStore.state.get("transient").status, "pending");

  const exhaustedStore = mockStore([queuedJob("exhausted", 3, 3)]);
  const exhausted = await processCommunicationJobs(1, {
    store: exhaustedStore,
    deliverJob: async () => ({ ok: false, errorClass: "transient", message: "mock timeout" }),
  });
  assert.equal(exhausted.failed, 1);
  assert.equal(exhaustedStore.state.get("exhausted").status, "dead_letter");

  const permanentStore = mockStore([queuedJob("permanent")]);
  const permanent = await processCommunicationJobs(1, {
    store: permanentStore,
    deliverJob: async () => ({ ok: false, errorClass: "permanent", message: "mock rejection" }),
  });
  assert.equal(permanent.failed, 1);
  assert.equal(permanentStore.state.get("permanent").status, "dead_letter");
});

test("database unavailability returns 503 and does not create an infinite retry loop", async () => {
  let attempts = 0;
  const response = await handleCommunicationWorkerRequest(
    new Request("https://example.invalid/api/internal/communications/process", {
      method: "POST",
      headers: { authorization: "Bearer scheduler-secret" },
    }),
    {
      expectedSecret: "scheduler-secret",
      processJobs: async () => {
        attempts++;
        throw new Error("mock database unavailable");
      },
    },
  );
  assert.equal(response.status, 503);
  assert.equal(attempts, 1);
});

test("local scheduled request processes an absence with a mock provider", async () => {
  const store = mockStore([queuedJob("absence")]);
  const processJobs = (limit) =>
    processCommunicationJobs(limit, {
      store,
      deliverJob: async () => ({
        ok: true,
        provider: "mock",
        providerId: "mock-absence",
        status: "queued",
      }),
    });
  const fetchInternal = (request) =>
    handleCommunicationWorkerRequest(request, {
      expectedSecret: "local-scheduler-secret",
      processJobs,
      runId: "local-schedule-run",
    });

  const invalid = await runCommunicationSchedule(fetchInternal, "invalid-secret");
  assert.equal(invalid.status, 401);
  assert.equal(store.state.get("absence").status, "pending");

  let scheduledRequest;
  const valid = await runCommunicationSchedule(async (request) => {
    scheduledRequest = request;
    return fetchInternal(request);
  }, "local-scheduler-secret");
  assert.equal(valid.status, 200);
  assert.equal(store.state.get("absence").status, "completed");
  assert.equal(store.state.get("absence").result.provider, "mock");
  assert.equal(scheduledRequest.method, "POST");
  assert.equal(new URL(scheduledRequest.url).search, "");
});

test("voice remains unavailable; malformed AI output produces deterministic review fallback", async () => {
  assert.equal(
    (await deliver({ channel: "voice" }, communication, parent)).errorClass,
    "permanent",
  );
  assert.equal(attendanceConversationSchema.safeParse({ confidence: 3 }).success, false);
  for (const content of [
    "not JSON",
    "{}",
    JSON.stringify({ ...unparsedAttendanceConversation(), expectedReturnDate: "bad" }),
  ]) {
    response = () => Response.json({ choices: [{ message: { content } }] });
    assert.deepEqual(
      await interpretAttendanceConversation("Parent transcript", "en"),
      unparsedAttendanceConversation(),
    );
  }
  response = () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(unparsedAttendanceConversation()) } }],
    });
  assert.deepEqual(
    await interpretAttendanceConversation("Parent transcript", "en"),
    unparsedAttendanceConversation(),
  );
});
