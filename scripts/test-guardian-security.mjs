import assert from "node:assert/strict";
import { test } from "node:test";
import { handleGuardianNotificationDevice } from "../src/lib/server/guardian-notifications.ts";

const origin = "https://attendai.example.invalid";
const eventId = "10000000-0000-4000-8000-000000000001";
const studentId = "10000000-0000-4000-8000-000000000002";
process.env.SUPABASE_URL = "https://database.example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
process.env.ATTENDAI_APP_URL = origin;

function request(
  path = "event-status",
  body = JSON.stringify({ communicationId: eventId }),
  headers = {},
) {
  return new Request(`${origin}/api/guardian/notifications/${path}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: `attendai_guardian_device=${"a".repeat(43)}`,
      ...headers,
    },
    body,
  });
}

async function withDatabase(overrides, run) {
  const originalFetch = globalThis.fetch;
  const reads = [];
  const rows = {
    guardian_notification_installations: {
      id: "device",
      institution_id: "tenant",
      guardian_id: "guardian",
      active: true,
      permission_state: "granted",
      firebase_project_id: "attendai-41f64",
      revoked_at: null,
    },
    guardian_notification_consents: { id: "consent" },
    communication_dispatches: { id: "dispatch", status: "provider_accepted" },
    communications: { student_id: studentId, metadata: { attendance_session_id: eventId } },
    parents: { active: true, communication_consent: true },
    student_parents: { receives_notifications: true },
    institutions: { status: "active" },
    students: { enrollment_status: "active" },
    attendance_records: { status: "absent" },
    ...overrides,
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://database.example.invalid");
    const table = url.pathname.split("/").at(-1);
    reads.push(table);
    assert.ok(Object.hasOwn(rows, table), `Unexpected database request: ${table}`);
    if (table === "student_parents") {
      assert.equal(url.searchParams.get("institution_id"), "eq.tenant");
      assert.equal(url.searchParams.get("parent_id"), "eq.guardian");
      if (url.searchParams.has("student_id"))
        assert.equal(url.searchParams.get("student_id"), `eq.${studentId}`);
    }
    return Response.json(rows[table] ? [rows[table]] : []);
  };
  try {
    await run(reads);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("guardian API rejects cross-origin requests before accessing data", async () => {
  await withDatabase({}, async (reads) => {
    const response = await handleGuardianNotificationDevice(
      request("status", "{}", { origin: "https://attacker.invalid" }),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(reads, []);
  });
});

test("public JSON endpoint bounds actual bytes even without an honest content length", async () => {
  for (const headers of [{}, { "content-length": "2" }]) {
    await withDatabase({}, async (reads) => {
      const response = await handleGuardianNotificationDevice(
        request("validate", JSON.stringify({ invitation: "a".repeat(5000) }), headers),
      );
      assert.equal(response.status, 413);
      assert.deepEqual(reads, []);
    });
  }
});

test("guardian API rejects malformed JSON before accessing data", async () => {
  await withDatabase({}, async (reads) => {
    assert.equal((await handleGuardianNotificationDevice(request("validate", "{"))).status, 400);
    assert.deepEqual(reads, []);
  });
});

test("valid one-time invitation reveals only its institution and linked students", async () => {
  await withDatabase(
    {
      guardian_notification_invitations: { institution_id: "tenant", guardian_id: "guardian" },
      institutions: { name: "ABC School", status: "active" },
      student_parents: {
        student_id: studentId,
        receives_notifications: true,
        students: { name: "Student One", institution_id: "tenant", enrollment_status: "active" },
      },
    },
    async (reads) => {
      const response = await handleGuardianNotificationDevice(
        request("validate", JSON.stringify({ invitation: "a".repeat(43) })),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        valid: true,
        institution: "ABC School",
        students: ["Student One"],
        consentVersion: "2026-10-16.1",
      });
      assert.ok(!reads.includes("guardian_notification_installations"));
    },
  );
});

test("device enrollment refuses missing affirmative consent before database consumption", async () => {
  await withDatabase({}, async (reads) => {
    const response = await handleGuardianNotificationDevice(
      request(
        "enroll",
        JSON.stringify({ invitation: "a".repeat(43), installationId: "f".repeat(43) }),
      ),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(reads, []);
  });
});

test("revocation timestamp invalidates a device cookie even if active is inconsistent", async () => {
  await withDatabase(
    {
      guardian_notification_installations: {
        id: "device",
        active: true,
        revoked_at: "2026-10-15T00:00:00Z",
      },
    },
    async (reads) => {
      assert.equal((await handleGuardianNotificationDevice(request())).status, 401);
      assert.deepEqual(reads, ["guardian_notification_installations"]);
    },
  );
});

test("a legacy device without explicit guardian consent cannot read attendance", async () => {
  await withDatabase({ guardian_notification_consents: null }, async (reads) => {
    assert.equal((await handleGuardianNotificationDevice(request())).status, 403);
    assert.ok(reads.includes("guardian_notification_consents"));
    assert.ok(!reads.includes("communication_dispatches"));
  });
});

test("old dispatch grants no attendance access after relationship or consent changes", async () => {
  for (const override of [
    { student_parents: null },
    { student_parents: { receives_notifications: false } },
    { parents: { active: true, communication_consent: false } },
    { parents: { active: false, communication_consent: true } },
    { institutions: { status: "suspended" } },
    { students: { enrollment_status: "inactive" } },
  ]) {
    await withDatabase(override, async (reads) => {
      assert.equal((await handleGuardianNotificationDevice(request())).status, 404);
      assert.ok(!reads.includes("attendance_records"));
    });
  }
});

test("current guardian relationship permits only the scoped attendance status", async () => {
  await withDatabase({}, async () => {
    const response = await handleGuardianNotificationDevice(request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { currentStatus: "absent" });
  });
});
