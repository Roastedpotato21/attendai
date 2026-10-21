const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
module.exports = async function verifyStaffSetup(db, { owner, other, institution }) {
  await db.query("SAVEPOINT phase2a_staff");
  const people = [
    "91000000-0000-4000-8000-000000000001",
    "91000000-0000-4000-8000-000000000002",
    "91000000-0000-4000-8000-000000000003",
  ];
  const emails = [
    "multi@staff-fixture.invalid",
    "hod@staff-fixture.invalid",
    "faculty@staff-fixture.invalid",
  ];
  let deniedCount = 0;
  async function role(user, name = "authenticated") {
    await db.query("RESET ROLE");
    await db.query("SET LOCAL ROLE " + name);
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [user ?? "", name],
    );
  }
  async function value(sql, args = []) {
    return (await db.query(sql, args)).rows[0]?.value;
  }
  async function denied(
    sql,
    args = [],
    pattern = /required|invalid|unavailable|mismatch|violates|already|cannot|denied|duplicate|token|identity/i,
  ) {
    await db.query("SAVEPOINT deny_staff");
    try {
      await assert.rejects(db.query(sql, args), pattern);
      deniedCount++;
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT deny_staff");
      await db.query("RELEASE SAVEPOINT deny_staff");
    }
  }
  async function entity(kind, details) {
    return value("SELECT public.create_academic_entity($1,$2,$3) AS value", [
      institution,
      kind,
      details,
    ]);
  }
  const token = (char) => char.repeat(64);
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  async function invite(staff, index, char) {
    await role(owner);
    await db.query("SELECT public.prepare_staff_invitation($1,$2,$3)", [
      staff,
      people[index],
      hash(token(char)),
    ]);
  }
  async function accept(index, char) {
    await role(people[index]);
    return value("SELECT public.accept_staff_setup_invitation($1) AS value", [token(char)]);
  }
  try {
    await role(null, "postgres");
    for (let i = 0; i < people.length; i++)
      await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())", [
        people[i],
        emails[i],
      ]);
    await db.query(
      "INSERT INTO public.user_policy_acceptances(user_id,policy_version_id,acceptance_method) SELECT u.id,v.id,'access_gate' FROM auth.users u CROSS JOIN public.policy_versions v WHERE u.id=ANY($1::uuid[]) AND v.active",
      [people],
    );
    await role(owner);
    assert.equal(await value("SELECT public.setup_is_admin($1) AS value", [institution]), true);
    const ownerRecord = await value(
      "SELECT id AS value FROM public.staff_records WHERE institution_id=$1 AND profile_id=public.current_profile_id()",
      [institution],
    );
    assert.ok(ownerRecord);
    assert.ok(
      (await value("SELECT public.my_staff_portal_access() AS value")).user.setupRoles.includes(
        "institution_owner",
      ),
    );
    const existing = await value("SELECT public.institution_setup_profile($1) AS value", [
      institution,
    ]);
    const profile = {
      ...existing,
      official_address: "Official fixture address 123",
      city: "Fixture City",
      academic_year: "2026-27",
      timezone: "Asia/Kolkata",
      official_email: "office@staff-fixture.invalid",
      official_phone: "+919000000002",
      website: "https://staff-fixture.invalid",
      brand_name: "Fixture Institution",
      brand_color: "#123456",
    };
    await db.query("SELECT public.save_institution_setup_profile($1,$2)", [institution, profile]);
    await denied(
      "SELECT public.save_institution_setup_profile($1,$2)",
      [institution, { ...profile, name: "Arbitrary renamed institution" }],
      /identity/,
    );
    await denied("SELECT public.save_institution_setup_profile($1,$2)", [
      institution,
      { ...profile, timezone: "Invalid/Zone" },
    ]);
    await denied(
      "SELECT public.set_institution_setup_logo($1,$2,'image/png')",
      [institution, Buffer.from("<svg onload=alert(1)>").toString("base64")],
      /signature/,
    );
    await db.query("SELECT public.set_institution_setup_logo($1,$2,'image/png')", [
      institution,
      Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64"),
    ]);
    assert.ok(
      (
        await value("SELECT public.institution_setup_profile($1) AS value", [institution])
      ).logo_data_url.startsWith("data:image/png;base64,"),
    );
    const d1 = await entity("department", { name: "Performing Arts", code: "ART" });
    const d2 = await entity("department", { name: "Environmental Studies", code: "ENV" });
    const p1 = await entity("program", {
      name: "Bachelor of Music",
      code: "MUS",
      department_id: d1,
    });
    const p2 = await entity("program", {
      name: "Environmental Certificate",
      code: "EC",
      department_id: d2,
    });
    const dates = {
      starts_on: "2020-01-01",
      ends_on: "2090-12-31",
      academic_year: "2026-27",
      term_kind: "term",
      year_number: "1",
    };
    const t1 = await entity("term", { ...dates, name: "Studio Term", program_id: p1 });
    const t2 = await entity("term", {
      ...dates,
      name: "Field Year",
      program_id: p2,
      term_kind: "year",
    });
    const s1 = await entity("section", { name: "North", term_id: t1 });
    const s2 = await entity("section", { name: "South", term_id: t1 });
    const s3 = await entity("section", { name: "Field", term_id: t2 });
    const u1 = await entity("subject", { name: "Composition", code: "COMP", program_id: p1 });
    const u2 = await entity("subject", { name: "Field Ecology", code: "ECO", program_id: p2 });
    const responsibility = (kind, changes = {}) => ({
      kind,
      department_id: d1,
      program_id: "",
      term_id: "",
      section_id: "",
      subject_id: "",
      academic_year: "2026-27",
      effective_from: "2020-01-01",
      effective_until: "2090-12-31",
      reason: "Reviewed academic responsibility assigned by the institution owner.",
      ...changes,
    });
    const teaching = responsibility("teaching", {
      program_id: p1,
      term_id: t1,
      section_id: s1,
      subject_id: u1,
    });
    const create = async (index, roles, assignment = []) =>
      value("SELECT public.create_staff_record($1,$2,$3,$4) AS value", [
        institution,
        {
          full_name: "Fixture Staff " + index,
          email: emails[index],
          phone: "+919000000003",
          staff_code: "STAFF-" + index,
          primary_department_id: d1,
          designation: index === 2 ? "HOD" : "Professor",
        },
        roles,
        JSON.stringify(assignment),
      ]);
    const multi = await create(
      0,
      ["hod", "faculty", "class_incharge", "coordinator"],
      [
        teaching,
        responsibility("hod"),
        responsibility("class_incharge", { program_id: p1, term_id: t1, section_id: s1 }),
        responsibility("coordinator", { program_id: p1, term_id: t1 }),
      ],
    );
    const hod = await create(1, ["hod"], [responsibility("hod")]);
    const faculty = await create(2, ["faculty"]);
    await denied(
      "SELECT public.create_staff_record($1,$2,ARRAY['staff'])",
      [
        institution,
        {
          full_name: "Duplicate email",
          email: emails[0],
          phone: "",
          staff_code: "NEW-ID",
          primary_department_id: d1,
          designation: "Lecturer",
        },
      ],
      /unique|duplicate/,
    );
    await denied(
      "SELECT public.create_staff_record($1,$2,ARRAY['staff'])",
      [
        institution,
        {
          full_name: "Duplicate staff ID",
          email: "another@staff-fixture.invalid",
          phone: "",
          staff_code: "staff-0",
          primary_department_id: d1,
          designation: "Lecturer",
        },
      ],
      /unique|duplicate/,
    );
    await denied(
      "SELECT public.set_staff_roles($1,ARRAY['institution_owner'],'A forged ownership role must be rejected.')",
      [multi],
    );
    await denied(
      "SELECT public.add_staff_responsibility($1,$2)",
      [multi, { ...teaching, department_id: d2 }],
      /mismatch/,
    );
    await denied(
      "SELECT public.add_staff_responsibility($1,$2)",
      [multi, { ...teaching, subject_id: u2 }],
      /mismatch/,
    );
    await denied(
      "SELECT public.add_staff_responsibility($1,$2)",
      [multi, { ...teaching, effective_until: "2091-01-01" }],
      /mismatch/,
    );
    await invite(multi, 0, "a");
    await role(people[0]);
    assert.equal(
      await value("SELECT public.is_institution_member($1) AS value", [institution]),
      false,
    );
    await denied("SELECT public.activate_my_staff_invitation()");
    await denied("SELECT public.accept_staff_setup_invitation($1)", [token("b")]);
    await role(people[1]);
    await denied("SELECT public.accept_staff_setup_invitation($1)", [token("a")]);
    await role(null, "postgres");
    await db.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1", [people[0]]);
    await role(people[0]);
    await denied("SELECT public.accept_staff_setup_invitation($1)", [token("a")]);
    await role(null, "postgres");
    await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1", [people[0]]);
    assert.equal(await accept(0, "a"), institution);
    await denied("SELECT public.accept_staff_setup_invitation($1)", [token("a")]);
    assert.equal(await value("SELECT public.setup_is_admin($1) AS value", [institution]), false);
    const portal = await value("SELECT public.my_staff_portal_access($1) AS value", [institution]);
    assert.equal(portal.user.setupRoles.length, 4);
    assert.equal(portal.user.role, "faculty");
    assert.equal(
      await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [s1, u1, t1]),
      true,
    );
    assert.equal(
      await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [s2, u1, t1]),
      false,
    );
    assert.equal(await value("SELECT public.can_manage_assigned_section($1) AS value", [s1]), true);
    assert.equal(
      await value("SELECT public.can_manage_assigned_section($1) AS value", [s2]),
      false,
    );
    assert.equal(await value("SELECT public.can_oversee_department($1) AS value", [d1]), true);
    assert.equal(await value("SELECT public.can_oversee_department($1) AS value", [d2]), false);
    assert.equal(
      await value("SELECT public.can_coordinate_program($1,$2) AS value", [p1, t1]),
      true,
    );
    assert.equal(
      await value("SELECT public.can_coordinate_program($1,$2) AS value", [p2, t2]),
      false,
    );
    const classId = await value(
      "SELECT class_id AS value FROM public.academic_sections WHERE id=$1",
      [s1],
    );
    assert.equal(await value("SELECT public.can_manage_class($1) AS value", [classId]), false);
    await denied("SELECT public.submit_attendance($1,CURRENT_DATE,'manual','[]'::jsonb)", [
      classId,
    ]);
    await denied("SELECT public.create_academic_entity($1,'department',$2)", [
      institution,
      { name: "Forged", code: "NO" },
    ]);
    await denied(
      "SELECT public.set_staff_roles($1,ARRAY['institution_admin'],'Forged client escalation should be denied.')",
      [multi],
    );
    await denied("SELECT public.staff_invitation_context($1)", [faculty]);
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.staff_records WHERE institution_id=$1",
        [institution],
      ),
      1,
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.staff_setup_audit WHERE institution_id=$1",
        [institution],
      ),
      0,
    );
    await db.query(
      "UPDATE public.staff_records SET designation='Institution Owner',status='active' WHERE id=$1",
      [faculty],
    );
    assert.equal(
      await value("SELECT count(*)::int AS value FROM public.staff_records WHERE id=$1", [faculty]),
      0,
    );
    await invite(hod, 1, "b");
    await accept(1, "b");
    assert.equal(await value("SELECT public.can_oversee_department($1) AS value", [d1]), true);
    assert.equal(
      await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [s1, u1, t1]),
      false,
    );
    assert.equal(
      await value("SELECT public.can_manage_assigned_section($1) AS value", [s1]),
      false,
    );
    await invite(faculty, 2, "c");
    await role(null, "postgres");
    await db.query(
      "UPDATE public.staff_invitations SET expires_at=now()-interval '1 second' WHERE staff_id=$1",
      [faculty],
    );
    await role(people[2]);
    await denied("SELECT public.accept_staff_setup_invitation($1)", [token("c")]);
    await invite(faculty, 2, "d");
    await role(people[2]);
    await denied("SELECT public.accept_staff_setup_invitation($1)", [token("c")]);
    await accept(2, "d");
    assert.equal(
      await value("SELECT public.setup_is_admin($1) AS value", [institution]),
      false,
      "HOD designation does not grant HOD or admin role",
    );
    assert.equal(await value("SELECT public.can_oversee_department($1) AS value", [d1]), false);
    await role(owner);
    const crossId = await value("SELECT public.add_staff_responsibility($1,$2) AS value", [
      multi,
      responsibility("teaching", {
        department_id: d2,
        program_id: p2,
        term_id: t2,
        section_id: s3,
        subject_id: u2,
      }),
    ]);
    await role(people[0]);
    assert.equal(
      await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [s3, u2, t2]),
      true,
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.staff_records WHERE profile_id=public.current_profile_id()",
      ),
      1,
    );
    const workspace = await value("SELECT public.my_staff_workspace($1) AS value", [institution]);
    assert.equal(workspace.assignments.length, 5);
    assert.ok(workspace.assignments.some((a) => a.subject_name === "Field Ecology"));
    await role(owner);
    await db.query(
      "SELECT public.close_staff_responsibility($1,'Teaching assignment concluded; retain the prior term history.')",
      [crossId],
    );
    await db.query(
      "SELECT public.set_staff_roles($1,ARRAY['hod','class_incharge','coordinator'],'Faculty role concluded while other academic roles remain.')",
      [multi],
    );
    await role(people[0]);
    assert.equal(
      await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [s1, u1, t1]),
      false,
    );
    assert.equal(await value("SELECT public.can_manage_assigned_section($1) AS value", [s1]), true);
    assert.equal(
      await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [s3, u2, t2]),
      false,
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.staff_role_grants WHERE staff_id=$1 AND role='faculty' AND NOT active AND closed_at IS NOT NULL",
        [multi],
      ),
      1,
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.staff_responsibilities WHERE id=$1 AND NOT active AND effective_from='2020-01-01'",
        [crossId],
      ),
      1,
    );
    await role(null, "postgres");
    const otherInstitution = "92000000-0000-4000-8000-000000000001";
    await db.query(
      "INSERT INTO public.institutions(id,name,code) VALUES($1,'Other isolated institution','other-phase2-fixture')",
      [otherInstitution],
    );
    const otherProfile = await value(
      "SELECT id AS value FROM public.profiles WHERE auth_user_id=$1",
      [other],
    );
    await db.query(
      "INSERT INTO public.profile_institutions(profile_id,institution_id) VALUES($1,$2)",
      [otherProfile, otherInstitution],
    );
    await db.query(
      "INSERT INTO public.profile_roles(profile_id,institution_id,role_code) VALUES($1,$2,'admin')",
      [otherProfile, otherInstitution],
    );
    await role(other);
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.staff_records WHERE institution_id=$1",
        [institution],
      ),
      0,
    );
    await denied("SELECT public.update_staff_record($1,$2,'Cross-tenant edit must be rejected.')", [
      multi,
      { full_name: "Forged" },
    ]);
    await denied("SELECT public.my_staff_workspace($1)", [institution]);
    await denied(
      "SELECT public.set_staff_roles($1,ARRAY['institution_admin'],'Cross-tenant role change must be rejected.')",
      [multi],
    );
    await denied("SELECT public.prepare_staff_invitation($1,$2,$3)", [
      faculty,
      people[2],
      hash(token("f")),
    ]);
    await role(people[2]);
    await denied(
      "INSERT INTO public.profile_institutions(profile_id,institution_id) VALUES(public.current_profile_id(),$1)",
      [otherInstitution],
      /row-level security/,
    );
    await role(owner);
    const audit = (
      await db.query(
        "SELECT * FROM public.staff_setup_audit WHERE institution_id=$1 AND entity_type='staff_role_grants' AND action='update'",
        [institution],
      )
    ).rows;
    await role(null, "service_role");
    assert.equal(
      (await db.query("SELECT * FROM public.authorized_staff_admin_institutions($1)", [owner])).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query("SELECT * FROM public.authorized_staff_admin_institutions($1)", [people[0]]))
        .rows.length,
      0,
    );
    await role(people[0]);
    await denied(
      "SELECT * FROM public.authorized_staff_admin_institutions($1)",
      [owner],
      /permission denied/,
    );
    await role(owner);
    await db.query(
      "SELECT public.set_staff_roles($1,ARRAY['faculty','institution_admin'],'Setup administrator role explicitly granted by the owner.')",
      [faculty],
    );
    await role(null, "service_role");
    assert.equal(
      (await db.query("SELECT * FROM public.authorized_staff_admin_institutions($1)", [people[2]]))
        .rows.length,
      1,
    );
    await role(owner);
    await db.query(
      "SELECT public.set_staff_roles($1,ARRAY['faculty'],'Administrator role ended; faculty responsibilities continue.')",
      [faculty],
    );
    await role(null, "service_role");
    assert.equal(
      (await db.query("SELECT * FROM public.authorized_staff_admin_institutions($1)", [people[2]]))
        .rows.length,
      0,
    );
    await role(owner);
    assert.ok(
      audit.some(
        (a) =>
          a.actor_profile_id &&
          a.previous.role === "faculty" &&
          a.previous.active &&
          a.current.active === false,
      ),
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.staff_invitations WHERE delivery_status<>'link_generated'",
      ),
      0,
    );
    await role(null, "postgres");
    const legacy = "91000000-0000-4000-8000-000000000004";
    await db.query(
      "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'legacy@staff-fixture.invalid',now())",
      [legacy],
    );
    await db.query(
      "INSERT INTO public.user_policy_acceptances(user_id,policy_version_id,acceptance_method) SELECT $1,id,'access_gate' FROM public.policy_versions WHERE active",
      [legacy],
    );
    await db.query(
      "INSERT INTO public.profile_institutions(profile_id,institution_id) VALUES($1,$2)",
      [legacy, institution],
    );
    await db.query(
      "INSERT INTO public.profile_roles(profile_id,institution_id,role_code) VALUES($1,$2,'faculty')",
      [legacy, institution],
    );
    const legacyFaculty = await value(
      "INSERT INTO public.faculty(user_id,institution_id,department,role) VALUES($1,$2,'Performing Arts','hod') RETURNING id AS value",
      [legacy, institution],
    );
    await db.query(
      "INSERT INTO public.class_faculty(institution_id,faculty_id,class_id) VALUES($1,$2,$3)",
      [institution, legacyFaculty, classId],
    );
    await db.query("SELECT public.import_existing_staff_membership($1,$2)", [legacy, institution]);
    await db.query("SELECT public.import_existing_staff_membership($1,$2)", [legacy, institution]);
    await role(legacy);
    const legacyPortal = await value("SELECT public.my_staff_portal_access($1) AS value", [
      institution,
    ]);
    assert.deepEqual(legacyPortal.user.setupRoles, ["faculty"]);
    assert.equal(legacyPortal.user.legacyClassAccess, true);
    const legacyWorkspace = await value("SELECT public.my_staff_workspace($1) AS value", [
      institution,
    ]);
    assert.equal(legacyWorkspace.staff.primary_department_id, d1);
    assert.equal(legacyWorkspace.staff.staff_code, null, "No missing employee ID is fabricated");
    assert.equal(legacyWorkspace.assignments.length, 0, "No missing subject or term is fabricated");
    assert.equal(legacyWorkspace.legacy_classes.length, 1);
    assert.equal(
      await value("SELECT public.can_oversee_department($1) AS value", [d1]),
      false,
      "A legacy HOD designation does not grant HOD permissions",
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.profiles WHERE id<>public.current_profile_id()",
      ),
      0,
      "Ordinary staff cannot enumerate institution identities",
    );
    const legacyStaff = legacyWorkspace.staff.id;
    await role(null, "postgres");
    await db.query(
      "INSERT INTO public.profile_roles(profile_id,institution_id,role_code) VALUES($1,$2,'admin')",
      [legacy, institution],
    );
    await role(owner);
    await db.query(
      "SELECT public.set_staff_roles($1,ARRAY['faculty','institution_admin'],'Explicit institution admin role approved by the owner.')",
      [legacyStaff],
    );
    await role(legacy);
    assert.equal(await value("SELECT public.setup_is_admin($1) AS value", [institution]), true);
    await role(owner);
    await db.query(
      "SELECT public.set_staff_roles($1,ARRAY['faculty'],'Institution admin role removed while faculty duties continue.')",
      [legacyStaff],
    );
    await role(null, "postgres");
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.profile_roles WHERE profile_id=$1 AND institution_id=$2 AND role_code='admin'",
        [legacy, institution],
      ),
      0,
    );
    await db.query(
      "UPDATE public.staff_role_grants SET valid_from='2020-01-01',valid_until='2021-01-01' WHERE staff_id=$1 AND active",
      [legacyStaff],
    );
    await role(legacy);
    assert.equal(
      (await value("SELECT public.my_staff_portal_access($1) AS value", [institution])).status,
      "role_missing",
    );
    await denied("SELECT public.my_staff_workspace($1)", [institution], /active system role/);
    console.log(
      "  PASS Phase 2A: verified owner, profile/logo, flexible academics, distinct designation, multi-role scope, cross-department teaching, invitations, no self-join/IDOR, history and audit (" +
        deniedCount +
        " denied paths).",
    );
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT phase2a_staff");
    await db.query("RELEASE SAVEPOINT phase2a_staff");
  }
};
