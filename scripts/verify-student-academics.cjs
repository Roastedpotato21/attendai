const assert = require("node:assert/strict");
module.exports = async function verifyStudentAcademics(db, { owner, other, institution }) {
  await db.query("SAVEPOINT phase3a");
  let deniedCount = 0;
  async function role(user, name = "authenticated") {
    await db.query("RESET ROLE");
    await db.query("SET LOCAL ROLE " + name);
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [user ?? "", name],
    );
  }
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
  async function denied(
    sql,
    args = [],
    pattern = (e) => ["42501", "22023", "23505", "23514", "23503"].includes(e.code),
  ) {
    await db.query("SAVEPOINT student_denied");
    try {
      await assert.rejects(db.query(sql, args), pattern);
      deniedCount++;
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT student_denied");
      await db.query("RELEASE SAVEPOINT student_denied");
    }
  }
  const reason =
    "Reviewed student academic records against institution admission and placement records.";
  try {
    await role(null, "postgres");
    const untouched =
      "SELECT jsonb_build_object('guardians',(SELECT count(*) FROM public.parents),'guardian_links',(SELECT count(*) FROM public.student_parents),'attendance',(SELECT count(*) FROM public.attendance_records),'sessions',(SELECT count(*) FROM public.attendance_sessions),'communications',(SELECT count(*) FROM public.communications)) AS value";
    const baseline = await value(untouched);
    await role(owner);
    const day = await value("SELECT public.setup_today($1)::text AS value", [institution]);
    const date = (n) => value("SELECT ($1::date+$2::int)::text AS value", [day, n]);
    const entity = (kind, details) =>
      value("SELECT public.create_academic_entity($1,$2,$3) AS value", [
        institution,
        kind,
        details,
      ]);
    const dep = await entity("department", { name: "Liberal Studies", code: "LIB" }),
      dep2 = await entity("department", { name: "Applied Studies", code: "APL" });
    const program = await entity("program", {
        department_id: dep,
        name: "Institution Defined Course",
        code: "IDC",
      }),
      program2 = await entity("program", {
        department_id: dep2,
        name: "Applied Certificate",
        code: "APC",
      });
    const termDetails = {
      program_id: program,
      academic_year: "Current test year",
      term_kind: "year",
      year_number: 2,
      starts_on: await date(-100),
      ends_on: await date(100),
    };
    const t1 = await entity("term", { ...termDetails, name: "Year Two" }),
      entry = await entity("term", {
        ...termDetails,
        name: "Recorded Entry Year",
        academic_year: "Earlier test year",
        year_number: 1,
        starts_on: await date(-700),
        ends_on: await date(-101),
      });
    const t2 = await entity("term", {
        ...termDetails,
        name: "Year Three",
        academic_year: "Next test year",
        year_number: 3,
        starts_on: await date(101),
        ends_on: await date(500),
      }),
      repeat = await entity("term", {
        ...termDetails,
        name: "Repeat Year Two",
        academic_year: "Next test year",
        starts_on: await date(101),
        ends_on: await date(500),
      });
    const t3 = await entity("term", { ...termDetails, program_id: program2, name: "Applied Term" });
    const a = await entity("section", { term_id: t1, name: "North" }),
      b = await entity("section", { term_id: t1, name: "South" }),
      next = await entity("section", { term_id: t2, name: "Next" }),
      repeated = await entity("section", { term_id: repeat, name: "Repeat" }),
      cross = await entity("section", { term_id: t3, name: "Applied" });
    const cohort = await value("SELECT public.create_student_cohort($1,$2,$3) AS value", [
      institution,
      {
        program_id: program,
        name: "Recorded Admission Group",
        code: "REC",
        starts_on: await date(-730),
        expected_ends_on: await date(1000),
      },
      reason,
    ]);
    const cohort2 = await value("SELECT public.create_student_cohort($1,$2,$3) AS value", [
      institution,
      {
        program_id: program2,
        name: "Applied Admission Group",
        code: "APG",
        starts_on: await date(-730),
        expected_ends_on: await date(1000),
      },
      reason,
    ]);
    const row = (n, changes = {}) => ({
      full_name: "Academic Student " + n,
      admission_number: "ACAD-" + n,
      roll_number: "ROLL-" + n,
      admitted_on: awaitDatePast,
      department_code: "LIB",
      program_code: "IDC",
      cohort_code: "REC",
      academic_year: "Current test year",
      term_name: "Year Two",
      section_name: "North",
      entry_type: "normal",
      entry_academic_year: "Earlier test year",
      entry_term_name: "Recorded Entry Year",
      starts_on: placementStart,
      ...changes,
    });
    const awaitDatePast = await date(-700),
      placementStart = await date(-20);
    const stage = (rows) =>
      value("SELECT public.stage_student_import($1,'reviewed.csv',$2,$3,$4) AS value", [
        institution,
        "a".repeat(64),
        JSON.stringify(rows),
        reason,
      ]);
    const commit = (batch) =>
      value("SELECT public.commit_student_import($1,$2,$3,$4,$5) AS value", [
        batch.id,
        batch.revision,
        batch.preview.filter((r) => r.outcome === "valid").map((r) => r.row_number),
        "IMPORT " + batch.preview.filter((r) => r.outcome === "valid").length,
        reason,
      ]);
    let preview = await stage([
      row("001"),
      row("001"),
      row("BAD", { section_name: "Unknown" }),
      row("BADPROG", { program_code: "Unlisted" }),
      row("BADTERM", { term_name: "Unlisted" }),
      row("BADBATCH", { cohort_code: "Unlisted" }),
      row("BADYEAR", { entry_year: "4" }),
      row("EMPTY", { full_name: "" }),
    ]);
    assert.equal(preview.preview[0].outcome, "rejected");
    assert.ok(preview.preview.every((r) => r.errors.length));
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.students WHERE institution_id=$1 AND admission_number LIKE 'ACAD-%'",
        [institution],
      ),
      0,
      "Preview never inserts students",
    );
    await denied("SELECT public.commit_student_import($1,$2,ARRAY[1],'IMPORT 1',$3)", [
      preview.id,
      preview.revision,
      reason,
    ]);
    const rows = [
      row("001"),
      row("002", {
        entry_type: "lateral",
        entry_academic_year: "Current test year",
        entry_term_name: "Year Two",
        entry_year: "2",
        admitted_on: placementStart,
      }),
      row("003", {
        entry_type: "transfer",
        entry_academic_year: "Current test year",
        entry_term_name: "Year Two",
        admitted_on: placementStart,
      }),
      row("004"),
    ];
    preview = await stage(rows);
    assert.ok(preview.preview.every((r) => r.outcome === "valid"));
    assert.ok(preview.preview[1].warnings.length);
    await denied("SELECT public.commit_student_import($1,$2,ARRAY[1],'yes',$3)", [
      preview.id,
      preview.revision,
      reason,
    ]);
    const results = await commit(preview),
      ids = results.map((r) => r.student_id);
    assert.deepEqual(
      await value("SELECT result AS value FROM public.student_import_batches WHERE id=$1", [
        preview.id,
      ]),
      results,
      "Committed row results survive reload",
    );
    assert.equal(new Set(ids).size, 4);
    await denied("SELECT public.commit_student_import($1,$2,ARRAY[1],'IMPORT 1',$3)", [
      preview.id,
      preview.revision,
      reason,
    ]);
    for (let n = 0; n < 3; n++) {
      const profile = await value("SELECT public.student_academic_profile($1) AS value", [ids[n]]);
      assert.equal(profile.history.length, 1);
      assert.equal(profile.student.entry_type, rows[n].entry_type);
      assert.equal(profile.current.section_id, a);
      assert.ok(profile.entry_term.name);
    }
    await role(null, "postgres");
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.students WHERE id=ANY($1::uuid[]) AND parent_id IS NULL AND class_id IS NULL AND status IS NULL",
        [ids],
      ),
      4,
    );
    await denied(
      "INSERT INTO public.students(institution_id,name,admission_number) VALUES($1,'Duplicate',' ＡＣＡＤ-001 ')",
      [institution],
    );
    await denied(
      "INSERT INTO public.students(institution_id,name,admission_number,roll) VALUES($1,'Duplicate Roll','NEW-ADMISSION',' roll-001 ')",
      [institution],
    );
    await role(owner);
    const existing = await stage([row("001")]);
    assert.equal(existing.preview[0].existing_students[0].id, ids[0]);
    assert.equal(existing.preview[0].outcome, "rejected");
    let possible = await stage([row("POSSIBLE", { full_name: rows[0].full_name })]);
    assert.equal(possible.preview[0].potential_duplicates.length, 1);
    assert.equal(possible.preview[0].outcome, "rejected");
    possible = await value("SELECT public.revise_student_import($1,$2,$3,$4) AS value", [
      possible.id,
      possible.revision,
      JSON.stringify([
        row("POSSIBLE", { full_name: rows[0].full_name, duplicate_acknowledged: true }),
      ]),
      reason,
    ]);
    assert.equal(possible.preview[0].outcome, "valid");
    await denied("SELECT public.revise_student_import($1,1,$2,$3)", [
      possible.id,
      JSON.stringify([row("POSSIBLE")]),
      reason,
    ]);
    // Existing real IDs with incomplete academic metadata are explicitly enrolled.
    await role(null, "postgres");
    const legacy = await value(
      "INSERT INTO public.students(institution_id,name,admission_number,roll) VALUES($1,'Recorded Legacy Student','LEGACY-ACADEMIC','LEGACY-ROLL') RETURNING id AS value",
      [institution],
    );
    await role(owner);
    const legacyBatch = await stage([
      row("LEGACY", {
        full_name: "Recorded Legacy Student",
        admission_number: "LEGACY-ACADEMIC",
        roll_number: "LEGACY-ROLL",
        action: "enroll_existing",
        existing_student_id: legacy,
      }),
    ]);
    assert.equal(legacyBatch.preview[0].outcome, "valid");
    assert.equal((await commit(legacyBatch))[0].student_id, legacy);
    // Promotion preserves identity and actual entry metadata; exceptions are explicit.
    const promotionRows = [
      {
        student_id: ids[0],
        action: "promote",
        section_id: next,
        cohort_id: cohort,
        starts_on: await date(101),
      },
      {
        student_id: ids[1],
        action: "repeat",
        section_id: repeated,
        cohort_id: cohort,
        starts_on: await date(101),
      },
      { student_id: ids[2], action: "exclude" },
      { student_id: ids[3], action: "break" },
    ];
    let promotion = await value("SELECT public.stage_student_promotion($1,$2,$3) AS value", [
      institution,
      JSON.stringify(promotionRows),
      reason,
    ]);
    assert.equal(promotion.preview[2].outcome, "skipped");
    assert.equal(promotion.preview.filter((r) => r.outcome === "valid").length, 3);
    assert.equal(
      (await value("SELECT public.student_academic_profile($1) AS value", [ids[0]])).history.length,
      1,
      "Promotion preview does not change placement",
    );
    await denied("SELECT public.commit_student_promotion($1,$2,'PROMOTE 4',$3)", [
      promotion.id,
      promotion.revision,
      reason,
    ]);
    assert.equal(
      await value("SELECT public.commit_student_promotion($1,$2,'PROMOTE 3',$3) AS value", [
        promotion.id,
        promotion.revision,
        reason,
      ]),
      3,
    );
    const promoted = await value("SELECT public.student_academic_profile($1) AS value", [ids[0]]);
    assert.equal(promoted.history.length, 2);
    assert.equal(
      promoted.current.section_id,
      a,
      "Future promotion does not prematurely change today's placement",
    );
    const lateral = await value("SELECT public.student_academic_profile($1) AS value", [ids[1]]);
    assert.equal(lateral.student.entry_type, "lateral");
    assert.equal(lateral.history[1].change_type, "repeat");
    assert.equal(
      (await value("SELECT public.student_academic_profile($1) AS value", [ids[2]])).history.length,
      1,
    );
    assert.equal(
      (await value("SELECT public.student_academic_profile($1) AS value", [ids[3]])).student
        .enrollment_status,
      "inactive",
    );
    // Section/program/department transitions retain the canonical identity.
    let profile = await value("SELECT public.student_academic_profile($1) AS value", [ids[2]]);
    await db.query("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      ids[2],
      {
        section_id: b,
        cohort_id: cohort,
        starts_on: await date(-10),
        change_type: "section_transfer",
      },
      profile.student.academic_version,
      reason,
    ]);
    profile = await value("SELECT public.student_academic_profile($1) AS value", [ids[2]]);
    assert.equal(profile.history.length, 2);
    assert.equal(profile.current.section_id, b);
    const alternateProgram = await entity("program", {
      department_id: dep,
      name: "Alternate Course",
      code: "ALT",
    });
    const alternateTerm = await entity("term", {
      ...termDetails,
      program_id: alternateProgram,
      name: "Alternate Term",
    });
    const alternateSection = await entity("section", { term_id: alternateTerm, name: "Alternate" });
    const alternateCohort = await value("SELECT public.create_student_cohort($1,$2,$3) AS value", [
      institution,
      {
        program_id: alternateProgram,
        name: "Alternate Admission Group",
        code: "ALT",
        starts_on: await date(-730),
        expected_ends_on: await date(1000),
      },
      reason,
    ]);
    await db.query("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      ids[2],
      {
        section_id: alternateSection,
        cohort_id: alternateCohort,
        starts_on: await date(-5),
        change_type: "section_transfer",
      },
      profile.student.academic_version,
      reason,
    ]);
    profile = await value("SELECT public.student_academic_profile($1) AS value", [ids[2]]);
    assert.equal(profile.history.length, 3);
    assert.equal(profile.current.program_id, alternateProgram);
    assert.equal(
      profile.current.change_type,
      "program_transfer",
      "Scope change determines audit type",
    );
    await db.query("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      ids[2],
      { section_id: cross, cohort_id: cohort2, starts_on: day, change_type: "department_transfer" },
      profile.student.academic_version,
      reason,
    ]);
    profile = await value("SELECT public.student_academic_profile($1) AS value", [ids[2]]);
    assert.equal(profile.history.length, 4);
    assert.equal(profile.current.program_id, program2);
    assert.equal(profile.student.entry_cohort_id, cohort);
    await denied("UPDATE public.students SET admission_number='BYPASS' WHERE id=$1", [ids[2]]);
    await denied("SELECT public.apply_student_placement($1,$2,$3,$4,NULL)", [
      ids[2],
      {},
      profile.student.academic_version,
      reason,
    ]);
    await role(null, "postgres");
    await denied(
      "INSERT INTO public.student_placements(institution_id,student_id,cohort_id,department_id,program_id,term_id,section_id,starts_on,ends_on,change_type,reason,created_by) SELECT institution_id,student_id,cohort_id,department_id,program_id,term_id,section_id,starts_on,ends_on,change_type,reason,created_by FROM public.student_placements WHERE student_id=$1 AND closed_at IS NULL",
      [ids[2]],
    );
    await role(owner);
    await denied("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      ids[2],
      {
        section_id: a,
        cohort_id: cohort2,
        starts_on: await date(1),
        change_type: "program_transfer",
      },
      profile.student.academic_version,
      reason,
    ]);
    // Stale previews fail atomically after an independent profile correction.
    promotion = await value("SELECT public.stage_student_promotion($1,$2,$3) AS value", [
      institution,
      JSON.stringify([
        {
          student_id: legacy,
          action: "promote",
          section_id: next,
          cohort_id: cohort,
          starts_on: await date(101),
        },
      ]),
      reason,
    ]);
    const legacyProfile = await value("SELECT public.student_academic_profile($1) AS value", [
      legacy,
    ]);
    await db.query("SELECT public.update_student_academic_profile($1,$2,$3,$4)", [
      legacy,
      {
        full_name: "Recorded Legacy Student Corrected",
        admission_number: "LEGACY-ACADEMIC",
        roll_number: "LEGACY-ROLL",
      },
      legacyProfile.student.academic_version,
      reason,
    ]);
    await denied("SELECT public.commit_student_promotion($1,$2,'PROMOTE 1',$3)", [
      promotion.id,
      promotion.revision,
      reason,
    ]);
    // Future scheduled placement must also be cancelled when graduating today.
    let graduate = await value("SELECT public.student_academic_profile($1) AS value", [ids[0]]);
    await db.query("SELECT public.change_student_academic_status($1,'graduated',$2,$3)", [
      ids[0],
      graduate.student.academic_version,
      reason,
    ]);
    graduate = await value("SELECT public.student_academic_profile($1) AS value", [ids[0]]);
    assert.equal(graduate.student.enrollment_status, "graduated");
    assert.equal(graduate.current, null);
    assert.equal(graduate.history.length, 2);
    const cancelledHistory = graduate.history;
    await db.query("SELECT public.change_student_academic_status($1,'transferred_out',$2,$3)", [
      ids[0],
      graduate.student.academic_version,
      reason,
    ]);
    graduate = await value("SELECT public.student_academic_profile($1) AS value", [ids[0]]);
    assert.equal(graduate.student.enrollment_status, "transferred_out");
    assert.deepEqual(
      graduate.history,
      cancelledHistory,
      "Further status changes retain cancelled future placement tombstones",
    );
    // Scope and tenant checks use the current Phase 2 role/responsibility helpers.
    const facultyUser = "94000000-0000-4000-8000-000000000001";
    await role(null, "postgres");
    await db.query(
      "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'academic-faculty@fixture.invalid',now())",
      [facultyUser],
    );
    await db.query(
      "INSERT INTO public.user_policy_acceptances(user_id,policy_version_id,acceptance_method) SELECT $1,id,'access_gate' FROM public.policy_versions WHERE active",
      [facultyUser],
    );
    await role(owner);
    const staff = await value(
      "SELECT public.create_staff_record($1,$2,ARRAY['faculty']) AS value",
      [
        institution,
        {
          full_name: "Unrelated Academic Faculty",
          email: "academic-faculty@fixture.invalid",
          staff_code: "ACADEMIC-FACULTY",
          designation: "Lecturer",
          primary_department_id: dep,
        },
      ],
    );
    const { createHash } = require("node:crypto"),
      token = "f".repeat(64);
    await db.query("SELECT public.prepare_staff_invitation($1,$2,$3)", [
      staff,
      facultyUser,
      createHash("sha256").update(token).digest("hex"),
    ]);
    await role(facultyUser);
    await db.query("SELECT public.accept_staff_setup_invitation($1)", [token]);
    assert.equal(
      (await value("SELECT public.student_academic_directory($1) AS value", [institution])).length,
      0,
    );
    await denied("SELECT public.stage_student_import($1,'forged.csv',$2,$3,$4)", [
      institution,
      "b".repeat(64),
      JSON.stringify([row("FORGED")]),
      reason,
    ]);
    await denied("SELECT public.student_academic_profile($1)", [ids[2]]);
    await denied("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      ids[2],
      {
        section_id: a,
        cohort_id: cohort,
        starts_on: await date(1),
        change_type: "section_transfer",
      },
      profile.student.academic_version,
      reason,
    ]);
    await denied("SELECT public.stage_student_promotion($1,$2,$3)", [
      institution,
      JSON.stringify([{ student_id: legacy, action: "break" }]),
      reason,
    ]);
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.student_academic_audit WHERE institution_id=$1",
        [institution],
      ),
      0,
    );
    await denied(
      "INSERT INTO public.students(institution_id,name,admission_number) VALUES($1,'Unreviewed Student','UNREVIEWED')",
      [institution],
    );
    // Class Incharge can manage only both sides of an assigned section move.
    await role(owner);
    await db.query("SELECT public.set_staff_roles($1,ARRAY['faculty','class_incharge'],$2)", [
      staff,
      reason,
    ]);
    await db.query("SELECT public.add_staff_responsibility($1,$2)", [
      staff,
      {
        kind: "class_incharge",
        department_id: dep,
        program_id: program,
        term_id: t1,
        section_id: a,
        academic_year: "Current test year",
        effective_from: await date(-100),
        effective_until: await date(100),
        reason,
      },
    ]);
    await role(facultyUser);
    let scoped = await value("SELECT public.student_academic_profile($1) AS value", [legacy]);
    assert.equal(scoped.can_move, true);
    assert.equal(scoped.can_edit, false);
    await denied("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      legacy,
      { section_id: b, cohort_id: cohort, starts_on: day, change_type: "section_transfer" },
      scoped.student.academic_version,
      reason,
    ]);
    await denied("SELECT public.update_student_academic_profile($1,$2,$3,$4)", [
      legacy,
      { full_name: "Forged identity", admission_number: "LEGACY-ACADEMIC" },
      scoped.student.academic_version,
      reason,
    ]);
    await role(owner);
    await db.query("SELECT public.add_staff_responsibility($1,$2)", [
      staff,
      {
        kind: "class_incharge",
        department_id: dep,
        program_id: program,
        term_id: t1,
        section_id: b,
        academic_year: "Current test year",
        effective_from: await date(-100),
        effective_until: await date(100),
        reason,
      },
    ]);
    await role(facultyUser);
    await db.query("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      legacy,
      { section_id: b, cohort_id: cohort, starts_on: day, change_type: "section_transfer" },
      scoped.student.academic_version,
      reason,
    ]);
    scoped = await value("SELECT public.student_academic_profile($1) AS value", [legacy]);
    assert.equal(scoped.current.section_id, b);
    await denied("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      legacy,
      {
        section_id: cross,
        cohort_id: cohort2,
        starts_on: await date(1),
        change_type: "department_transfer",
      },
      scoped.student.academic_version,
      reason,
    ]);
    // HOD scope follows the real department; a scheduled future placement must
    // also be within scope before a status change can cancel it.
    await role(owner);
    await db.query("SELECT public.set_staff_roles($1,ARRAY['hod'],$2)", [staff, reason]);
    await db.query("SELECT public.add_staff_responsibility($1,$2)", [
      staff,
      {
        kind: "hod",
        department_id: dep,
        effective_from: await date(-100),
        effective_until: await date(500),
        reason,
      },
    ]);
    await role(facultyUser);
    await db.query("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      legacy,
      {
        section_id: a,
        cohort_id: cohort,
        starts_on: await date(1),
        change_type: "section_transfer",
      },
      scoped.student.academic_version,
      reason,
    ]);
    scoped = await value("SELECT public.student_academic_profile($1) AS value", [legacy]);
    await db.query("SELECT public.change_student_academic_status($1,'suspended',$2,$3)", [
      legacy,
      scoped.student.academic_version,
      reason,
    ]);
    await denied("SELECT public.student_academic_profile($1)", [legacy]);
    await role(owner);
    scoped = await value("SELECT public.student_academic_profile($1) AS value", [legacy]);
    assert.equal(scoped.current, null);
    assert.equal(scoped.student.enrollment_status, "suspended");
    await db.query("SELECT public.set_staff_roles($1,ARRAY['coordinator'],$2)", [staff, reason]);
    await db.query("SELECT public.add_staff_responsibility($1,$2)", [
      staff,
      {
        kind: "coordinator",
        department_id: dep,
        program_id: program,
        academic_year: "Current test year",
        effective_from: await date(-100),
        effective_until: await date(500),
        reason,
      },
    ]);
    await role(facultyUser);
    const coordinatorCatalog = await value("SELECT public.student_academic_catalog($1) AS value", [
      institution,
    ]);
    assert.ok(coordinatorCatalog.sections.some((s) => s.id === a));
    assert.equal(
      coordinatorCatalog.sections.some((s) => s.id === next),
      false,
      "Year-restricted coordinator cannot acquire next-year sections",
    );
    const lateralCurrent = await value("SELECT public.student_academic_profile($1) AS value", [
      ids[1],
    ]);
    await denied("SELECT public.change_student_academic_status($1,'inactive',$2,$3)", [
      ids[1],
      lateralCurrent.student.academic_version,
      reason,
    ]);
    await role(owner);
    await db.query("SELECT public.add_staff_responsibility($1,$2)", [
      staff,
      {
        kind: "coordinator",
        department_id: dep,
        program_id: program,
        academic_year: "",
        effective_from: await date(-100),
        effective_until: await date(500),
        reason,
      },
    ]);
    await role(facultyUser);
    assert.ok(
      (
        await value("SELECT public.student_academic_catalog($1) AS value", [institution])
      ).sections.some((s) => s.id === next),
      "Current program-wide authority can plan upcoming terms",
    );
    const planned = await value("SELECT public.stage_student_promotion($1,$2,$3) AS value", [
      institution,
      JSON.stringify([
        {
          student_id: ids[1],
          action: "promote",
          section_id: next,
          cohort_id: cohort,
          starts_on: await date(102),
        },
      ]),
      reason,
    ]);
    assert.equal(planned.preview[0].outcome, "valid");
    // A pre-existing attendance roster keeps its real class projection in sync.
    // Future scheduling is explicit failure until that effective date arrives.
    await role(null, "postgres");
    const rosterStudent = await value(
      "INSERT INTO public.students(institution_id,name,admission_number,roll,class_id,legacy_roster_linked) SELECT $1,'Recorded Roster Student','ROSTER-ACADEMIC','ROSTER-ROLL',class_id,true FROM public.academic_sections WHERE id=$2 RETURNING id AS value",
      [institution, a],
    );
    await role(owner);
    const rosterBatch = await stage([
      row("ROSTER", {
        full_name: "Recorded Roster Student",
        admission_number: "ROSTER-ACADEMIC",
        roll_number: "ROSTER-ROLL",
        action: "enroll_existing",
        existing_student_id: rosterStudent,
      }),
    ]);
    assert.equal(rosterBatch.preview[0].outcome, "valid");
    assert.equal((await commit(rosterBatch))[0].student_id, rosterStudent);
    let roster = await value("SELECT public.student_academic_profile($1) AS value", [
      rosterStudent,
    ]);
    await denied("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      rosterStudent,
      { section_id: next, cohort_id: cohort, starts_on: await date(101), change_type: "promotion" },
      roster.student.academic_version,
      reason,
    ]);
    const rosterPromotion = await value(
      "SELECT public.stage_student_promotion($1,$2,$3) AS value",
      [
        institution,
        JSON.stringify([
          {
            student_id: rosterStudent,
            action: "promote",
            section_id: next,
            cohort_id: cohort,
            starts_on: await date(101),
          },
        ]),
        reason,
      ],
    );
    assert.equal(rosterPromotion.preview[0].outcome, "rejected");
    await db.query("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      rosterStudent,
      { section_id: b, cohort_id: cohort, starts_on: day, change_type: "section_transfer" },
      roster.student.academic_version,
      reason,
    ]);
    assert.equal(
      await value(
        "SELECT s.class_id=a.class_id AS value FROM public.students s JOIN public.academic_sections a ON a.id=$2 WHERE s.id=$1",
        [rosterStudent, b],
      ),
      true,
    );
    roster = await value("SELECT public.student_academic_profile($1) AS value", [rosterStudent]);
    assert.equal(roster.current.section_id, b);
    await db.query("SELECT public.change_student_academic_status($1,'inactive',$2,$3)", [
      rosterStudent,
      roster.student.academic_version,
      reason,
    ]);
    roster = await value("SELECT public.student_academic_profile($1) AS value", [rosterStudent]);
    await db.query("SELECT public.change_student_academic_status($1,'active',$2,$3)", [
      rosterStudent,
      roster.student.academic_version,
      reason,
    ]);
    assert.equal(
      await value("SELECT class_id AS value FROM public.students WHERE id=$1", [rosterStudent]),
      null,
      "Reactivation must not revive the previous roster",
    );
    roster = await value("SELECT public.student_academic_profile($1) AS value", [rosterStudent]);
    assert.equal(roster.current, null);
    await db.query("SELECT public.student_placement_transition($1,$2,$3,$4)", [
      rosterStudent,
      { section_id: a, cohort_id: cohort, starts_on: day, change_type: "return_from_break" },
      roster.student.academic_version,
      reason,
    ]);
    assert.equal(
      await value(
        "SELECT s.class_id=a.class_id AS value FROM public.students s JOIN public.academic_sections a ON a.id=$2 WHERE s.id=$1",
        [rosterStudent, a],
      ),
      true,
    );
    await role(other);
    await denied("SELECT public.student_academic_catalog($1)", [institution]);
    await denied("SELECT public.student_academic_profile($1)", [ids[2]]);
    // Trusted fixture insertion demonstrates identical identifiers across tenants.
    await role(null, "postgres");
    const otherTenant = "94000000-0000-4000-8000-000000000010";
    await db.query(
      "INSERT INTO public.institutions(id,name,code) VALUES($1,'Other Academic Institution','academic-other')",
      [otherTenant],
    );
    await db.query(
      "INSERT INTO public.students(institution_id,name,admission_number,roll) VALUES($1,'Other Student','ACAD-001','ROLL-001')",
      [otherTenant],
    );
    await denied("UPDATE public.student_placements SET institution_id=$1 WHERE student_id=$2", [
      otherTenant,
      ids[2],
    ]);
    assert.deepEqual(
      await value(untouched),
      baseline,
      "Academic workflows create no guardians, mappings, attendance or communication records",
    );
    await role(owner);
    const audit = (
      await db.query("SELECT * FROM public.student_academic_audit WHERE institution_id=$1", [
        institution,
      ])
    ).rows;
    for (const action of [
      "import.previewed",
      "import.rows_corrected",
      "student.imported",
      "import.committed",
      "promotion.previewed",
      "promotion.committed",
      "section_transfer",
      "department_transfer",
      "program_transfer",
      "status.changed",
      "profile.corrected",
    ])
      assert.ok(
        audit.some((a) => a.action === action),
        action,
      );
    assert.ok(audit.every((a) => a.actor_profile_id && a.reason && a.created_at));
    console.log(
      `  PASS Phase 3A: canonical IDs, preview/correction, duplicate and existing resolution, normal/lateral/transfer entry, cohorts, promotion/exceptions, moves, history/status, audit and tenant/scoped security (${deniedCount} denied paths).`,
    );
    await require("./verify-guardian-mapping.cjs")(db, {
      owner,
      other,
      institution,
      students: [rosterStudent, ids[1], ids[2]],
      staff,
      facultyUser,
      dep,
      program,
      t1,
      section: a,
      day,
      studentRow: row,
    });
    await require("./verify-period-attendance.cjs")(db, {
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
      students: [rosterStudent, ids[1]],
      day,
    });
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT phase3a");
    await db.query("RELEASE SAVEPOINT phase3a");
    await role(null, "postgres");
  }
};
