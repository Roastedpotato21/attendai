const assert = require("node:assert/strict");
const twilio = require("twilio");

const institutionId = "11111111-1111-4111-8111-111111111111";
const otherInstitutionId = "22222222-2222-4222-8222-222222222222";
const classId = "20000000-0000-4000-8000-000000000001";
const studentId = "10000000-0000-4000-8000-000000000001";
const parentId = "30000000-0000-4000-8000-000000000001";
const facultyId = "00000000-0000-4000-8000-000000000097";
const adminId = "00000000-0000-4000-8000-000000000098";

async function submitAbsence(client, date) {
  await client.query("SET ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [facultyId]);
  try {
    const { rows } = await client.query(
      "SELECT public.submit_attendance($1::uuid, $2::date, 'faculty', $3::jsonb) AS result",
      [
        classId,
        date,
        JSON.stringify([
          { student_id: studentId, status: "absent" },
          { student_id: "10000000-0000-4000-8000-000000000002", status: "present" },
        ]),
      ],
    );
    return rows[0].result.session_id;
  } finally {
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}

// Exercise the historical SMS worker with an explicit pre-migration outbox row.
// New attendance now enqueues push, so it must never implicitly send SMS.
async function createLegacySmsJob(client, sessionId, date) {
  await client.query(
    `WITH communication AS (
      INSERT INTO public.communications
        (institution_id, student_id, parent_id, type, message_status, metadata)
      VALUES ($1, $2, $3, 'sms', 'queued',
        jsonb_build_object('purpose', 'absence-alert',
          'attendance_session_id', $4::text, 'attendance_date', $5::text))
      RETURNING id
    ) INSERT INTO public.communication_jobs
      (institution_id, communication_id, channel, idempotency_key)
      SELECT $1, id, 'sms', 'legacy-sms:' || $4::text FROM communication`,
    [institutionId, studentId, parentId, sessionId, date],
  );
}

function smsStore(client) {
  return {
    async claim(limit) {
      const { rows } = await client.query("SELECT * FROM public.claim_communication_jobs($1)", [
        limit,
      ]);
      return rows;
    },
    async load(job) {
      const { rows } = await client.query(
        `
        SELECT c.*, s.name AS student_name, s.enrollment_status,
          p.name AS parent_name, p.phone, p.language, p.preferred_channel,
          p.communication_consent, p.active AS parent_active,
          sp.receives_notifications, i.name AS institution_name,
          a.status AS attendance_status
        FROM public.communications c
        JOIN public.students s ON s.id = c.student_id AND s.institution_id = c.institution_id
        JOIN public.parents p ON p.id = c.parent_id AND p.institution_id = c.institution_id
        LEFT JOIN public.student_parents sp ON sp.student_id = c.student_id
          AND sp.parent_id = c.parent_id AND sp.institution_id = c.institution_id
        JOIN public.institutions i ON i.id = c.institution_id
        LEFT JOIN public.attendance_records a ON a.student_id = c.student_id
          AND a.institution_id = c.institution_id
          AND a.session_id = (c.metadata->>'attendance_session_id')::uuid
        WHERE c.id = $1 AND c.institution_id = $2 AND c.type::text = $3
      `,
        [job.communication_id, job.institution_id, job.channel],
      );
      const row = rows[0];
      if (!row || row.enrollment_status !== "active") return null;
      const { rows: templates } = await client.query(
        `
        SELECT * FROM public.sms_templates WHERE institution_id = $1
          AND event_type = 'absence-alert' AND channel = 'sms'
          AND language IN ($2, 'en') AND active
      `,
        [job.institution_id, row.language],
      );
      const template =
        templates.find((item) => item.language === row.language) ??
        templates.find((item) => item.language === "en");
      return {
        communication: row,
        parent: {
          name: row.parent_name,
          phone: row.phone,
          language: row.language,
          communication_consent: row.communication_consent,
          active: row.parent_active,
        },
        student: { name: row.student_name },
        institutionName: row.institution_name,
        guardianEligible:
          row.receives_notifications === true && row.preferred_channel === job.channel,
        attendanceEligible: row.attendance_status === "absent",
        template,
      };
    },
    async finish(job, result) {
      const { rows } = await client.query(
        "SELECT public.finish_communication_job($1, $2, $3::jsonb) AS finished",
        [job.id, job.lease_owner, JSON.stringify(result)],
      );
      return rows[0].finished;
    },
  };
}

module.exports = async function verifySmsFlow(client) {
  const { deliver, processCommunicationJobs } =
    await import("../src/lib/server/communication-worker.ts");
  const { verifyTwilioSignature } = await import("../src/lib/server/communication-webhooks.ts");
  const previousMode = process.env.SMS_DELIVERY_MODE;
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.SMS_DELIVERY_MODE = "simulate";
  process.env.TWILIO_AUTH_TOKEN = "disposable-test-token";
  globalThis.fetch = () => {
    throw new Error("SMS test attempted a network request");
  };
  try {
    await client.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
      ($1, 'sms-faculty@test.invalid', '{"name":"SMS Faculty"}'::jsonb),
      ($2, 'sms-admin@test.invalid', '{"name":"SMS Admin"}'::jsonb)`,
      [facultyId, adminId],
    );
    await client.query(
      `INSERT INTO public.profile_institutions (profile_id, institution_id, status)
      VALUES ($1, $3, 'active'), ($2, $3, 'active')`,
      [facultyId, adminId, institutionId],
    );
    await client.query(
      `INSERT INTO public.profile_roles (profile_id, institution_id, role_code)
      VALUES ($1, $3, 'faculty'), ($2, $3, 'admin')`,
      [facultyId, adminId, institutionId],
    );
    await client.query(
      `INSERT INTO public.faculty
      (id, institution_id, user_id, department, role, employee_code, active)
      VALUES ('42000000-0000-4000-8000-000000000001', $1, $2,
        'Computer Science', 'professor', 'SMS-TEST-001', true)`,
      [institutionId, facultyId],
    );
    await client.query(
      `INSERT INTO public.class_faculty (faculty_id, class_id)
      VALUES ('42000000-0000-4000-8000-000000000001', $1)`,
      [classId],
    );
    await client.query(
      `INSERT INTO public.sms_templates
      (institution_id, event_type, channel, language, content, approved_variables, active)
      VALUES
      ($1, 'absence-alert', 'sms', 'en', 'EN {{student_name}} {{attendance_date}} {{institution_name}}', ARRAY['student_name','attendance_date','institution_name'], true),
      ($1, 'absence-alert', 'sms', 'te', 'TE {{student_name}} {{attendance_date}} {{institution_name}}', ARRAY['student_name','attendance_date','institution_name'], true),
      ($2, 'absence-alert', 'sms', 'hi', 'HI {{student_name}} {{attendance_date}}', ARRAY['student_name','attendance_date'], true)`,
      [institutionId, otherInstitutionId],
    );

    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [adminId]);
    const visible = await client.query("SELECT institution_id FROM public.sms_templates");
    assert.equal(visible.rows.length, 2);
    assert.ok(visible.rows.every((row) => row.institution_id === institutionId));
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('request.jwt.claim.sub', '', false)");
    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [facultyId]);
    await assert.rejects(
      client.query(
        `INSERT INTO public.sms_templates
        (institution_id, event_type, channel, language, content, approved_variables, active)
        VALUES ($1, 'absence-alert', 'sms', 'hi',
          '{{student_name}} {{attendance_date}}', ARRAY['student_name','attendance_date'], true)`,
        [institutionId],
      ),
      (error) => error.code === "42501",
    );
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('request.jwt.claim.sub', '', false)");

    await client.query(
      `INSERT INTO public.communication_rate_limits
      (institution_id, max_per_parent_per_window) VALUES ($1, 100)
      ON CONFLICT (institution_id) DO UPDATE SET max_per_parent_per_window = 100`,
      [institutionId],
    );
    const sessionId = await submitAbsence(client, "2026-09-20");
    await createLegacySmsJob(client, sessionId, "2026-09-20");
    const outbox = await client.query(
      `SELECT j.id, c.id AS communication_id
      FROM public.communication_jobs j JOIN public.communications c ON c.id = j.communication_id
      WHERE c.metadata->>'attendance_session_id' = $1 AND j.channel = 'sms'`,
      [sessionId],
    );
    assert.equal(outbox.rows.length, 1, "faculty attendance must create one SMS job");
    let providerCalls = 0;
    const store = smsStore(client);
    const deliverJob = async (...args) => {
      providerCalls++;
      const result = await deliver(...args);
      // Preserve the pre-migration Twilio callback regression with a historical fixture.
      return result.ok ? { ...result, provider: "twilio-simulated" } : result;
    };
    const run = await processCommunicationJobs(1, { store, deliverJob });
    assert.equal(run.completed, 1);
    assert.equal(providerCalls, 1, "worker must invoke the simulated provider");
    const sent = await client.query(
      `SELECT c.*, j.status AS job_status FROM public.communications c
      JOIN public.communication_jobs j ON j.communication_id = c.id WHERE c.id = $1`,
      [outbox.rows[0].communication_id],
    );
    assert.equal(sent.rows[0].provider_name, "twilio-simulated");
    assert.equal(sent.rows[0].job_status, "completed");
    assert.match(sent.rows[0].body, /^TE Aarav Reddy 2026-09-20 /);
    assert.equal(sent.rows[0].template_id === null, false);

    const callbackUrl = `https://example.invalid/api/webhooks/twilio/status?communication_id=${outbox.rows[0].communication_id}`;
    const params = { MessageSid: sent.rows[0].provider_message_id, MessageStatus: "delivered" };
    const signature = twilio.getExpectedTwilioSignature(
      process.env.TWILIO_AUTH_TOKEN,
      callbackUrl,
      params,
    );
    assert.equal(await verifyTwilioSignature({ url: callbackUrl, params, signature }), true);
    assert.equal(
      await verifyTwilioSignature({ url: callbackUrl, params, signature: "invalid" }),
      false,
    );
    const callback = await client.query(
      "SELECT public.apply_communication_callback($1, 'delivered', $2) AS result",
      [params.MessageSid, outbox.rows[0].communication_id],
    );
    assert.equal(callback.rows[0].result.duplicate, false);
    const duplicate = await client.query(
      "SELECT public.apply_communication_callback($1, 'delivered', $2) AS result",
      [params.MessageSid, outbox.rows[0].communication_id],
    );
    assert.equal(duplicate.rows[0].result.duplicate, true);
    const otherCommunication = await client.query(
      "SELECT id FROM public.communications WHERE institution_id = $1 LIMIT 1",
      [otherInstitutionId],
    );
    assert.equal(otherCommunication.rows.length, 1);
    await assert.rejects(
      client.query("SELECT public.apply_communication_callback($1, 'delivered', $2)", [
        params.MessageSid,
        otherCommunication.rows[0].id,
      ]),
      /callback communication mismatch/,
    );
    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [adminId]);
    const dashboard = await client.query(
      "SELECT message_status FROM public.communications WHERE id = $1",
      [outbox.rows[0].communication_id],
    );
    assert.equal(dashboard.rows[0].message_status, "delivered");
    const otherTenantRows = await client.query(
      "SELECT id FROM public.communications WHERE institution_id = $1",
      [otherInstitutionId],
    );
    assert.equal(otherTenantRows.rows.length, 0);
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('request.jwt.claim.sub', '', false)");

    await client.query("UPDATE public.parents SET language = 'hi' WHERE id = $1", [parentId]);
    const fallbackSession = await submitAbsence(client, "2026-09-21");
    await createLegacySmsJob(client, fallbackSession, "2026-09-21");
    const fallbackRun = await processCommunicationJobs(1, { store, deliverJob });
    assert.equal(fallbackRun.completed, 1);
    assert.equal(providerCalls, 2);
    const fallbackBody = await client.query(
      `SELECT body FROM public.communications
      WHERE metadata->>'attendance_session_id' = $1 AND type = 'sms'`,
      [fallbackSession],
    );
    assert.match(fallbackBody.rows[0].body, /^EN Aarav Reddy 2026-09-21 /);
    await client.query("UPDATE public.parents SET language = 'te' WHERE id = $1", [parentId]);

    const revokedSession = await submitAbsence(client, "2026-09-22");
    await createLegacySmsJob(client, revokedSession, "2026-09-22");
    const revoked = await client.query(
      `SELECT j.id FROM public.communication_jobs j
      JOIN public.communications c ON c.id = j.communication_id
      WHERE c.metadata->>'attendance_session_id' = $1 AND j.channel = 'sms'`,
      [revokedSession],
    );
    assert.equal(revoked.rows.length, 1);
    await client.query("UPDATE public.parents SET communication_consent = false WHERE id = $1", [
      parentId,
    ]);
    const revokedRun = await processCommunicationJobs(1, { store, deliverJob });
    assert.equal(revokedRun.failed, 1);
    assert.equal(providerCalls, 2, "revoked consent must block the provider");
    await client.query("UPDATE public.parents SET communication_consent = true WHERE id = $1", [
      parentId,
    ]);

    const ineligibleSession = await submitAbsence(client, "2026-09-23");
    await createLegacySmsJob(client, ineligibleSession, "2026-09-23");
    await client.query(
      `UPDATE public.student_parents SET receives_notifications = false
      WHERE student_id = $1 AND parent_id = $2`,
      [studentId, parentId],
    );
    const ineligibleRun = await processCommunicationJobs(1, { store, deliverJob });
    assert.equal(ineligibleRun.failed, 1);
    assert.equal(providerCalls, 2, "revoked notification eligibility must block the provider");
    const ineligibleJob = await client.query(
      `SELECT j.status FROM public.communication_jobs j
      JOIN public.communications c ON c.id = j.communication_id
      WHERE c.metadata->>'attendance_session_id' = $1 AND j.channel = 'sms'`,
      [ineligibleSession],
    );
    assert.equal(ineligibleJob.rows[0].status, "dead_letter");
    await client.query(
      `UPDATE public.student_parents SET receives_notifications = true
      WHERE student_id = $1 AND parent_id = $2`,
      [studentId, parentId],
    );

    const count = await client.query(
      `SELECT count(*)::int AS total FROM public.communications
      WHERE institution_id = $1 AND parent_id = $2 AND type = 'push'
        AND created_at >= timezone('utc', now()) - interval '1 hour'`,
      [institutionId, parentId],
    );
    assert.ok(count.rows[0].total > 0, "prior push outbox rows are required for rate-limit test");
    await client.query(
      "UPDATE public.communication_rate_limits SET max_per_parent_per_window = $2 WHERE institution_id = $1",
      [institutionId, 1],
    );
    const limitedSession = await submitAbsence(client, "2026-09-24");
    const limited = await client.query(
      `SELECT count(*)::int AS total FROM public.communication_jobs j
      JOIN public.communications c ON c.id = j.communication_id
      WHERE c.metadata->>'attendance_session_id' = $1 AND j.channel = 'push'`,
      [limitedSession],
    );
    assert.equal(limited.rows[0].total, 0, "rate limit must block another outbox job");

    // The stronger dispatch fence requires a real, recent, still-absent event.
    // This entire suite runs against disposable PostgreSQL, never live data.
    await client.query("UPDATE public.attendance_sessions SET date=CURRENT_DATE-7 WHERE id=$1", [
      sessionId,
    ]);
    const uncertain = await client.query(
      `WITH c AS (
      INSERT INTO public.communications (institution_id, student_id, parent_id, type, message_status, metadata)
      VALUES ($1, $2, $3, 'sms', 'queued', jsonb_build_object('purpose','absence-alert',
        'attendance_session_id',$4::text)) RETURNING id
    ) INSERT INTO public.communication_jobs (institution_id, communication_id, channel, idempotency_key)
      SELECT $1, c.id, 'sms', 'sms-uncertain-test' FROM c RETURNING id`,
      [institutionId, studentId, parentId, sessionId],
    );
    const claimed = await client.query(
      "SELECT id, lease_owner FROM public.claim_communication_jobs(1)",
    );
    assert.equal(claimed.rows[0].id, uncertain.rows[0].id);
    const started = await client.query(
      "SELECT public.mark_sms_dispatch_started($1, $2) AS started",
      [claimed.rows[0].id, claimed.rows[0].lease_owner],
    );
    assert.equal(started.rows[0].started, true);
    await client.query("SELECT public.finish_communication_job($1, $2, $3::jsonb)", [
      claimed.rows[0].id,
      claimed.rows[0].lease_owner,
      JSON.stringify({ ok: false, errorClass: "ambiguous", message: "unknown outcome" }),
    ]);
    const outcome = await client.query(
      `SELECT j.status, c.message_status FROM public.communication_jobs j
      JOIN public.communications c ON c.id = j.communication_id WHERE j.id = $1`,
      [claimed.rows[0].id],
    );
    assert.equal(outcome.rows[0].status, "dead_letter");
    assert.equal(outcome.rows[0].message_status, "unconfirmed");

    const crashed = await client.query(
      `WITH c AS (
      INSERT INTO public.communications (institution_id, student_id, parent_id, type, message_status, metadata)
      VALUES ($1, $2, $3, 'sms', 'queued', '{"purpose":"absence-alert"}'::jsonb) RETURNING id
    ) INSERT INTO public.communication_jobs
      (institution_id, communication_id, channel, idempotency_key, status, attempts,
       locked_at, lease_owner, provider_request_started_at)
      SELECT $1, c.id, 'sms', 'sms-crash-test', 'processing', 1,
        now() - interval '16 minutes', gen_random_uuid(), now() - interval '16 minutes'
      FROM c RETURNING id`,
      [institutionId, studentId, parentId],
    );
    assert.equal(
      (await client.query("SELECT id FROM public.claim_communication_jobs(1)")).rows.length,
      0,
    );
    const crashOutcome = await client.query(
      `SELECT j.status, c.message_status
      FROM public.communication_jobs j JOIN public.communications c ON c.id = j.communication_id
      WHERE j.id = $1`,
      [crashed.rows[0].id],
    );
    assert.equal(crashOutcome.rows[0].status, "dead_letter");
    assert.equal(crashOutcome.rows[0].message_status, "unconfirmed");
    console.log(
      "  ✓ attendance → simulated provider → signed callback → dashboard row; language fallback, consent, rate limit, RLS and uncertain outcomes passed",
    );
  } finally {
    if (previousMode === undefined) delete process.env.SMS_DELIVERY_MODE;
    else process.env.SMS_DELIVERY_MODE = previousMode;
    if (previousToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = previousToken;
    globalThis.fetch = previousFetch;
  }
};
