import assert from "node:assert/strict";
import { test } from "node:test";
import { readAllRows } from "../src/lib/db/pagination.ts";
import {
  acceptedMessage,
  attendancePercentage,
  recordsForDate,
  studentHistoryMetrics,
  messageDisplayStatus,
} from "../src/lib/services/record-metrics.ts";

test("empty and unmarked attendance does not become a perfect attendance rate", () => {
  assert.equal(attendancePercentage([]), null);
  assert.equal(attendancePercentage([{ status: "unmarked" }, { status: "excused" }]), null);
  assert.equal(
    attendancePercentage([{ status: "present" }, { status: "late" }, { status: "absent" }]),
    67,
  );
});

test("today's attendance excludes stale and unrelated session records", () => {
  const sessions = [
    { id: "old", date: "2026-10-02" },
    { id: "today", date: "2026-10-19" },
  ];
  const records = [
    { sessionId: "old", status: "absent" },
    { sessionId: "today", status: "present" },
    { sessionId: "other", status: "absent" },
  ];
  assert.deepEqual(recordsForDate(sessions, records, "2026-10-19"), [records[1]]);
  assert.equal(attendancePercentage(recordsForDate(sessions, records, "2026-10-20")), null);
});

test("message totals require a provider ID and an accepted or delivered status", () => {
  assert.equal(acceptedMessage({ type: "sms", messageStatus: "delivered" }), false);
  assert.equal(
    acceptedMessage({ type: "push", providerMessageId: "fcm-1", messageStatus: "queued" }),
    false,
  );
  assert.equal(
    acceptedMessage({ type: "voice", providerMessageId: "call-1", messageStatus: "sent" }),
    false,
  );
  assert.equal(
    acceptedMessage({ type: "push", providerMessageId: "fcm-1", messageStatus: "sent" }),
    true,
  );
  assert.equal(
    acceptedMessage({ type: "sms", providerMessageId: "sms-1", smsStatus: "delivered" }),
    true,
  );
  assert.equal(
    acceptedMessage({
      type: "push",
      providerMessageId: "fcm-1",
      messageStatus: "provider_accepted",
    }),
    true,
  );
  assert.equal(
    acceptedMessage({
      type: "sms",
      providerMessageId: "SMsimulated1",
      smsStatus: "delivered",
      providerName: "fast2sms-simulated",
    }),
    false,
  );
});

test("student metrics use dated records and do not invent a rate for an empty history", () => {
  assert.deepEqual(studentHistoryMetrics("s1", [], []), {
    attendanceRate: null,
    consecutiveAbsences: 0,
    risk: "unknown",
  });
  const sessions = [
    { id: "first", date: "2000-01-01" },
    { id: "last", date: "2000-01-02" },
  ];
  const records = [
    { studentId: "s1", sessionId: "last", status: "present" },
    { studentId: "s1", sessionId: "first", status: "absent" },
    { studentId: "other", sessionId: "last", status: "absent" },
  ];
  assert.deepEqual(studentHistoryMetrics("s1", sessions, records), {
    attendanceRate: 50,
    consecutiveAbsences: 0,
    risk: "high",
  });
});

test("repository lists collect subsequent pages beyond the API row limit", async () => {
  const requests = [];
  const source = Array.from({ length: 1101 }, (_, id) => ({ id }));
  const rows = await readAllRows(async (from, to) => {
    requests.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  }, "test rows");
  assert.deepEqual(rows, source);
  assert.deepEqual(requests, [
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
});

test("repository pagination surfaces an error instead of returning incomplete data", async () => {
  await assert.rejects(
    readAllRows(
      async (from) =>
        from === 0
          ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null }
          : {
              data: null,
              error: { code: "08006", message: "connection failed", details: "", hint: "" },
            },
      "test rows",
    ),
    /test rows/,
  );
});

test("message history requires provider evidence before showing successful delivery", () => {
  assert.equal(messageDisplayStatus({ type: "sms", messageStatus: "delivered" }), "unconfirmed");
  assert.equal(
    messageDisplayStatus({
      type: "push",
      messageStatus: "provider_accepted",
      providerMessageId: "fcm-1",
    }),
    "provider_accepted",
  );
  assert.equal(
    messageDisplayStatus({ type: "sms", messageStatus: "delivered", providerName: "twilio(mock)" }),
    "simulated",
  );
  assert.equal(messageDisplayStatus({ type: "sms" }), "unconfirmed");
});
