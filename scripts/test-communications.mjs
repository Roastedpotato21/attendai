import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { channel } from "node:diagnostics_channel";
import { test } from "node:test";
import {
  deliver as deliverWithFence,
  normalizePhone,
  normalizeSmsPhone,
  processCommunicationJobs,
} from "../src/lib/server/communication-worker.ts";
import {
  communicationWorkerBatchSize,
  handleCommunicationWorkerRequest,
  processNotificationChannels,
} from "../src/lib/server/communication-worker-endpoint.ts";
import { runCommunicationSchedule } from "../src/lib/server/communication-scheduler.ts";
import { verifyTwilioSignature } from "../src/lib/server/communication-webhooks.ts";
import { renderSmsTemplate } from "../src/lib/server/sms-template.ts";
import { processPushJobs, renderPushPayload } from "../src/lib/server/push-worker.ts";
import { isFreshAttendanceSession } from "../src/lib/server/attendance-freshness.ts";
import {
  classifyFcmError,
  sendGuardianNotification,
  sendOfflineDeliveryTest,
  sendControlledDeliveryTest,
  sendGuardianTransportTest,
  verifyFcmAdminAuthentication,
} from "../src/lib/server/fcm-provider.ts";
import { getTwilioProvider } from "../src/lib/services/twilio-provider.ts";
// Unit provider tests explicitly simulate an approved database dispatch fence.
const deliver = (job, communication, parent, template, institutionName) =>
  deliverWithFence(job, communication, parent, template, institutionName, async () => true);
import { workerAuthorized } from "../src/lib/server/worker-auth.ts";
import {
  attendanceConversationSchema,
  interpretAttendanceConversation,
  unparsedAttendanceConversation,
} from "../src/lib/server/voice-interpretation.ts";

// Never load .env. All provider traffic is replaced here, including AI traffic.
Object.assign(process.env, {
  FAST2SMS_API_KEY: "test-only-fast2sms",
  SMS_PROVIDER: "fast2sms",
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "test-only",
  TWILIO_PHONE_NUMBER: "+15005550006",
  TWILIO_WHATSAPP_FROM: "+15005550006",
  TWILIO_WEBHOOK_PUBLIC_URL: "https://example.invalid/api/webhooks/twilio/status",
  SMS_DELIVERY_MODE: "live",
  TWILIO_TRIAL_MODE: "false",
  SMS_LIVE_RECIPIENT_ALLOWLIST: "+919876543210",
  SMS_INDIA_DLT_READY: "true",
  OPENAI_API_KEY: "test-only",
});
const job = {
  id: "job-test",
  institution_id: "institution-test",
  channel: "sms",
};
const localized = {
  en: "English",
  hi: "?????",
  te: "??????",
  ta: "?????",
  kn: "?????",
};
const templateFor = (language) => ({
  id: "10000000-0000-4000-8000-000000000001",
  institution_id: job.institution_id,
  event_type: "absence-alert",
  channel: "sms",
  language,
  content: localized[language] + " {{student_name}} {{attendance_date}} {{institution_name}}",
  approved_variables: ["student_name", "attendance_date", "institution_name"],
  active: true,
});
const parent = {
  phone: "+91 98765 43210",
  name: "Parent",
  language: "en",
  active: true,
  communication_consent: true,
};
const communication = {
  id: "20000000-0000-4000-8000-000000000001",
  student_name: "Student",
  metadata: { purpose: "absence-alert", attendance_date: "2099-01-01" },
};
let calls = [];
let response = () => new Response(JSON.stringify({ return: true, request_id: "fast-test" }));
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  return response();
};

test("SMS uses E.164 and the active institution/language template", async () => {
  assert.equal(normalizePhone("98765 43210"), "+919876543210");
  assert.equal(normalizeSmsPhone(parent.phone), "+919876543210");
  assert.equal(normalizeSmsPhone("98765 43210"), null);
  assert.equal(normalizeSmsPhone("+91abc9876543210"), null);
  assert.equal(normalizeSmsPhone("bad"), null);
  for (const language of ["en", "hi", "te", "ta", "kn"]) {
    const result = await deliver(
      job,
      communication,
      { ...parent, language },
      templateFor(language),
      "Northstar",
    );
    assert.equal(result.ok, true);
    assert.equal(result.provider, "fast2sms");
    assert.equal(result.providerId, "fast-test");
    assert.equal(result.status, "queued");
    const form = JSON.parse(calls.at(-1).options.body);
    assert.equal(calls.at(-1).url, "https://www.fast2sms.com/dev/bulkV2");
    assert.equal(form.numbers, "9876543210");
    assert.equal(form.route, "q");
    assert.equal(form.udf1, communication.id);
    assert.ok(form.message.startsWith(localized[language]));
    assert.ok(form.message.includes("Student 2099-01-01 Northstar"));
    assert.equal(form.message, result.body);
  }
});

test("Twilio cannot be selected for new SMS", async () => {
  const before = calls.length;
  process.env.SMS_PROVIDER = "twilio";
  try {
    const result = await deliver(job, communication, parent, templateFor("en"), "Northstar");
    assert.equal(result.ok, false);
    assert.match(result.message, /Twilio is disabled/);
    assert.equal(calls.length, before);
  } finally {
    process.env.SMS_PROVIDER = "fast2sms";
  }
});

test("SMS defaults off, requires a live allowlist, and selects English only as fallback", async () => {
  const originalMode = process.env.SMS_DELIVERY_MODE;
  const originalAllowlist = process.env.SMS_LIVE_RECIPIENT_ALLOWLIST;
  const before = calls.length;
  try {
    delete process.env.SMS_DELIVERY_MODE;
    assert.equal(
      (await deliver(job, communication, parent, templateFor("en"), "Northstar")).message,
      "SMS delivery is disabled",
    );
    process.env.SMS_DELIVERY_MODE = "live";
    process.env.SMS_LIVE_RECIPIENT_ALLOWLIST = "";
    assert.equal(
      (await deliver(job, communication, parent, templateFor("en"), "Northstar")).message,
      "recipient is not authorized for live SMS",
    );
    assert.equal(calls.length, before);
    process.env.SMS_DELIVERY_MODE = "simulate";
    const fallback = await deliver(
      job,
      communication,
      { ...parent, language: "te" },
      templateFor("en"),
      "Northstar",
    );
    assert.equal(fallback.ok, true);
    assert.equal(fallback.provider, "fast2sms-simulated");
    assert.match(fallback.body, /^English /);
    assert.equal(calls.length, before);
    assert.equal(
      (
        await deliver(
          job,
          communication,
          parent,
          { ...templateFor("en"), institution_id: "other" },
          "Northstar",
        )
      ).errorClass,
      "permanent",
    );
  } finally {
    if (originalMode === undefined) delete process.env.SMS_DELIVERY_MODE;
    else process.env.SMS_DELIVERY_MODE = originalMode;
    if (originalAllowlist === undefined) delete process.env.SMS_LIVE_RECIPIENT_ALLOWLIST;
    else process.env.SMS_LIVE_RECIPIENT_ALLOWLIST = originalAllowlist;
  }
});

test("legacy SMS adapter cannot select paid delivery from credentials", async () => {
  const before = calls.length;
  await assert.rejects(
    getTwilioProvider().send({
      to: "+919876543210",
      body: "test only",
      studentName: "Student",
      parentName: "Parent",
    }),
    /Legacy SMS delivery is disabled/,
  );
  assert.equal(calls.length, before);
});

test("production cannot create simulated SMS delivery evidence", async () => {
  const originalMode = process.env.SMS_DELIVERY_MODE;
  const originalNodeEnv = process.env.NODE_ENV;
  const before = calls.length;
  try {
    process.env.SMS_DELIVERY_MODE = "simulate";
    process.env.NODE_ENV = "production";
    const result = await deliver(job, communication, parent, templateFor("en"), "Northstar");
    assert.equal(result.ok, false);
    assert.equal(result.message, "SMS simulation is disabled in production");
    assert.equal(calls.length, before);
  } finally {
    if (originalMode === undefined) delete process.env.SMS_DELIVERY_MODE;
    else process.env.SMS_DELIVERY_MODE = originalMode;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("SMS template rendering rejects unapproved or missing variables", () => {
  const values = {
    institution_name: "Northstar",
    guardian_name: "Parent",
    student_name: "Student",
    attendance_date: "2099-01-01",
  };
  assert.match(renderSmsTemplate(templateFor("en"), values), /Student 2099-01-01 Northstar/);
  assert.throws(() =>
    renderSmsTemplate(
      {
        ...templateFor("en"),
        content: "{{student_name}} {{attendance_date}} {{secret}}",
      },
      values,
    ),
  );
  assert.throws(() =>
    renderSmsTemplate(templateFor("en"), {
      ...values,
      student_name: "",
    }),
  );
});

test("Fast2SMS explicit rejections are terminal; uncertain outcomes are not retried", async () => {
  for (const status of [408, 429, 500, 503, 400, 401, 403, 422]) {
    response = () => Response.json({ return: false, message: "Rejected" }, { status });
    const result = await deliver(job, communication, parent, templateFor("en"), "Northstar");
    assert.equal(result.errorClass, status === 408 || status >= 500 ? "ambiguous" : "permanent");
  }
  for (const failure of [
    new TypeError("network failure"),
    new DOMException("timeout", "TimeoutError"),
  ]) {
    response = () => {
      throw failure;
    };
    assert.equal(
      (await deliver(job, communication, parent, templateFor("en"), "Northstar")).errorClass,
      "ambiguous",
    );
  }
});

test("provider failure records safe network cause and observed request body writes", async () => {
  process.env.TWILIO_WHATSAPP_CONTENT_SID_EN = "HXen";
  response = () => {
    const request = {
      origin: "https://api.twilio.com",
      method: "POST",
      path: new URL(calls.at(-1).url).pathname,
    };
    channel("undici:request:create").publish({ request });
    channel("undici:request:bodyChunkSent").publish({ request, chunk: "test" });
    channel("undici:request:bodySent").publish({ request });
    throw new TypeError("do not persist a secret or phone", {
      cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    });
  };
  const result = await deliver({ ...job, channel: "whatsapp" }, communication, parent);
  assert.equal(result.ok, false);
  assert.equal(result.errorClass, "ambiguous");
  assert.match(result.message, /endpoint=api\.twilio\.com/);
  assert.match(result.message, /timeoutMs=20000/);
  assert.match(result.message, /bodyBytesWrittenObserved=4/);
  assert.match(result.message, /bodyFullySent=true/);
  assert.match(result.message, /causeCode=ECONNRESET/);
  assert.doesNotMatch(result.message, /secret|phone|ACtest|9876543210/);

  response = () => {
    throw new DOMException("timeout with private details", "TimeoutError");
  };
  const timeout = await deliver({ ...job, channel: "whatsapp" }, communication, parent);
  assert.equal(timeout.errorClass, "ambiguous");
  assert.match(timeout.message, /bodyBytesWrittenObserved=unknown/);
  assert.match(timeout.message, /errorName=TimeoutError/);
  assert.doesNotMatch(timeout.message, /private details/);
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
        attendanceEligible: true,
        guardianEligible: true,
        template: templateFor("en"),
        institutionName: "Northstar",
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

test("corrected absence is never delivered after a worker has claimed it", async () => {
  for (const attendanceEligible of [false, undefined, true]) {
    const store = mockStore([queuedJob("corrected-absence")]);
    store.load = async () => ({
      communication: { ...communication, metadata: { purpose: "absence-alert" } },
      parent,
      student: { name: "Student" },
      attendanceEligible,
      guardianEligible: true,
    });
    let deliveries = 0;
    await processCommunicationJobs(1, {
      store,
      deliverJob: async () => {
        deliveries++;
        return { ok: true, provider: "mock", providerId: "mock-attendance", status: "queued" };
      },
    });
    assert.equal(deliveries, attendanceEligible === true ? 1 : 0);
    assert.equal(
      store.state.get("corrected-absence").status,
      attendanceEligible === true ? "completed" : "dead_letter",
    );
  }
});

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

test("push worker sends once per eligible installation and records both results", async () => {
  const job = {
    id: "push-job",
    communication_id: "10000000-0000-4000-8000-000000000001",
    institution_id: "tenant",
    lease_owner: "owner",
    idempotency_key: "event",
  };
  const installations = [
    { id: "device-a", firebase_installation_id: "fid-a" },
    { id: "device-b", firebase_installation_id: "fid-b" },
  ];
  const calls = [];
  const finishes = [];
  const result = await processPushJobs(1, {
    store: {
      claim: async () => [job],
      load: async () => ({
        communication: { metadata: { attendance_date: "2026-10-08" } },
        guardian: { name: "Guardian" },
        student: { name: "Student" },
        eligible: true,
        installations,
        template: undefined,
        institutionName: "School",
      }),
      begin: async () => "send",
      finish: async (_job, installation, outcome) => {
        finishes.push([installation.id, outcome]);
        return true;
      },
      complete: async () => "completed",
    },
    send: async (payload) => {
      calls.push(payload);
      return { ok: true, providerId: `mock-${payload.installationId}` };
    },
  });
  assert.deepEqual(result, { claimed: 1, completed: 1, retried: 0, failed: 0 });
  assert.deepEqual(
    calls.map((call) => call.installationId),
    ["fid-a", "fid-b"],
  );
  assert.deepEqual(
    calls.map((call) => call.idempotencyKey),
    ["event:device-a", "event:device-b"],
  );
  assert.equal(finishes.length, 2);
});

test("attendance push uses canonical student, date and institution data", () => {
  const payload = renderPushPayload({
    communication: { metadata: { attendance_date: "2026-10-16" } },
    guardian: {},
    student: { name: "Student One" },
    institutionName: "ABC School",
  });
  assert.equal(payload.title, "Attendance Alert");
  assert.equal(
    payload.body,
    "Dear Parent, Student One was marked absent on October 16, 2026. Please contact ABC School if you believe this is incorrect.",
  );
  assert.doesNotMatch(payload.body, /10000000-0000/);
});

test("old queued absences fail the attendance freshness rule", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const session = {
    date: "2026-10-16",
    created_at: "2026-10-16T10:00:00Z",
    status: "submitted",
    institution_id: "tenant",
  };
  assert.equal(isFreshAttendanceSession(session, now), true);
  assert.equal(
    isFreshAttendanceSession(
      { ...session, created_at: "2026-10-05T10:00:00Z", date: "2026-10-05" },
      now,
    ),
    false,
  );
  assert.equal(isFreshAttendanceSession({ ...session, status: "draft" }, now), false);
});

test("push worker suppresses ineligible jobs before any provider call", async () => {
  let sends = 0;
  let suppressed = false;
  const result = await processPushJobs(1, {
    store: {
      claim: async () => [
        {
          id: "job",
          communication_id: "communication",
          institution_id: "tenant",
          lease_owner: "owner",
          idempotency_key: "event",
        },
      ],
      load: async () => ({ eligible: false }),
      begin: async () => {
        throw new Error("dispatch must not start");
      },
      finish: async () => false,
      complete: async (_job, value) => {
        suppressed = value;
        return "suppressed";
      },
    },
    send: async () => {
      sends++;
      return { ok: true, providerId: "unexpected" };
    },
  });
  assert.equal(sends, 0);
  assert.equal(suppressed, true);
  assert.equal(result.completed, 1);
});

test("FCM errors distinguish stale installations from unknown outcomes", () => {
  assert.equal(
    classifyFcmError({ code: "messaging/registration-token-not-registered" }).kind,
    "invalid_device",
  );
  assert.equal(classifyFcmError({ code: "messaging/server-unavailable" }).kind, "retryable");
  assert.equal(classifyFcmError(new Error("network outcome unknown")).kind, "unconfirmed");
});

test("FCM Admin rejects old project settings and credentials before sending", async () => {
  const previousProject = process.env.FIREBASE_PROJECT_ID;
  const previousCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    process.env.FIREBASE_PROJECT_ID = "siri-1b57c";
    await assert.rejects(verifyFcmAdminAuthentication(), /project is not verified/);
    process.env.FIREBASE_PROJECT_ID = "attendai-41f64";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "siri-1b57c" });
    await assert.rejects(verifyFcmAdminAuthentication(), /authentication is invalid/);
  } finally {
    if (previousProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = previousProject;
    if (previousCredential === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousCredential;
  }
});

test("FCM validation-only request targets the enrolled FID with the exact alert", async () => {
  const keys = ["FIREBASE_PROJECT_ID", "FIREBASE_SERVICE_ACCOUNT_JSON", "ATTENDAI_APP_URL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pem = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey))
    .toString("base64")
    .match(/.{1,64}/g)
    .join("\n");
  process.env.FIREBASE_PROJECT_ID = "attendai-41f64";
  process.env.ATTENDAI_APP_URL = "https://attendai.example.invalid";
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: "attendai-41f64",
    client_email: "trial@attendai-41f64.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----\n`,
  });
  let submitted;
  globalThis.fetch = async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(options.method, "POST");
      return Response.json({ access_token: "test-access-token", expires_in: 3600 });
    }
    assert.equal(url, "https://fcm.googleapis.com/v1/projects/attendai-41f64/messages:send");
    submitted = JSON.parse(options.body);
    return Response.json({ name: "projects/attendai-41f64/messages/validated" });
  };
  try {
    const outcome = await sendGuardianNotification(
      {
        installationId: "fid-guardian-trial-0001",
        title: "Attendance Alert",
        body: "Dear Parent, Student One was marked absent on 2026-10-05.",
        communicationId: "10000000-0000-4000-8000-000000000001",
        idempotencyKey: "trial-communication:installation",
      },
      true,
    );
    assert.equal(outcome.ok, true);
    assert.equal(submitted.validate_only, true);
    assert.equal(submitted.message.fid, "fid-guardian-trial-0001");
    assert.equal(submitted.message.notification.title, "Attendance Alert");
    assert.equal(
      submitted.message.notification.body,
      "Dear Parent, Student One was marked absent on 2026-10-05.",
    );
    assert.equal(
      submitted.message.webpush.fcm_options.link,
      "https://attendai.example.invalid/guardian-notifications?event=10000000-0000-4000-8000-000000000001",
    );
    assert.equal(submitted.message.webpush.headers.TTL, "21600");
    assert.equal(
      submitted.message.webpush.notification.tag,
      "10000000-0000-4000-8000-000000000001",
    );
    const offline = await sendOfflineDeliveryTest({
      installationId: "fid-guardian-trial-0001",
      testId: "10000000-0000-4000-8000-000000000002",
    });
    assert.equal(offline.ok, true);
    assert.equal(submitted.message.notification.title, "AttendAI Offline Delivery Test");
    assert.equal(
      submitted.message.notification.body,
      "This test checks delayed notification delivery after internet reconnects.",
    );
    assert.equal(submitted.message.webpush.headers.TTL, "300");
    assert.equal(submitted.message.data.testId, "10000000-0000-4000-8000-000000000002");
    const online = await sendControlledDeliveryTest({
      installationId: "fid-guardian-trial-0001",
      testId: "10000000-0000-4000-8000-000000000003",
      mode: "online",
    });
    assert.equal(online.ok, true);
    assert.equal(submitted.message.notification.title, "AttendAI Online Push Test");
    assert.equal(submitted.message.data.testMode, "online");
    assert.match(submitted.message.notification.body, /No attendance action/);
    const guardianTest = await sendGuardianTransportTest(
      {
        installationId: "fid-guardian-trial-0001",
        testId: "10000000-0000-4000-8000-000000000004",
        studentName: "Student One",
      },
      true,
    );
    assert.equal(guardianTest.ok, true);
    assert.equal(submitted.validate_only, true);
    assert.equal(submitted.message.notification.title, "AttendAI Notification Test");
    assert.equal(
      submitted.message.notification.body,
      "Notifications are enabled for Student One. No attendance action is required.",
    );
    for (const [errorCode, expectedKind] of [
      ["INVALID_ARGUMENT", "permanent"],
      ["UNREGISTERED", "invalid_device"],
    ]) {
      globalThis.fetch = async () =>
        Response.json(
          { error: { status: "INVALID_ARGUMENT", details: [{ errorCode }] } },
          { status: 400 },
        );
      const rejected = await sendControlledDeliveryTest({
        installationId: "fid-guardian-trial-0001",
        testId: "10000000-0000-4000-8000-000000000003",
        mode: "online",
      });
      assert.equal(rejected.kind, expectedKind);
      assert.equal(rejected.safeReason, "FCM HTTP 400: INVALID_ARGUMENT");
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("SMS and push failures are isolated and SMS starts first", async () => {
  for (const failedChannel of ["sms", "push"]) {
    const started = [];
    const channelRun = (name) => async () => {
      started.push(name);
      if (name === failedChannel) throw new Error("provider unavailable");
      return { claimed: 1, completed: 1, retried: 0, failed: 0 };
    };
    const result = await processNotificationChannels(1, channelRun("sms"), channelRun("push"));
    assert.deepEqual(started, ["sms", "push"]);
    assert.equal(result.completed, 1);
    assert.equal(result.failed, 1);
  }
});

test("live SMS cannot bypass the database dispatch fence", async () => {
  const before = calls.length;
  const result = await deliverWithFence(job, communication, parent, templateFor("en"), "Northstar");
  assert.equal(result.ok, false);
  assert.match(result.message, /database fence/);
  assert.equal(calls.length, before);
});
