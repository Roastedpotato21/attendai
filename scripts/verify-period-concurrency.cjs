const assert = require("node:assert/strict");
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");
// Dedicated committed fixtures in the disposable database let two genuine
// PostgreSQL connections race. Never run this script against a linked project.
module.exports = async function verifyPeriodConcurrency(db, config) {
  const institution = randomUUID(),
    owner = randomUUID(),
    faculty = randomUUID(),
    ci = randomUUID(),
    sub = randomUUID();
  const reason = "Isolated concurrency fixture reviewed solely inside disposable PostgreSQL.";
  const v = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
  async function role(uid, system = false) {
    await db.query("RESET ROLE");
    if (!system) await db.query("SET ROLE authenticated");
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
      [uid ?? "", system ? "service_role" : "authenticated"],
    );
  }
  const connections = [];
  try {
    await role(null, true);
    for (const uid of [owner, faculty, ci, sub])
      await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())", [
        uid,
        uid + "@concurrency.fixture.invalid",
      ]);
    await db.query(
      "INSERT INTO public.user_policy_acceptances(user_id,policy_version_id,acceptance_method) SELECT u.id,v.id,'access_gate' FROM auth.users u CROSS JOIN public.policy_versions v WHERE u.id=ANY($1::uuid[]) AND v.active ON CONFLICT(user_id,policy_version_id) DO NOTHING",
      [[owner, faculty, ci, sub]],
    );
    await db.query(
      "INSERT INTO public.institutions(id,name,code,status,owner_profile_id) VALUES($1,'Disposable Concurrent Institution',$2,'active',$3)",
      [institution, "race-" + institution, owner],
    );
    for (const uid of [owner, faculty, ci, sub])
      await db.query(
        "INSERT INTO public.profile_institutions(profile_id,institution_id,status) VALUES($1,$2,'active')",
        [uid, institution],
      );
    const staff = {};
    for (const [uid, kind] of [
      [faculty, "faculty"],
      [ci, "class_incharge"],
      [sub, "faculty"],
    ]) {
      staff[uid] = await v(
        "INSERT INTO public.staff_records(institution_id,profile_id,full_name,email,designation,status,created_by) VALUES($1,$2,'Concurrent Fixture Person',$3,'Recorded Staff','active',$4) RETURNING id AS value",
        [institution, uid, uid + "@concurrency.fixture.invalid", owner],
      );
      await db.query(
        "INSERT INTO public.staff_role_grants(institution_id,staff_id,role,valid_from,created_by,reason) VALUES($1,$2,$3,public.setup_today($1)-1,$4,$5)",
        [institution, staff[uid], kind, owner, reason],
      );
    }
    await role(owner);
    const today = await v("SELECT public.setup_today($1)::text AS value", [institution]),
      tomorrow = await v("SELECT (public.setup_today($1)+1)::text AS value", [institution]);
    const entity = (kind, details) =>
      v("SELECT public.create_academic_entity($1,$2,$3) AS value", [institution, kind, details]);
    const dep = await entity("department", { name: "Concurrent Department", code: "RACE" }),
      program = await entity("program", {
        department_id: dep,
        name: "Concurrent Program",
        code: "RACE",
      }),
      term = await entity("term", {
        program_id: program,
        name: "Concurrent Term",
        academic_year: "Concurrency year",
        term_kind: "term",
        starts_on: today,
        ends_on: tomorrow,
      });
    const section = await entity("section", { term_id: term, name: "Concurrent Section" }),
      subject = await entity("subject", {
        program_id: program,
        name: "Concurrent Subject",
        code: "RACE",
      });
    for (const [uid, kind] of [
      [faculty, "teaching"],
      [ci, "class_incharge"],
    ])
      await db.query("SELECT public.add_staff_responsibility($1,$2)", [
        staff[uid],
        {
          kind,
          department_id: dep,
          program_id: program,
          term_id: term,
          section_id: section,
          subject_id: kind === "teaching" ? subject : null,
          academic_year: "Concurrency year",
          effective_from: today,
          effective_until: tomorrow,
          reason,
        },
      ]);
    const cohort = await v("SELECT public.create_student_cohort($1,$2,$3) AS value", [
      institution,
      {
        program_id: program,
        name: "Concurrent Cohort",
        code: "RACE",
        starts_on: today,
        expected_ends_on: tomorrow,
      },
      reason,
    ]);
    await role(owner, true);
    const student = await v(
      "INSERT INTO public.students(institution_id,name,admission_number,status) VALUES($1,'Concurrent Student','RACE-STUDENT',NULL) RETURNING id AS value",
      [institution],
    );
    await db.query(
      "INSERT INTO public.student_placements(institution_id,student_id,cohort_id,department_id,program_id,term_id,section_id,starts_on,ends_on,change_type,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'entry',$10,$11)",
      [institution, student, cohort, dep, program, term, section, today, tomorrow, reason, owner],
    );
    await role(owner);
    const rules = [];
    for (const [label, start, end] of [
      ["Race one", "08:00", "09:00"],
      ["Race two", "10:00", "11:00"],
    ])
      rules.push(
        await v("SELECT public.create_timetable_rule($1,$2,$3,$4,NULL) AS value", [
          institution,
          {
            owner_section_id: section,
            subject_id: subject,
            faculty_id: staff[faculty],
            label,
            kind: "normal",
            slots: [label],
            starts_at: start,
            ends_at: end,
            on_date: tomorrow,
            effective_from: tomorrow,
            effective_until: tomorrow,
          },
          [section],
          reason,
        ]),
      );
    await db.query("SELECT public.materialize_period_sessions($1,$2,$2,$3)", [
      institution,
      tomorrow,
      reason,
    ]);
    await role(owner, true);
    await db.query(
      "UPDATE public.period_sessions SET session_date=$2,starts_at=clock_timestamp()-interval '1 minute',ends_at=clock_timestamp()+interval '1 minute' WHERE institution_id=$1",
      [institution, today],
    );
    const sessions = (
      await db.query("SELECT id,rule_id FROM public.period_sessions WHERE institution_id=$1", [
        institution,
      ])
    ).rows;
    const first = sessions.find((s) => s.rule_id === rules[0]).id,
      second = sessions.find((s) => s.rule_id === rules[1]).id;
    const connect = async (uid) => {
      const client = new Client(config);
      connections.push(client);
      await client.connect();
      await client.query("SET ROLE authenticated");
      await client.query(
        "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",
        [uid],
      );
      return client;
    };
    const [one, two, ciConnection] = await Promise.all([
      connect(faculty),
      connect(faculty),
      connect(ci),
    ]);
    const firstDetail = (
      await one.query("SELECT public.period_session_detail($1) AS value", [first])
    ).rows[0].value;
    const marks = JSON.stringify([{ student_id: student, status: "present" }]);
    const submits = await Promise.allSettled([
      one.query("SELECT public.submit_period_session($1,$2,$3,'SUBMIT 1')", [
        first,
        firstDetail.session.revision,
        marks,
      ]),
      two.query("SELECT public.submit_period_session($1,$2,$3,'SUBMIT 1')", [
        first,
        firstDetail.session.revision,
        marks,
      ]),
    ]);
    assert.equal(
      submits.filter((x) => x.status === "fulfilled").length,
      1,
      "Exactly one concurrent Final Submit succeeds",
    );
    assert.equal(submits.find((x) => x.status === "rejected").reason.code, "42501");
    await role(owner, true);
    assert.equal(
      await v("SELECT count(*)::int AS value FROM public.period_marks WHERE session_id=$1", [
        first,
      ]),
      1,
    );
    assert.equal(
      await v(
        "SELECT count(*)::int AS value FROM public.period_attendance_events WHERE session_id=$1 AND action='session.submitted'",
        [first],
      ),
      1,
    );
    const secondDetail = (
      await one.query("SELECT public.period_session_detail($1) AS value", [second])
    ).rows[0].value;
    const race = await Promise.allSettled([
      ciConnection.query("SELECT public.assign_period_substitute($1,$2,$3,$4)", [
        second,
        staff[sub],
        secondDetail.session.revision,
        reason,
      ]),
      two.query("SELECT public.submit_period_session($1,$2,$3,'SUBMIT 1')", [
        second,
        secondDetail.session.revision,
        marks,
      ]),
    ]);
    assert.equal(
      race.filter((x) => x.status === "fulfilled").length,
      1,
      "Substitute assignment and original submission cannot both win the same revision",
    );
    assert.equal(race.find((x) => x.status === "rejected").reason.code, "42501");
    console.log(
      "  PASS Phase 4A concurrency: two real database connections produce one Final Submit; substitute/original authority race has one winner and no duplicate marks.",
    );
    await require("./verify-period-notification-concurrency.cjs")(db, config, {
      institution,
      owner,
      ci,
      student,
      session: first,
      day: today,
      role,
    });
  } finally {
    await Promise.allSettled(connections.map((c) => c.end()));
    await role(null, true);
  }
};
