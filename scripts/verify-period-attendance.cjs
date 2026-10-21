const assert = require("node:assert/strict");
module.exports = async function verifyPeriodAttendance(db, ctx) {
  const {
    owner,
    other,
    institution,
    staff,
    facultyUser,
    dep,
    program,
    t1,
    section: a,
    sectionB: b,
    cohort,
    students,
    day,
  } = ctx;
  await db.query("SAVEPOINT phase4a");
  let denials = 0;
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
  async function role(user, system = false) {
    await db.query("RESET ROLE");
    await db.query("SET LOCAL ROLE " + (system ? "postgres" : "authenticated"));
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [user ?? "", system ? "service_role" : "authenticated"],
    );
  }
  async function denied(sql, args = []) {
    await db.query("SAVEPOINT period_denied");
    try {
      await assert.rejects(db.query(sql, args), (e) =>
        ["42501", "22023", "23505", "23514", "23503"].includes(e.code),
      );
      denials++;
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT period_denied");
      await db.query("RELEASE SAVEPOINT period_denied");
    }
  }
  const reason =
    "Reviewed actual institution timetable, faculty duties and attendance records for this change.";
  const date = (n) => value("SELECT ($1::date+$2::int)::text AS value", [day, n]);
  const entity = (kind, details) =>
    value("SELECT public.create_academic_entity($1,$2,$3) AS value", [institution, kind, details]);
  const detail = (id) => value("SELECT public.period_session_detail($1) AS value", [id]);
  const records = (d, mark = "present") =>
    d.roster.map((r) => ({ student_id: r.student_id, status: mark }));
  const submit = (d, marks = records(d)) =>
    value("SELECT public.submit_period_session($1,$2,$3,$4) AS value", [
      d.session.id,
      d.session.revision,
      JSON.stringify(marks),
      "SUBMIT " + d.roster.length,
    ]);
  const correct = (d, student, newMark) => {
    const m = d.roster.find((x) => x.student_id === student);
    return db.query("SELECT public.correct_period_mark($1,$2,$3,$4,$5,$6,$7)", [
      d.session.id,
      student,
      m.mark,
      newMark,
      d.session.revision,
      m.mark_revision,
      reason,
    ]);
  };
  async function makePerson(n, roles) {
    const uid = "95000000-0000-4000-8000-" + String(n).padStart(12, "0"),
      email = "period-" + n + "@fixture.invalid";
    await role(owner, true);
    await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())", [
      uid,
      email,
    ]);
    await db.query(
      "INSERT INTO public.user_policy_acceptances(user_id,policy_version_id,acceptance_method) SELECT $1,id,'access_gate' FROM public.policy_versions WHERE active",
      [uid],
    );
    await role(owner);
    const id = await value("SELECT public.create_staff_record($1,$2,$3) AS value", [
      institution,
      {
        full_name: "Period Fixture " + n,
        staff_code: "PERIOD-" + n,
        email,
        designation: "Recorded Lecturer",
        primary_department_id: dep,
      },
      roles,
    ]);
    const { createHash } = require("node:crypto"),
      token = String(n).padStart(64, "a");
    await db.query("SELECT public.prepare_staff_invitation($1,$2,$3)", [
      id,
      uid,
      createHash("sha256").update(token).digest("hex"),
    ]);
    await role(uid);
    await db.query("SELECT public.accept_staff_setup_invitation($1)", [token]);
    await role(owner);
    return { id, uid };
  }
  async function responsibility(id, kind, sec, subject) {
    return value("SELECT public.add_staff_responsibility($1,$2) AS value", [
      id,
      {
        kind,
        department_id: dep,
        program_id: program,
        term_id: t1,
        section_id: sec,
        subject_id: subject,
        academic_year: "Current test year",
        effective_from: kind === "class_incharge" ? day : await date(-10),
        effective_until: await date(90),
        reason,
      },
    ]);
  }
  async function rule(label, time, sections = [a], extra = {}, replacement = null) {
    const tomorrow = await date(1);
    return value("SELECT public.create_timetable_rule($1,$2,$3,$4,$5) AS value", [
      institution,
      {
        owner_section_id: a,
        subject_id: subject,
        faculty_id: staff,
        label,
        kind: "normal",
        slots: [label],
        starts_at: time,
        ends_at: time.slice(0, 3) + "40",
        on_date: tomorrow,
        weekday: null,
        effective_from: tomorrow,
        effective_until: tomorrow,
        ...extra,
      },
      sections,
      reason,
      replacement,
    ]);
  }
  async function generate() {
    return value("SELECT public.materialize_period_sessions($1,$2,$2,$3) AS value", [
      institution,
      await date(1),
      reason,
    ]);
  }
  async function sessionFor(ruleId) {
    return value("SELECT id AS value FROM public.period_sessions WHERE rule_id=$1", [ruleId]);
  }
  async function startNow(sid, remaining = false) {
    await role(owner, true);
    await db.query(
      "UPDATE public.period_sessions SET session_date=$2,starts_at=clock_timestamp()-interval '1 minute',ends_at=clock_timestamp()+($3::boolean::integer*120+1)*interval '1 minute' WHERE id=$1",
      [sid, day, remaining],
    );
    await role(facultyUser);
  }
  async function lock(sid) {
    await role(owner, true);
    await db.query(
      "UPDATE public.period_sessions SET lock_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [sid],
    );
    await role(facultyUser);
  }
  let subject;
  try {
    await role(owner, true);
    const untouched = await value(
      "SELECT jsonb_build_object('attendance',(SELECT count(*) FROM public.attendance_records),'legacy_sessions',(SELECT count(*) FROM public.attendance_sessions),'messages',(SELECT count(*) FROM public.communications),'jobs',(SELECT count(*) FROM public.communication_jobs),'devices',(SELECT count(*) FROM public.guardian_notification_installations)) AS value",
    );
    await role(owner);
    await db.query("SELECT public.set_staff_roles($1,ARRAY['faculty','hod'],$2)", [staff, reason]);
    subject = await entity("subject", {
      program_id: program,
      name: "Period Session Subject",
      code: "PERIOD",
    });
    await responsibility(staff, "teaching", a, subject);
    await responsibility(staff, "teaching", b, subject);
    const ciA = await makePerson(1, ["class_incharge"]),
      ciB = await makePerson(2, ["class_incharge"]),
      sub = await makePerson(3, ["faculty"]),
      hod = await makePerson(4, ["hod"]);
    // Retire inherited CI duties to install independent fixture CIs without overlap.
    await role(owner, true);
    await db.query(
      "UPDATE public.staff_responsibilities SET active=false,closed_at=now(),ended_on=$2::date-1,end_reason=$3 WHERE institution_id=$1 AND kind='class_incharge' AND active AND section_id=ANY($4::uuid[])",
      [institution, day, reason, [a, b]],
    );
    await role(owner);
    await responsibility(ciA.id, "class_incharge", a, null);
    await responsibility(ciB.id, "class_incharge", b, null);
    // Add an actual B student using the real canonical student import.
    const imported = await value(
      "SELECT public.stage_student_import($1,'period-student.csv',$2,$3,$4) AS value",
      [
        institution,
        "a".repeat(64),
        JSON.stringify([
          {
            full_name: "Period Section B Student",
            admission_number: "PERIOD-B",
            roll_number: "PERIOD-B",
            admitted_on: day,
            department_code: "LIB",
            program_code: "IDC",
            cohort_code: "REC",
            academic_year: "Current test year",
            term_name: "Year Two",
            section_name: "South",
            entry_type: "normal",
            entry_academic_year: "Current test year",
            entry_term_name: "Year Two",
            starts_on: day,
          },
        ]),
        reason,
      ],
    );
    const result = await value(
      "SELECT public.commit_student_import($1,$2,ARRAY[1],'IMPORT 1',$3) AS value",
      [imported.id, imported.revision, reason],
    );
    const studentB = result[0].student_id;
    // Guardian-free academic import must not activate the old attendance path.
    await role(owner, true);
    assert.equal(
      await value("SELECT public.period_faculty_valid($1,$2,$3) AS value", [
        staff,
        institution,
        await date(1),
      ]),
      true,
      "Scheduled staff must have current verified faculty role",
    );
    assert.equal(
      await value("SELECT public.period_teaches($1,$2,$3,$4) AS value", [
        staff,
        a,
        subject,
        await date(1),
      ]),
      true,
      "Recorded subject responsibility must authorize schedule",
    );
    await role(owner);
    const rNormal = await rule("Normal period", "08:00"),
      rLab = await rule("Combined laboratory", "09:00", [a, b], {
        kind: "lab",
        slots: ["Lab 1", "Lab 2"],
        ends_at: "10:40",
      }),
      rExtra = await rule("Extra class", "11:00", [a], { kind: "extra" }),
      rPending = await rule("Never submitted", "12:00"),
      rCancelled = await rule("Cancelled class", "13:00"),
      rOverride = await rule("Original special", "14:00"),
      rCombined = await rule("Combined periods", "19:00", [a], {
        kind: "combined",
        slots: ["Seminar 1", "Seminar 2", "Seminar 3"],
        ends_at: "20:00",
      });
    await denied("SELECT public.create_timetable_rule($1,$2,$3,$4,NULL)", [
      institution,
      {
        owner_section_id: a,
        subject_id: subject,
        faculty_id: staff,
        label: "Overlap",
        kind: "normal",
        slots: ["Overlap"],
        starts_at: "08:10",
        ends_at: "08:30",
        on_date: await date(1),
        effective_from: await date(1),
        effective_until: await date(1),
      },
      [a],
      reason,
    ]);
    const weekly = await rule("Weekly plan", "16:00", [a], {
      weekday: await value("SELECT extract(dow FROM $1::date)::int AS value", [await date(1)]),
      on_date: null,
      effective_from: await date(1),
      effective_until: await date(8),
    });
    assert.equal(await generate(), 8);
    assert.equal(await generate(), 0, "Materialization is idempotent");
    const normal = await sessionFor(rNormal),
      lab = await sessionFor(rLab),
      extra = await sessionFor(rExtra),
      pending = await sessionFor(rPending),
      cancelled = await sessionFor(rCancelled),
      oldOverride = await sessionFor(rOverride);
    assert.equal((await detail(await sessionFor(rCombined))).session.planned.kind, "combined");
    let d = await detail(normal);
    assert.equal(d.session.state, "scheduled");
    const frozenPlan = d.session.planned;
    await db.query("SELECT public.add_timetable_exception($1,$2,$3,$4,$5)", [
      institution,
      a,
      await date(1),
      rCancelled,
      reason,
    ]);
    assert.equal((await detail(cancelled)).session.state, "cancelled");
    assert.equal((await detail(cancelled)).roster.length, 0);
    await denied("SELECT public.create_timetable_rule($1,$2,$3,$4,$5)", [
      institution,
      {
        owner_section_id: a,
        subject_id: subject,
        faculty_id: staff,
        label: "Past override",
        kind: "normal",
        slots: ["X"],
        starts_at: "14:00",
        ends_at: "14:40",
        on_date: await date(-1),
        effective_from: await date(-1),
        effective_until: await date(-1),
      },
      [a],
      reason,
      rOverride,
    ]);
    const replacement = await rule("Moved special period", "15:00", [a], {}, rOverride);
    await generate();
    assert.equal((await detail(oldOverride)).session.state, "cancelled");
    assert.equal(
      (await detail(await sessionFor(replacement))).session.planned.label,
      "Moved special period",
    );
    await db.query("SELECT public.add_timetable_exception($1,$2,$3,NULL,$4)", [
      institution,
      a,
      await date(8),
      reason,
    ]);
    await db.query("SELECT public.materialize_period_sessions($1,$2,$2,$3)", [
      institution,
      await date(8),
      reason,
    ]);
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.period_sessions WHERE rule_id=$1 AND session_date=$2 AND status='cancelled'",
        [weekly, await date(8)],
      ),
      1,
      "Holiday has no expected attendance",
    );
    // Only an assigned HOD+Faculty may mark; HOD/admin/CI alone cannot.
    await role(hod.uid);
    await denied("SELECT public.period_session_detail($1)", [normal]);
    await role(ciA.uid);
    assert.equal((await detail(normal)).can_mark, false);
    await role(ciB.uid);
    await denied("SELECT public.assign_period_substitute($1,$2,$3,$4)", [lab, sub.id, 1, reason]);
    await role(owner);
    await denied("SELECT public.assign_period_substitute($1,$2,$3,$4)", [
      normal,
      sub.id,
      1,
      reason,
    ]);
    await startNow(normal, true);
    d = await detail(normal);
    assert.equal(d.can_mark, true);
    assert.equal(
      (
        await db.query(
          "UPDATE public.period_sessions SET scheduled_faculty_id=$2 WHERE id=$1 RETURNING id",
          [normal, sub.id],
        )
      ).rowCount,
      0,
      "Browser cannot forge session marking ownership",
    );
    await denied(
      "INSERT INTO public.period_sessions(institution_id,rule_id,session_date,owner_section_id,subject_id,scheduled_faculty_id,starts_at,ends_at,planned,created_by) SELECT institution_id,rule_id,session_date+1,owner_section_id,subject_id,scheduled_faculty_id,starts_at,ends_at,planned,$2 FROM public.period_sessions WHERE id=$1",
      [normal, facultyUser],
    );
    assert.equal(d.session.state, "pending");
    assert.ok(d.roster.length >= 2);
    assert.equal(
      d.roster.some((r) => r.student_id === studentB),
      false,
    );
    assert.equal(
      await value("SELECT count(*)::int AS value FROM public.period_marks WHERE session_id=$1", [
        normal,
      ]),
      0,
    );
    await denied("SELECT public.submit_period_session($1,$2,$3,'SUBMIT 1')", [
      normal,
      d.session.revision,
      JSON.stringify(records(d).slice(0, 1)),
    ]);
    await denied("SELECT public.submit_period_session($1,$2,$3,$4)", [
      normal,
      d.session.revision,
      JSON.stringify(records(d, "late")),
      "SUBMIT " + d.roster.length,
    ]);
    const draftRevision = await value("SELECT public.save_period_draft($1,$2,$3) AS value", [
      normal,
      d.session.revision,
      JSON.stringify(records(d)),
    ]);
    assert.equal(Number(draftRevision), d.session.revision + 1);
    assert.equal(
      await value("SELECT count(*)::int AS value FROM public.period_marks WHERE session_id=$1", [
        normal,
      ]),
      0,
      "Draft never creates submitted marks",
    );
    const stale = d;
    d = await detail(normal);
    const originalRecords = records(d, "absent");
    await submit(d, originalRecords);
    await denied("SELECT public.submit_period_session($1,$2,$3,$4)", [
      normal,
      d.session.revision,
      JSON.stringify(originalRecords),
      "SUBMIT " + d.roster.length,
    ]);
    d = await detail(normal);
    assert.equal(d.session.state, "grace_period");
    assert.equal(new Date(d.session.lock_at) - new Date(d.session.submitted_at), 300000);
    assert.equal(d.session.actual_faculty_id, staff);
    assert.equal(d.session.submitted_by, facultyUser);
    assert.equal(d.roster[0].mark, "absent");
    await role(owner);
    await denied("SELECT public.correct_period_mark($1,$2,$3,$4,$5,$6,$7)", [
      normal,
      d.roster[0].student_id,
      "absent",
      "present",
      d.session.revision,
      1,
      reason,
    ]);
    await role(facultyUser);
    await correct(d, d.roster[0].student_id, "present");
    d = await detail(normal);
    assert.equal(d.roster[0].original_status, "absent");
    assert.equal(d.roster[0].mark, "present");
    await denied("SELECT public.save_period_draft($1,$2,$3)", [
      normal,
      stale.session.revision,
      JSON.stringify(records(d)),
    ]);
    await lock(normal);
    d = await detail(normal);
    assert.equal(d.session.state, "locked");
    assert.ok(d.session.locked_at);
    await denied("SELECT public.correct_period_mark($1,$2,$3,$4,$5,$6,$7)", [
      normal,
      d.roster[0].student_id,
      "present",
      "absent",
      d.session.revision,
      d.roster[0].mark_revision,
      reason,
    ]);
    await role(owner);
    await denied("SELECT public.correct_period_mark($1,$2,$3,$4,$5,$6,$7)", [
      normal,
      d.roster[0].student_id,
      "present",
      "absent",
      d.session.revision,
      d.roster[0].mark_revision,
      reason,
    ]);
    await role(ciB.uid);
    await denied("SELECT public.correct_period_mark($1,$2,$3,$4,$5,$6,$7)", [
      normal,
      d.roster[0].student_id,
      "present",
      "absent",
      d.session.revision,
      d.roster[0].mark_revision,
      reason,
    ]);
    await role(ciA.uid);
    await correct(d, d.roster[0].student_id, "absent");
    d = await detail(normal);
    assert.equal(d.session.state, "corrected");
    assert.equal(d.roster[0].original_status, "absent");
    await denied("SELECT public.cancel_period_session($1,$2,$3)", [
      normal,
      d.session.revision,
      reason,
    ]);
    const rewritten = await db.query(
      "UPDATE public.period_marks SET status='present' WHERE session_id=$1 RETURNING student_id",
      [normal],
    );
    assert.equal(rewritten.rowCount, 0, "Locked marks cannot be rewritten directly");
    await role(owner);
    assert.equal(
      (await value(
        "SELECT planned-'roster_frozen_at' AS value FROM public.period_sessions WHERE id=$1",
        [normal],
      ))
        ? true
        : false,
      true,
    );
    assert.deepEqual(
      await value(
        "SELECT planned-'roster_frozen_at' AS value FROM public.period_sessions WHERE id=$1",
        [normal],
      ),
      frozenPlan,
      "Session plan survives later edits and finalization",
    );
    // A substitute replaces authority for this session only and invalidates drafts.
    await startNow(extra, true);
    let ex = await detail(extra);
    await value("SELECT public.save_period_draft($1,$2,$3) AS value", [
      extra,
      ex.session.revision,
      JSON.stringify(records(ex)),
    ]);
    ex = await detail(extra);
    await role(ciA.uid);
    await db.query("SELECT public.assign_period_substitute($1,$2,$3,$4)", [
      extra,
      sub.id,
      ex.session.revision,
      reason,
    ]);
    await role(facultyUser);
    await denied("SELECT public.period_session_detail($1)", [extra]);
    await role(sub.uid);
    ex = await detail(extra);
    assert.equal(ex.can_mark, true);
    assert.equal(ex.draft, null);
    await denied("SELECT public.period_session_detail($1)", [normal]);
    await submit(ex);
    ex = await detail(extra);
    assert.equal(ex.session.actual_faculty_id, sub.id);
    assert.equal(ex.session.scheduled_faculty_id, staff);
    assert.equal(ex.session.submitted_by, sub.uid);
    // One merged lab has one roster/authority; CIs see/correct only their section.
    await startNow(lab, true);
    let merged = await detail(lab);
    assert.equal(merged.session.planned.slots.length, 2);
    assert.equal(merged.session.planned.sections.length, 2);
    assert.ok(merged.roster.some((r) => r.student_id === studentB));
    await submit(merged);
    await lock(lab);
    await role(ciA.uid);
    let aDetail = await detail(lab);
    assert.ok(aDetail.roster.every((r) => r.section_id === a));
    const bMark = await (async () => {
      await role(owner);
      return (await detail(lab)).roster.find((r) => r.student_id === studentB);
    })();
    await role(ciA.uid);
    await denied("SELECT public.correct_period_mark($1,$2,$3,$4,$5,$6,$7)", [
      lab,
      studentB,
      bMark.mark,
      "absent",
      aDetail.session.revision,
      bMark.mark_revision,
      reason,
    ]);
    await correct(aDetail, aDetail.roster[0].student_id, "absent");
    await role(ciB.uid);
    let bDetail = await detail(lab);
    assert.equal(bDetail.roster.length, 1);
    assert.equal(bDetail.roster[0].student_id, studentB);
    await correct(bDetail, studentB, "absent");
    bDetail = await detail(lab);
    assert.equal(
      bDetail.history.some((e) => e.student_id && e.student_id !== studentB),
      false,
      "Other section mark history is private",
    );
    // Full-day leave covers remaining sessions, never fabricates submitted absences.
    await role(ciA.uid);
    const leaveStudent = students[0];
    await db.query("SELECT public.approve_student_day_leave($1,$2,$3)", [
      leaveStudent,
      day,
      reason,
    ]);
    await role(facultyUser);
    d = await detail(normal);
    assert.equal(d.roster.find((r) => r.student_id === leaveStudent).mark, "approved_leave");
    assert.equal(d.roster.find((r) => r.student_id === leaveStudent).original_status, "absent");
    await startNow(pending, true);
    let unsubmitted = await detail(pending);
    assert.equal(unsubmitted.session.state, "pending");
    assert.equal(
      unsubmitted.roster.find((r) => r.student_id === leaveStudent).approved_leave,
      true,
    );
    assert.equal(
      unsubmitted.roster.every((r) => !r.mark),
      true,
    );
    await role(owner);
    await denied("SELECT public.approve_student_day_leave($1,$2,$3)", [studentB, day, reason]);
    await role(ciA.uid);
    await denied("SELECT public.approve_student_day_leave($1,$2,$3)", [studentB, day, reason]);
    await role(facultyUser);
    await submit(unsubmitted, records(unsubmitted, "absent"));
    unsubmitted = await detail(pending);
    assert.equal(
      unsubmitted.roster.find((r) => r.student_id === leaveStudent).mark,
      "approved_leave",
    );
    // Another unsubmitted session remains Pending indefinitely with zero marks.
    await role(owner);
    const neverRule = await rule("Unsubmitted has no absences", "18:00");
    await generate();
    const never = await sessionFor(neverRule);
    await startNow(never);
    const neverDetail = await detail(never);
    assert.equal(neverDetail.session.state, "pending");
    assert.ok(neverDetail.roster.every((r) => r.mark === null));
    await role(owner);
    await db.query("SELECT public.retire_timetable_rule($1,1,$2)", [weekly, reason]);
    assert.deepEqual(
      (await detail(normal)).session.planned,
      frozenPlan
        ? {
            ...frozenPlan,
            roster_frozen_at: (await detail(normal)).session.planned.roster_frozen_at,
          }
        : null,
    );
    await role(other);
    await denied("SELECT public.period_session_detail($1)", [lab]);
    await denied("SELECT public.period_session_directory($1,$2,$2,0)", [institution, day]);
    await role(facultyUser);
    await denied("SELECT public.create_timetable_rule($1,$2,$3,$4,NULL)", [
      institution,
      {},
      [a],
      reason,
    ]);
    await denied("SELECT public.period_event($1,$2,NULL,NULL,$3,NULL,NULL,$4)", [
      institution,
      normal,
      "forged.owner",
      reason,
    ]);
    await role(owner, true);
    assert.deepEqual(
      await value(
        "SELECT jsonb_build_object('attendance',(SELECT count(*) FROM public.attendance_records),'legacy_sessions',(SELECT count(*) FROM public.attendance_sessions),'messages',(SELECT count(*) FROM public.communications),'jobs',(SELECT count(*) FROM public.communication_jobs),'devices',(SELECT count(*) FROM public.guardian_notification_installations)) AS value",
      ),
      untouched,
      "No legacy records, notification jobs or transport changes from period attendance",
    );
    const events = (
      await db.query("SELECT * FROM public.period_attendance_events WHERE institution_id=$1", [
        institution,
      ])
    ).rows;
    for (const action of [
      "timetable.created",
      "timetable.overridden",
      "holiday.recorded",
      "session.scheduled",
      "session.cancelled",
      "substitute.assigned",
      "mark.submitted",
      "mark.grace_corrected",
      "session.locked",
      "mark.ci_corrected",
      "day_leave.approved",
      "mark.leave_approved",
    ])
      assert.ok(
        events.some((e) => e.action === action),
        action,
      );
    assert.ok(events.every((e) => e.actor_profile_id && e.reason && e.created_at));
    await require("./verify-period-notifications.cjs")(db, {
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
    });
    await role(owner);
    await db.query("SELECT public.set_staff_roles($1,ARRAY['hod'],$2)", [staff, reason]);
    await role(facultyUser);
    await denied("SELECT public.period_session_detail($1)", [normal]);
    await role(owner, true);
    await db.query("UPDATE public.staff_records SET status='inactive' WHERE id=$1", [sub.id]);
    await role(sub.uid);
    await denied("SELECT public.period_session_detail($1)", [extra]);
    console.log(
      `  PASS Phase 4A: timetable/weekly/overrides/lab/merged/extra/holiday, immutable plans, exact faculty/substitute, final submission, five-minute lock, CI scope, leave, pending/no implicit absences and audit (${denials} denied paths).`,
    );
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT phase4a");
    await db.query("RELEASE SAVEPOINT phase4a");
    await role(owner);
  }
};
