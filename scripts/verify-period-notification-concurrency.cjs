const assert = require("node:assert/strict");
const { Client } = require("pg");
const { randomBytes } = require("node:crypto");
module.exports = async function verifyNotificationConcurrency(db, config, ctx) {
  const { institution, owner, ci, student, session, day, role } = ctx;
  const v = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
  const reason = "Reviewed isolated concurrent attendance correction and provider dispatch.";
  const clients = [];
  try {
    await role(owner);
    const relationship = await v("SELECT public.link_student_guardian($1,$2,$3,NULL,$4) AS value", [
      student,
      {
        guardian_name: "Concurrent Guardian",
        guardian_mobile: "+919876512345",
        guardian_language: "en",
      },
      {
        relationship: "guardian",
        is_primary: true,
        receives_notifications: true,
        effective_from: day,
      },
      reason,
    ]);
    await role(owner, true);
    const guardian = await v(
      "SELECT guardian_id AS value FROM public.student_guardian_relationships WHERE id=$1",
      [relationship],
    );
    const cv = await v("SELECT contact_version AS value FROM public.parents WHERE id=$1", [
      guardian,
    ]);
    await role(owner);
    await db.query("SELECT public.record_guardian_communication_consent($1,$2,$3,true,$4,$5)", [
      student,
      guardian,
      cv,
      "Simulated affirmative consent in disposable concurrency fixture",
      reason,
    ]);
    await db.query("SELECT public.set_period_notification_settings($1,true,'23:59:59')", [
      institution,
    ]);
    await role(owner, true);
    const hash = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO public.guardian_notification_invitations(institution_id,guardian_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,now()+interval '15 minutes',$4)",
      [institution, guardian, hash, owner],
    );
    const installation = await v(
      "SELECT public.consume_guardian_notification_invitation_with_consent($1,'fixture-concurrent-notification-device',$2,'attendai-41f64','2026-10-16.1') AS value",
      [hash, randomBytes(32).toString("hex")],
    );
    await db.query(
      "UPDATE public.period_sessions SET lock_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [session],
    );
    async function change(status, connection = db) {
      const d = (
        await connection.query("SELECT public.period_session_detail($1) AS value", [session])
      ).rows[0].value;
      const m = d.roster.find((r) => r.student_id === student);
      return connection.query("SELECT public.correct_period_mark($1,$2,$3,$4,$5,$6,$7)", [
        session,
        student,
        m.mark,
        status,
        d.session.revision,
        m.mark_revision,
        reason,
      ]);
    }
    await role(ci);
    await change("absent");
    await role(owner, true);
    for (let n = 0; n < 2; n++) {
      const c = new Client(config);
      await c.connect();
      clients.push(c);
    }
    const [one, two] = clients;
    await Promise.all(
      clients.map((c) => c.query("SELECT public.process_period_notifications(100)")),
    );
    assert.equal(
      await v(
        "SELECT count(*)::int AS value FROM public.period_notification_events WHERE institution_id=$1 AND kind='first_absence'",
        [institution],
      ),
      1,
      "Two processors create one first event",
    );
    const comm = await v(
      "SELECT r.communication_id AS value FROM public.period_notification_recipients r JOIN public.period_notification_events e ON e.id=r.event_id WHERE e.institution_id=$1 AND e.kind='first_absence'",
      [institution],
    );
    const job = await v(
      "UPDATE public.communication_jobs SET status='processing',lease_owner=gen_random_uuid(),locked_at=now(),attempts=attempts+1 WHERE communication_id=$1 RETURNING to_jsonb(communication_jobs) AS value",
      [comm],
    );
    await two.query("SET ROLE authenticated");
    await two.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",
      [ci],
    );
    // Both real transactions compete for the institution mutex.
    const race = await Promise.all([
      one.query("SELECT public.begin_push_dispatch($1,$2,$3) AS value", [
        job.id,
        job.lease_owner,
        installation,
      ]),
      change("present", two),
    ]);
    const began = race[0].rows[0].value === "send";
    if (began) {
      assert.equal(
        await v(
          "SELECT public.finish_push_dispatch($1,$2,$3,'provider_accepted','projects/attendai-41f64/messages/concurrent-original',NULL) AS value",
          [job.id, job.lease_owner, installation],
        ),
        true,
      );
      assert.equal(
        await v(
          "SELECT count(*)::int AS value FROM public.period_notification_events WHERE institution_id=$1 AND kind='correction'",
          [institution],
        ),
        1,
        "In-flight winner produces a correction after acceptance",
      );
      await db.query("SELECT public.complete_push_job($1,$2,false)", [job.id, job.lease_owner]);
    } else
      assert.equal(
        await v(
          "SELECT count(*)::int AS value FROM public.communication_dispatches WHERE communication_id=$1",
          [comm],
        ),
        0,
        "Correction winner prevents the provider attempt",
      );
    await role(ci);
    await change("absent");
    await role(owner, true);
    await two.query("RESET ROLE");
    await db.query(
      "UPDATE public.period_notification_settings SET summary_local_time=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::time WHERE institution_id=$1",
      [institution],
    );
    await Promise.all(
      clients.map((c) => c.query("SELECT public.process_period_notifications(100)")),
    );
    assert.equal(
      await v(
        "SELECT count(*)::int AS value FROM public.period_notification_events WHERE institution_id=$1 AND kind='daily_summary'",
        [institution],
      ),
      1,
      "Concurrent summary processors remain unique",
    );
    const summary = await v(
      "SELECT r.communication_id AS value FROM public.period_notification_recipients r JOIN public.period_notification_events e ON e.id=r.event_id WHERE e.institution_id=$1 AND e.kind='daily_summary'",
      [institution],
    );
    const sj = await v(
      "UPDATE public.communication_jobs SET status='processing',lease_owner=gen_random_uuid(),locked_at=now(),attempts=attempts+1 WHERE communication_id=$1 RETURNING to_jsonb(communication_jobs) AS value",
      [summary],
    );
    const begins = await Promise.all(
      clients.map((c) =>
        c.query("SELECT public.begin_push_dispatch($1,$2,$3) AS value", [
          sj.id,
          sj.lease_owner,
          installation,
        ]),
      ),
    );
    assert.equal(
      begins.filter((r) => r.rows[0].value === "send").length,
      1,
      "Two workers cannot both start a provider request for the same installation",
    );
    assert.equal(begins.filter((r) => r.rows[0].value === "unconfirmed").length, 1);
    await db.query(
      "SELECT public.finish_push_dispatch($1,$2,$3,'provider_accepted','projects/attendai-41f64/messages/concurrent-summary',NULL)",
      [sj.id, sj.lease_owner, installation],
    );
    await db.query("SELECT public.complete_push_job($1,$2,false)", [sj.id, sj.lease_owner]);
    const d = (await two.query("SELECT public.period_session_detail($1) AS value", [session]))
      .rows[0]?.value;
    // The query above uses a trusted connection only to read the fixture snapshot.
    assert.ok(d);
    for (const c of clients) {
      await c.query("SET ROLE authenticated");
      await c.query(
        "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",
        [ci],
      );
    }
    const md = d.roster.find((r) => r.student_id === student);
    const corrections = await Promise.allSettled(
      clients.map((c) =>
        c.query("SELECT public.correct_period_mark($1,$2,$3,'present',$4,$5,$6)", [
          session,
          student,
          md.mark,
          d.session.revision,
          md.mark_revision,
          reason,
        ]),
      ),
    );
    assert.equal(
      corrections.filter((r) => r.status === "fulfilled").length,
      1,
      "Concurrent stale corrections have one winner",
    );
    assert.equal(corrections.find((r) => r.status === "rejected").reason.code, "42501");
    console.log(
      "  PASS Phase 4B concurrency: two processors dedupe first/summary events; correction versus dispatch serializes; duplicate provider starts and stale concurrent corrections have one winner.",
    );
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()));
    await role(null, true);
  }
};
