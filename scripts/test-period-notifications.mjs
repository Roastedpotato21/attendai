import assert from "node:assert/strict";
import { test } from "node:test";
import {
  renderPeriodNotification,
  processPeriodNotifications,
} from "../src/lib/server/period-notifications.ts";
import { processPushJobs } from "../src/lib/server/push-worker.ts";
import {
  sendGuardianNotification,
  ATTENDANCE_PUSH_TTL_SECONDS,
} from "../src/lib/server/fcm-provider.ts";
const facts = [
  {
    session_id: "isolated-session",
    subject: "Recorded Mathematics",
    period: "Period 2",
    status: "absent",
    revision: 1,
  },
];
const meta = {
  purpose: "period-attendance",
  kind: "first_absence",
  attendance_date: "2026-10-21",
  facts,
  expires_at: "2026-10-21T20:00:00Z",
};
test("first notification contains the student, subject, period, date and institution", () => {
  const p = renderPeriodNotification(meta, "Actual Student", "Actual Institution");
  assert.equal(p.title, "Attendance Alert");
  for (const text of [
    "Actual Student",
    "Recorded Mathematics",
    "Period 2",
    "2026-10-21",
    "Actual Institution",
  ])
    assert.ok(p.body.includes(text));
  assert.ok(!p.body.includes("delivered"));
});
test("unknown and supported languages safely fall back to reviewed English text", () => {
  for (const language of ["en", "hi", "te", "ta", "kn", "unknown", null])
    assert.equal(
      renderPeriodNotification({ ...meta, language }, "Student", "Institution").title,
      "Attendance Alert",
    );
});
test("correction is a separate notice with original and new status and period details", () => {
  const p = renderPeriodNotification(
    {
      ...meta,
      kind: "correction",
      facts: [{ ...facts[0], old_status: "absent", status: "approved_leave" }],
    },
    "Student",
    "Institution",
  );
  assert.equal(p.title, "Attendance Correction");
  assert.match(p.body, /Absent → Approved Leave/);
  assert.match(p.body, /ignore the previous/);
  assert.match(p.body, /Period 2/);
});
test("daily summary includes current absent subjects and logical periods", () => {
  const p = renderPeriodNotification(
    {
      ...meta,
      kind: "daily_summary",
      facts: [...facts, { subject: "Chemistry", period: "Lab 1 + Lab 2" }],
    },
    "Student",
    "Institution",
  );
  assert.equal(p.title, "Daily Attendance Summary");
  assert.match(p.body, /2 absent periods/);
  assert.match(p.body, /Lab 1 \+ Lab 2/);
});
test("long names and summaries stay within provider payload bounds", () => {
  for (const kind of ["first_absence", "correction", "daily_summary"]) {
    const p = renderPeriodNotification(
      {
        ...meta,
        kind,
        facts: Array(500).fill({
          subject: "S".repeat(300),
          period: "P".repeat(200),
          old_status: "absent",
          status: "present",
        }),
      },
      "N".repeat(500),
      "I".repeat(500),
    );
    assert.ok(p.body.length <= 350);
    assert.ok(!p.body.includes("\n"));
    if (kind === "correction")
      assert.ok(p.body.includes("Please ignore the previous attendance notice for this period."));
  }
});
test("missing processor configuration fails explicitly without network activity", async () => {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await assert.rejects(processPeriodNotifications(), /not configured/);
  } finally {
    if (url !== undefined) process.env.SUPABASE_URL = url;
    if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
});
test("expired notices fail before provider authentication and network requests", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("No provider allowed");
  };
  try {
    assert.equal(ATTENDANCE_PUSH_TTL_SECONDS, 28800);
    const outcome = await sendGuardianNotification({
      installationId: "isolated-device",
      title: "Attendance Alert",
      body: "Isolated notice",
      communicationId: "10000000-0000-4000-8000-000000000001",
      idempotencyKey: "isolated",
      expiresAt: "2000-01-01T00:00:00Z",
    });
    assert.deepEqual(outcome, { ok: false, kind: "permanent", code: "notification_expired" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
function workerFixture(decision) {
  const calls = [];
  const finished = [];
  const job = {
    id: "job",
    institution_id: "tenant",
    communication_id: "10000000-0000-4000-8000-000000000001",
    lease_owner: "lease",
    idempotency_key: "period-event",
  };
  const store = {
    claim: async () => [job],
    load: async () => ({
      communication: { metadata: meta },
      guardian: {},
      student: { name: "Student" },
      institutionName: "Institution",
      eligible: true,
      installations: [{ id: "device", firebase_installation_id: "isolated-fid" }],
    }),
    begin: async () => decision,
    finish: async (j, i, outcome) => {
      finished.push(outcome);
      return true;
    },
    complete: async () => (decision === "lease_lost" ? "lease_lost" : "provider_accepted"),
  };
  return {
    calls,
    finished,
    store,
    send: async (input) => {
      calls.push(input);
      return { ok: true, providerId: "projects/attendai-41f64/messages/isolated" };
    },
  };
}
test("worker renders the fresh snapshot returned with the dispatch fence", async () => {
  const x = workerFixture({
    status: "send",
    metadata: {
      ...meta,
      kind: "correction",
      facts: [{ ...facts[0], old_status: "absent", status: "present" }],
    },
  });
  await processPushJobs(1, x);
  assert.equal(x.calls.length, 1);
  assert.match(x.calls[0].body, /Absent → Present/);
  assert.equal(x.calls[0].expiresAt, meta.expires_at);
  assert.equal(x.finished[0].ok, true);
  assert.ok(!("delivered" in x.finished[0]));
});
for (const status of ["ineligible", "lease_lost", "already_accepted", "unconfirmed"])
  test(`worker makes no provider call after ${status} fence`, async () => {
    const x = workerFixture(status);
    await processPushJobs(1, x);
    assert.equal(x.calls.length, 0);
    assert.equal(x.finished.length, 0);
  });
