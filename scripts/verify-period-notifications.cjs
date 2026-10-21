const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
module.exports = async function verifyPeriodNotifications(db, ctx) {
  const {
    owner,
    other,
    institution,
    day,
    lab,
    studentB,
    ciA,
    ciB,
    facultyUser,
    role,
    detail,
    correct,
  } = ctx;
  const v = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
  const reason =
    "Reviewed guardian authority and actual isolated attendance notification scenario.";
  await db.query("SAVEPOINT phase4b");
  try {
    await role(owner, true);
    const studentA = await v(
      "SELECT student_id AS value FROM public.period_marks WHERE session_id=$1 AND student_id<>$2 AND status='absent' LIMIT 1",
      [lab, studentB],
    );
    assert.ok(studentA, "A second independently absent student is required");
    const baseline = await v("SELECT count(*)::int AS value FROM auth.users");
    async function guardian(n, student, opts = {}) {
      await role(owner);
      const relation = await v("SELECT public.link_student_guardian($1,$2,$3,NULL,$4) AS value", [
        student,
        {
          guardian_name: "Period Guardian " + n,
          guardian_mobile: "+91987655" + String(n).padStart(4, "0"),
          guardian_language: "en",
        },
        {
          relationship: "guardian",
          is_primary: false,
          receives_notifications: opts.preference !== false,
          effective_from: day,
          preferred_channel: opts.channel ?? null,
        },
        reason,
      ]);
      await role(owner, true);
      const g = await v(
        "SELECT guardian_id AS value FROM public.student_guardian_relationships WHERE id=$1",
        [relation],
      );
      if (opts.consent !== false) {
        const cv = await v("SELECT contact_version AS value FROM public.parents WHERE id=$1", [g]);
        await role(owner);
        await db.query("SELECT public.record_guardian_communication_consent($1,$2,$3,true,$4,$5)", [
          student,
          g,
          cv,
          "Actual affirmative consent simulated only in disposable PostgreSQL",
          reason,
        ]);
      }
      await role(owner, true);
      let device;
      if (opts.device !== false && opts.consent !== false && opts.preference !== false) {
        const hash = randomBytes(32).toString("hex");
        await db.query(
          "INSERT INTO public.guardian_notification_invitations(institution_id,guardian_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,now()+interval '15 minutes',public.current_profile_id())",
          [institution, g, hash],
        );
        device = await v(
          "SELECT public.consume_guardian_notification_invitation_with_consent($1,$2,$3,'attendai-41f64','2026-10-16.1') AS value",
          [hash, "fixture-period-device-" + n, randomBytes(32).toString("hex")],
        );
      }
      return { g, device, relation };
    }
    const shared = await guardian(101, studentA),
      second = await guardian(102, studentA),
      unavailable = await guardian(103, studentA, { device: false });
    await guardian(104, studentA, { preference: false });
    await guardian(105, studentA, { consent: false });
    await guardian(106, studentA, { channel: "sms" });
    await role(owner, true);
    const p = await v("SELECT to_jsonb(p) AS value FROM public.parents p WHERE id=$1", [shared.g]);
    await role(owner);
    await db.query("SELECT public.link_student_guardian($1,$2,$3,$4,$5)", [
      studentB,
      { guardian_id: shared.g, guardian_name: p.name, guardian_mobile: p.phone },
      {
        relationship: "guardian",
        is_primary: false,
        receives_notifications: true,
        effective_from: day,
      },
      p.contact_version,
      reason,
    ]);
    await db.query("SELECT public.set_period_notification_settings($1,true,'23:59:59')", [
      institution,
    ]);
    await role(owner, true);
    const process = () => v("SELECT public.process_period_notifications(100) AS value");
    const count = (kind) =>
      v(
        "SELECT count(*)::int AS value FROM public.period_notification_events WHERE institution_id=$1 AND kind=$2",
        [institution, kind],
      );
    await db.query("SAVEPOINT clock_gates");
    await db.query(
      "UPDATE public.period_sessions SET lock_at=clock_timestamp()+interval '5 minutes' WHERE institution_id=$1 AND submitted_at IS NOT NULL",
      [institution],
    );
    await process();
    assert.equal(await count("first_absence"), 0, "Grace-period absences cannot queue");
    await db.query("UPDATE public.period_sessions SET submitted_at=NULL WHERE institution_id=$1", [
      institution,
    ]);
    await process();
    assert.equal(
      await count("first_absence"),
      0,
      "Pending/unsubmitted sessions cannot queue even if mark rows exist",
    );
    await db.query(
      "UPDATE public.period_sessions SET submitted_at=clock_timestamp(),lock_at=clock_timestamp()-interval '1 second',status='cancelled' WHERE institution_id=$1",
      [institution],
    );
    await process();
    assert.equal(await count("first_absence"), 0, "Cancelled sessions cannot queue");
    await db.query("ROLLBACK TO SAVEPOINT clock_gates");
    await db.query("RELEASE SAVEPOINT clock_gates");
    await process();
    await process();
    assert.equal(await count("first_absence"), 2, "One logical first event for each sibling");
    assert.equal(await count("daily_summary"), 0);
    const eventA = await v(
      "SELECT id AS value FROM public.period_notification_events WHERE student_id=$1 AND kind='first_absence'",
      [studentA],
    );
    const eventB = await v(
      "SELECT id AS value FROM public.period_notification_events WHERE student_id=$1 AND kind='first_absence'",
      [studentB],
    );
    const firstSessionA = await v(
      "SELECT facts->0->>'session_id' AS value FROM public.period_notification_events WHERE id=$1",
      [eventA],
    );
    assert.equal(
      await v(
        "SELECT count(*)::int AS value FROM public.period_notification_recipients WHERE event_id=$1 AND state='queued'",
        [eventA],
      ),
      2,
    );
    assert.equal(
      await v(
        "SELECT state AS value FROM public.period_notification_recipients WHERE event_id=$1 AND guardian_id=$2",
        [eventA, unavailable.g],
      ),
      "unavailable",
    );
    assert.equal(
      await v(
        "SELECT count(*)::int AS value FROM public.period_notification_recipients WHERE event_id=$1 AND state='ineligible'",
        [eventA],
      ),
      3,
    );
    // A correction wins before the dispatch fence, even if a worker claimed the job.
    const commB = await v(
      "SELECT communication_id AS value FROM public.period_notification_recipients WHERE event_id=$1",
      [eventB],
    );
    await role(ciB.uid);
    await correct(await detail(lab), studentB, "present");
    await role(owner, true);
    const jobB = await v(
      "SELECT to_jsonb(j) AS value FROM public.communication_jobs j WHERE communication_id=$1",
      [commB],
    );
    assert.equal(jobB.status, "completed");
    assert.notEqual(
      await v("SELECT public.begin_push_dispatch($1,$2,$3) AS value", [
        jobB.id,
        jobB.lease_owner,
        shared.device,
      ]),
      "send",
    );
    assert.equal(
      await v(
        "SELECT count(*)::int AS value FROM public.communication_dispatches WHERE communication_id=$1",
        [commB],
      ),
      0,
    );
    // Existing queue and provider architecture; only a simulated provider ID is used here.
    async function claim(comm) {
      return v(
        "UPDATE public.communication_jobs SET status='processing',lease_owner=gen_random_uuid(),locked_at=now(),attempts=attempts+1 WHERE communication_id=$1 RETURNING to_jsonb(communication_jobs) AS value",
        [comm],
      );
    }
    const commA = await v(
      "SELECT communication_id AS value FROM public.period_notification_recipients WHERE event_id=$1 AND guardian_id=$2",
      [eventA, shared.g],
    );
    let job = await claim(commA);
    assert.equal(
      (
        await v("SELECT public.prepare_push_dispatch($1,$2,$3) AS value", [
          job.id,
          job.lease_owner,
          shared.device,
        ])
      ).status,
      "send",
    );
    assert.equal(
      await v("SELECT public.begin_push_dispatch($1,$2,$3) AS value", [
        job.id,
        job.lease_owner,
        shared.device,
      ]),
      "unconfirmed",
      "Same in-flight request cannot be replayed",
    );
    // A correction while the provider request is in flight cannot erase that attempt.
    await role(ciA.uid);
    await correct(await detail(firstSessionA), studentA, "present");
    await role(owner, true);
    assert.equal(
      await count("correction"),
      0,
      "Do not claim an uncertain provider attempt was accepted",
    );
    assert.equal(
      await v(
        "SELECT public.finish_push_dispatch($1,$2,$3,'provider_accepted','projects/attendai-41f64/messages/isolated-period-provider',NULL) AS value",
        [job.id, job.lease_owner, shared.device],
      ),
      true,
    );
    assert.equal(
      await count("correction"),
      1,
      "Late provider acceptance must create the correction",
    );
    await db.query("SELECT public.complete_push_job($1,$2,false)", [job.id, job.lease_owner]);
    assert.equal(
      await v("SELECT message_status AS value FROM public.communications WHERE id=$1", [commA]),
      "provider_accepted",
    );
    assert.equal(
      await v(
        "SELECT display_acknowledged_at AS value FROM public.communication_dispatches WHERE communication_id=$1",
        [commA],
      ),
      null,
      "Acceptance is not display evidence",
    );
    const correction = await v(
      "SELECT id AS value FROM public.period_notification_events WHERE original_event_id=$1",
      [eventA],
    );
    assert.equal(
      await v(
        "SELECT count(*)::int AS value FROM public.period_notification_recipients WHERE event_id=$1",
        [correction],
      ),
      1,
      "Only the guardian with a provider-accepted original gets a correction",
    );
    const correctionComm = await v(
      "SELECT communication_id AS value FROM public.period_notification_recipients WHERE event_id=$1",
      [correction],
    );
    assert.equal(
      await v("SELECT public.period_notification_eligible($1) AS value", [correctionComm]),
      true,
    );
    job = await claim(correctionComm);
    assert.equal(
      (
        await v("SELECT public.prepare_push_dispatch($1,$2,$3) AS value", [
          job.id,
          job.lease_owner,
          shared.device,
        ])
      ).status,
      "send",
    );
    await db.query(
      "SELECT public.finish_push_dispatch($1,$2,$3,'provider_accepted','projects/attendai-41f64/messages/isolated-correction',NULL)",
      [job.id, job.lease_owner, shared.device],
    );
    await db.query("SELECT public.complete_push_job($1,$2,false)", [job.id, job.lease_owner]);
    assert.equal(
      await v("SELECT message_status AS value FROM public.communications WHERE id=$1", [
        correctionComm,
      ]),
      "provider_accepted",
    );
    // Present -> absent consumes no second first alert; a superseded unsent correction cannot send.
    await role(ciA.uid);
    await correct(await detail(firstSessionA), studentA, "absent");
    await role(owner, true);
    await process();
    assert.equal(await count("first_absence"), 2);
    assert.equal(
      await count("correction"),
      2,
      "A later reversal records a new correction linked to the original, without another first alert",
    );
    assert.equal(
      await v("SELECT public.period_notification_eligible($1) AS value", [correctionComm]),
      false,
    );
    // End-of-day generation is durable and reads current corrected marks.
    await db.query(
      "UPDATE public.period_notification_settings SET summary_local_time=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::time WHERE institution_id=$1",
      [institution],
    );
    await process();
    await process();
    assert.equal(
      await count("daily_summary"),
      1,
      "Only the student with remaining final absences gets a summary",
    );
    const summary = await v(
      "SELECT to_jsonb(e) AS value FROM public.period_notification_events e WHERE institution_id=$1 AND kind='daily_summary'",
      [institution],
    );
    assert.ok(summary.facts.every((f) => f.status === "absent"));
    const summaryComm = await v(
      "SELECT communication_id AS value FROM public.period_notification_recipients WHERE event_id=$1 AND guardian_id=$2",
      [summary.id, shared.g],
    );
    assert.ok(summaryComm);
    // A changed contact can never retarget a previously queued communication.
    const cv = await v("SELECT contact_version AS value FROM public.parents WHERE id=$1", [
      shared.g,
    ]);
    await role(owner);
    await db.query("SELECT public.update_guardian_contact($1,$2,$3,$4,$5)", [
      studentA,
      shared.g,
      { name: p.name, phone: "+919876559999", email: "", language: "en", active: true },
      cv,
      reason,
    ]);
    await role(owner, true);
    assert.equal(
      await v("SELECT public.period_notification_eligible($1) AS value", [summaryComm]),
      false,
    );
    assert.equal(
      await v("SELECT guardian_contact_version AS value FROM public.communications WHERE id=$1", [
        summaryComm,
      ]),
      cv,
    );
    const secondComm = await v(
      "SELECT communication_id AS value FROM public.period_notification_recipients WHERE event_id=$1 AND guardian_id=$2",
      [summary.id, second.g],
    );
    assert.equal(
      await v("SELECT public.period_notification_eligible($1) AS value", [secondComm]),
      true,
    );
    for (const status of [
      "inactive",
      "graduated",
      "transferred_out",
      "discontinued",
      "suspended",
    ]) {
      await db.query("SAVEPOINT student_status_gate");
      const version = await v("SELECT academic_version AS value FROM public.students WHERE id=$1", [
        studentA,
      ]);
      await role(owner);
      await db.query("SELECT public.change_student_academic_status($1,$2,$3,$4)", [
        studentA,
        status,
        version,
        reason,
      ]);
      await role(owner, true);
      assert.equal(
        await v("SELECT public.period_notification_eligible($1) AS value", [secondComm]),
        false,
        `${status} suppresses pending notices`,
      );
      await db.query("ROLLBACK TO SAVEPOINT student_status_gate");
      await db.query("RELEASE SAVEPOINT student_status_gate");
    }
    await db.query("SAVEPOINT project_gate");
    await db.query(
      "UPDATE public.guardian_notification_installations SET firebase_project_id='siri-1b57c' WHERE id=$1",
      [second.device],
    );
    assert.equal(
      await v("SELECT public.period_notification_device_valid($1,$2,$3) AS value", [
        second.device,
        second.g,
        institution,
      ]),
      false,
    );
    await db.query("ROLLBACK TO SAVEPOINT project_gate");
    await db.query("RELEASE SAVEPOINT project_gate");
    await db.query(
      "UPDATE public.period_notification_events SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [summary.id],
    );
    assert.equal(
      await v("SELECT public.period_notification_eligible($1) AS value", [secondComm]),
      false,
      "Expired notices never reach the provider",
    );
    await db.query(
      "UPDATE public.period_notification_events SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
      [summary.id],
    );
    // Accepted summaries also get a new correction when remaining periods become recorded leave.
    job = await claim(secondComm);
    assert.equal(
      await v("SELECT public.begin_push_dispatch($1,$2,$3) AS value", [
        job.id,
        job.lease_owner,
        second.device,
      ]),
      "send",
    );
    await db.query(
      "SELECT public.finish_push_dispatch($1,$2,$3,'provider_accepted','projects/attendai-41f64/messages/isolated-summary',NULL)",
      [job.id, job.lease_owner, second.device],
    );
    await db.query("SELECT public.complete_push_job($1,$2,false)", [job.id, job.lease_owner]);
    const guardianStatus = await v("SELECT public.period_guardian_event_status($1,$2) AS value", [
      secondComm,
      second.device,
    ]);
    assert.ok(guardianStatus.facts.length > 0);
    assert.equal(
      await v("SELECT public.period_guardian_event_status($1,$2) AS value", [
        secondComm,
        shared.device,
      ]),
      null,
      "A different guardian cannot read this event",
    );
    await role(ciA.uid);
    await db.query("SELECT public.approve_student_day_leave($1,$2,$3)", [studentA, day, reason]);
    await role(owner, true);
    assert.ok(
      await v(
        "SELECT EXISTS(SELECT 1 FROM public.period_notification_events e JOIN public.period_notification_recipients r ON r.event_id=e.id WHERE e.original_event_id=$1 AND r.guardian_id=$2 AND e.facts->0->>'status'='approved_leave') AS value",
        [summary.id, second.g],
      ),
    );
    assert.equal(
      await v(
        "SELECT EXISTS(SELECT 1 FROM public.period_marks m JOIN public.period_sessions s ON s.id=m.session_id WHERE m.student_id=$1 AND m.status='approved_leave' AND public.period_absence_facts(m.institution_id,m.student_id,s.session_date) @> jsonb_build_array(jsonb_build_object('session_id',s.id))) AS value",
        [studentA],
      ),
      false,
      "Approved leave is never an absence fact",
    );
    assert.equal(
      await v("SELECT count(*)::int AS value FROM auth.users"),
      baseline,
      "Guardians have no invented Auth identity",
    );
    assert.ok(
      (await v(
        "SELECT count(*)::int AS value FROM public.period_notification_audit WHERE institution_id=$1",
        [institution],
      )) > 10,
    );
    await role(facultyUser);
    assert.equal(
      await v("SELECT count(*)::int AS value FROM public.period_notification_recipients"),
      0,
      "Faculty cannot read recipient identities",
    );
    const statuses = await v("SELECT public.period_notification_status($1) AS value", [lab]);
    assert.ok(statuses.length > 0);
    assert.ok(
      !JSON.stringify(statuses).includes("guardian_id") &&
        !JSON.stringify(statuses).includes("phone") &&
        !JSON.stringify(statuses).includes("installation"),
    );
    for (const uid of [facultyUser, other]) {
      await role(uid);
      await db.query("SAVEPOINT notification_denied");
      await assert.rejects(
        db.query("SELECT public.process_period_notifications(10)"),
        (e) => e.code === "42501",
      );
      await db.query("ROLLBACK TO SAVEPOINT notification_denied");
    }
    console.log(
      "  PASS Phase 4B: first/day dedupe, multiple guardians and siblings, consent/devices, pre-fence cancellation, in-flight acceptance correction, summary/idempotency, stale contact/TTL, provider-vs-display, private scoped status and audit.",
    );
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT phase4b");
    await db.query("RELEASE SAVEPOINT phase4b");
    await role(owner, true);
  }
};
