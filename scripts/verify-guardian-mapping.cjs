const assert = require("node:assert/strict");
module.exports = async function verifyGuardianMapping(db, ctx) {
  const {
    owner,
    other,
    institution,
    students,
    staff,
    facultyUser,
    dep,
    program,
    t1,
    section,
    day,
    studentRow,
  } = ctx;
  await db.query("SAVEPOINT guardian_mapping");
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
    await db.query("SAVEPOINT guardian_denied");
    try {
      await assert.rejects(db.query(sql, args), (e) =>
        ["42501", "22023", "23505", "23514", "23503"].includes(e.code),
      );
      denials++;
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT guardian_denied");
      await db.query("RELEASE SAVEPOINT guardian_denied");
    }
  }
  const reason =
    "Reviewed guardian identity, authority, contact information and student relationship records.";
  const person = (name, mobile, extra = {}) => ({
    guardian_name: name,
    guardian_mobile: mobile,
    guardian_email: "",
    guardian_language: "en",
    ...extra,
  });
  const relation = (extra = {}) => ({
    relationship: "guardian",
    is_primary: false,
    receives_notifications: true,
    effective_from: day,
    ...extra,
  });
  const profile = (id) => value("SELECT public.student_guardians($1) AS value", [id]);
  const link = (s, g, r = relation(), v = null) =>
    value("SELECT public.link_student_guardian($1,$2,$3,$4,$5) AS value", [s, g, r, v, reason]);
  const change = (r, action, extra = {}) =>
    db.query("SELECT public.change_guardian_relationship($1,$2,$3,$4)", [
      r.id,
      r.revision,
      { action, ...extra },
      reason,
    ]);
  try {
    await role(owner, true);
    const accounts = await value("SELECT count(*)::int AS value FROM auth.users");
    await role(owner);
    const mother = person("Recorded Guardian Mother", "+91 98765 40001", {
      guardian_email: "household@fixture.invalid",
    });
    const first = await link(
      students[0],
      mother,
      relation({ relationship: "mother", is_primary: true }),
    );
    let p = await profile(students[0]);
    let m = p.relationships.find((x) => x.id === first);
    const guardian = m.guardian_id;
    assert.equal(m.phone_normalized, "+919876540001");
    assert.equal(m.communication_consent, false);
    assert.equal(m.registered_devices, 0);
    await denied("SELECT public.link_student_guardian($1,$2,$3,NULL,$4)", [
      students[1],
      mother,
      relation(),
      reason,
    ]);
    await link(students[1], { ...mother, guardian_id: guardian }, relation(), m.contact_version);
    assert.equal((await profile(students[1])).relationships[0].guardian_id, guardian);
    const father = await link(
      students[0],
      person("Recorded Guardian Father", "+919876540002", {
        guardian_email: "household@fixture.invalid",
      }),
      relation({ relationship: "father", receives_notifications: false }),
    );
    p = await profile(students[0]);
    let f = p.relationships.find((x) => x.id === father);
    assert.equal(p.relationships.length, 2);
    assert.equal(f.is_primary, false);
    assert.equal(f.preference_eligible, false);
    await change(f, "primary");
    p = await profile(students[0]);
    assert.equal(p.relationships.filter((x) => x.is_primary && x.status === "active").length, 1);
    assert.equal(p.relationships.find((x) => x.id === father).is_primary, true);
    m = p.relationships.find((x) => x.id === first);
    await change(m, "preference", { receives_notifications: false });
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    assert.equal(m.preference_eligible, false);
    await change(m, "preference", { receives_notifications: true });
    await denied("SELECT public.link_student_guardian($1,$2,$3,NULL,$4)", [
      students[0],
      person("Different Shared Mobile Person", "+919876540001"),
      relation(),
      reason,
    ]);
    const distinct = await link(
      students[0],
      person("Different Shared Mobile Person", "+919876540001", {
        guardian_distinct_acknowledged: true,
      }),
      relation({ receives_notifications: false }),
    );
    assert.notEqual(
      (await profile(students[0])).relationships.find((x) => x.id === distinct).guardian_id,
      guardian,
    );
    // Guardian-only imports preview/correct/commit against existing student IDs.
    const importRow = {
      admission_number: await value(
        "SELECT admission_number AS value FROM public.students WHERE id=$1",
        [students[1]],
      ),
      ...person("Imported Additional Guardian", "+919876540003"),
      guardian_relationship: "other",
      guardian_is_primary: "false",
      guardian_receives_notifications: "true",
      guardian_effective_from: day,
    };
    let batch = await value(
      "SELECT public.stage_guardian_relationship_import($1,'guardians.csv',$2,$3,$4) AS value",
      [
        institution,
        "a".repeat(64),
        JSON.stringify([{ ...importRow, guardian_mobile: "9876540003" }]),
        reason,
      ],
    );
    assert.equal(batch.preview[0].outcome, "rejected");
    assert.equal(
      (await profile(students[1])).relationships.length,
      1,
      "Preview creates no guardian links",
    );
    batch = await value("SELECT public.revise_guardian_relationship_import($1,$2,$3,$4) AS value", [
      batch.id,
      batch.revision,
      JSON.stringify([importRow]),
      reason,
    ]);
    assert.equal(batch.preview[0].outcome, "valid");
    await denied("SELECT public.commit_guardian_relationship_import($1,1,ARRAY[1],'IMPORT 1',$2)", [
      batch.id,
      reason,
    ]);
    const imported = await value(
      "SELECT public.commit_guardian_relationship_import($1,$2,ARRAY[1],'IMPORT 1',$3) AS value",
      [batch.id, batch.revision, reason],
    );
    assert.equal(imported[0].student_id, students[1]);
    assert.equal((await profile(students[1])).relationships.length, 2);
    assert.deepEqual(
      await value("SELECT result AS value FROM public.student_import_batches WHERE id=$1", [
        batch.id,
      ]),
      imported,
    );
    await denied(
      "SELECT public.commit_guardian_relationship_import($1,$2,ARRAY[1],'IMPORT 1',$3)",
      [batch.id, batch.revision, reason],
    );
    // Optional guardian fields in the original Phase 3A student import are atomic.
    const inline = {
      ...studentRow("GUARDIAN-INLINE"),
      ...person("Inline Import Guardian", "+919876540004"),
      guardian_relationship: "guardian",
      guardian_is_primary: "true",
      guardian_receives_notifications: "true",
      guardian_effective_from: day,
    };
    const inlineBatch = await value(
      "SELECT public.stage_student_import($1,'students.csv',$2,$3,$4) AS value",
      [institution, "b".repeat(64), JSON.stringify([inline]), reason],
    );
    assert.equal(inlineBatch.preview[0].outcome, "valid");
    assert.ok(inlineBatch.preview[0].guardian);
    const inlineResult = await value(
      "SELECT public.commit_student_import($1,$2,ARRAY[1],'IMPORT 1',$3) AS value",
      [inlineBatch.id, inlineBatch.revision, reason],
    );
    assert.equal(
      (await profile(inlineResult[0].student_id)).relationships[0].communication_consent,
      false,
    );
    await denied("SELECT public.commit_student_import_before_guardians($1,$2,ARRAY[1],$3,$4)", [
      inlineBatch.id,
      inlineBatch.revision,
      "IMPORT 1",
      reason,
    ]);
    // An accountless enrollment retains canonical guardian ID, consent and project fences.
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    await db.query("SELECT public.record_guardian_communication_consent($1,$2,$3,true,$4,$5)", [
      students[0],
      guardian,
      m.contact_version,
      "Actual simulated consent record held in isolated fixture",
      reason,
    ]);
    await role(owner, true);
    const inviteHash = "c".repeat(64),
      secret = "d".repeat(64);
    await db.query(
      "INSERT INTO public.guardian_notification_invitations(institution_id,guardian_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,now()+interval '15 minutes',public.current_profile_id())",
      [institution, guardian, inviteHash],
    );
    await denied(
      "SELECT public.consume_guardian_notification_invitation_with_consent($1,'fixture-guardian-device',$2,'old-firebase-project','2026-10-16.1')",
      [inviteHash, secret],
    );
    const installation = await value(
      "SELECT public.consume_guardian_notification_invitation_with_consent($1,'fixture-guardian-device',$2,'attendai-41f64','2026-10-16.1') AS value",
      [inviteHash, secret],
    );
    assert.equal(
      await value(
        "SELECT guardian_id AS value FROM public.guardian_notification_installations WHERE id=$1",
        [installation],
      ),
      guardian,
    );
    const delivery = await value(
      "INSERT INTO public.communications(institution_id,student_id,parent_id,type,direction,message_status,body,provider_message_id) VALUES($1,$2,$3,'push','outbound','provider_accepted','Isolated simulated historical provider result','fixture-provider-evidence') RETURNING id AS value",
      [institution, students[0], guardian],
    );
    const deliveryBefore = await value(
      "SELECT to_jsonb(c) AS value FROM public.communications c WHERE id=$1",
      [delivery],
    );
    assert.equal(
      await value("SELECT public.guardian_communication_eligible($1) AS value", [delivery]),
      true,
    );
    await role(owner);
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    await change(m, "preference", { receives_notifications: true, preferred_channel: "sms" });
    await role(owner, true);
    assert.equal(
      await value("SELECT public.guardian_communication_eligible($1) AS value", [delivery]),
      false,
      "Relationship channel preference fences an incompatible queued channel",
    );
    await role(owner);
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    await change(m, "preference", { receives_notifications: true, preferred_channel: "" });
    await role(owner);
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    assert.equal(m.registered_devices, 1);
    await db.query("SELECT public.update_guardian_contact($1,$2,$3,$4,$5)", [
      students[0],
      guardian,
      {
        name: m.name,
        phone: "+919876540005",
        email: "reviewed@fixture.invalid",
        language: "hi",
        contact_metadata: { note: "Reviewed new contact" },
      },
      m.contact_version,
      reason,
    ]);
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    assert.equal(m.communication_consent, false);
    assert.equal(m.registered_devices, 0);
    assert.equal(m.phone_normalized, "+919876540005");
    await role(owner, true);
    assert.deepEqual(
      await value("SELECT to_jsonb(c) AS value FROM public.communications c WHERE id=$1", [
        delivery,
      ]),
      deliveryBefore,
      "Old delivery facts and destinations are never rewritten",
    );
    assert.equal(
      await value("SELECT public.guardian_communication_eligible($1) AS value", [delivery]),
      false,
    );
    await denied(
      "SELECT public.refresh_guardian_notification_installation($1,$2,'fixture-guardian-device','attendai-41f64')",
      [secret, "e".repeat(64)],
    );
    assert.equal(
      await value("SELECT count(*)::int AS value FROM auth.users"),
      accounts,
      "No guardian creates a staff/Auth account",
    );
    // Relationships remain even when students leave; ending retains preferences/history.
    await role(owner);
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    await db.query("SELECT public.record_guardian_communication_consent($1,$2,$3,true,$4,$5)", [
      students[0],
      guardian,
      m.contact_version,
      "Fresh affirmative consent for the reviewed new contact",
      reason,
    ]);
    await role(owner, true);
    assert.equal(
      await value("SELECT public.guardian_communication_eligible($1) AS value", [delivery]),
      false,
      "Fresh consent cannot retarget a historical queued contact snapshot",
    );
    assert.equal(
      await value("SELECT user_id AS value FROM public.parents WHERE id=$1", [guardian]),
      null,
    );
    const otherGuardian = await value(
      "INSERT INTO public.parents(institution_id,name,phone,phone_normalized,language,guardian_managed) VALUES('94000000-0000-4000-8000-000000000010','Recorded Guardian Mother','+919876540005','+919876540005','en',true) RETURNING id AS value",
    );
    await denied(
      "INSERT INTO public.student_guardian_relationships(institution_id,student_id,guardian_id,relationship,effective_from,reason) VALUES($1,$2,$3,'guardian',$4,$5)",
      [institution, students[0], otherGuardian, day, reason],
    );
    await role(owner);
    await denied("SELECT public.link_student_guardian($1,$2,$3,0,$4)", [
      students[0],
      person("Recorded Guardian Mother", "+919876540005", { guardian_id: otherGuardian }),
      relation(),
      reason,
    ]);
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    f = p.relationships.find((x) => x.id === father);
    await change(f, "end", { effective_until: day });
    p = await profile(students[0]);
    assert.equal(p.relationships.find((x) => x.id === father).status, "ended");
    assert.equal(p.relationships.length, 3);
    const studentVersion = await value(
      "SELECT academic_version AS value FROM public.students WHERE id=$1",
      [students[1]],
    );
    await db.query("SELECT public.change_student_academic_status($1,'graduated',$2,$3)", [
      students[1],
      studentVersion,
      reason,
    ]);
    assert.equal((await profile(students[1])).relationships[0].preference_eligible, false);
    // Shared contacts cannot be modified from a scope that excludes a linked child.
    await link(
      students[2],
      { ...mother, guardian_mobile: m.phone, guardian_email: m.email, guardian_id: guardian },
      relation(),
      m.contact_version,
    );
    await db.query("SELECT public.set_staff_roles($1,ARRAY['coordinator'],$2)", [staff, reason]);
    await role(facultyUser);
    assert.equal((await profile(students[0])).can_manage, true);
    await denied("SELECT public.update_guardian_contact($1,$2,$3,$4,$5)", [
      students[0],
      guardian,
      { name: m.name, phone: "+919876540006" },
      m.contact_version,
      reason,
    ]);
    await role(owner);
    await db.query("SELECT public.set_staff_roles($1,ARRAY['faculty'],$2)", [staff, reason]);
    const subject = await value("SELECT public.create_academic_entity($1,'subject',$2) AS value", [
      institution,
      { program_id: program, name: "Guardian privacy teaching subject", code: "PRIVACY" },
    ]);
    await db.query("SELECT public.add_staff_responsibility($1,$2)", [
      staff,
      {
        kind: "teaching",
        academic_year: "Current test year",
        department_id: dep,
        program_id: program,
        term_id: t1,
        section_id: section,
        subject_id: subject,
        effective_from: day,
        effective_until: day,
        reason,
      },
    ]);
    await role(facultyUser);
    assert.equal((await profile(students[0])).can_manage, false);
    assert.equal((await profile(students[0])).relationships.length, 0);
    assert.equal(
      await value("SELECT count(*)::int AS value FROM public.communications WHERE id=$1", [
        delivery,
      ]),
      0,
      "Historical recipient fields cannot bypass guardian contact privacy",
    );
    assert.equal(
      await value("SELECT count(*)::int AS value FROM public.parents WHERE institution_id=$1", [
        institution,
      ]),
      0,
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.guardian_mapping_audit WHERE institution_id=$1",
        [institution],
      ),
      0,
    );
    await denied("SELECT public.search_student_guardians($1,$2)", [students[0], "Recorded"]);
    await denied("SELECT public.link_student_guardian($1,$2,$3,NULL,$4)", [
      students[0],
      person("Forged guardian", "+919876540099"),
      relation(),
      reason,
    ]);
    await role(other);
    await denied("SELECT public.student_guardians($1)", [students[0]]);
    await role(owner);
    await role(owner, true);
    assert.equal(
      await value("SELECT public.guardian_relationship_eligible($1,$2,$3) AS value", [
        institution,
        students[0],
        guardian,
      ]),
      true,
    );
    await db.query(
      "UPDATE public.student_guardian_relationships SET effective_until=$2::date-1 WHERE id=$1",
      [first, day],
    );
    assert.equal(
      await value("SELECT public.guardian_relationship_eligible($1,$2,$3) AS value", [
        institution,
        students[0],
        guardian,
      ]),
      false,
      "Date cutoff overrides a stale active projection",
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.guardian_current_relationships WHERE student_id=$1 AND parent_id=$2",
        [students[0], guardian],
      ),
      0,
    );
    await role(owner);
    p = await profile(students[0]);
    m = p.relationships.find((x) => x.id === first);
    await denied("SELECT public.change_guardian_relationship($1,$2,$3,$4)", [
      m.id,
      m.revision,
      { action: "primary" },
      reason,
    ]);
    const audit = (
      await db.query("SELECT * FROM public.guardian_mapping_audit WHERE institution_id=$1", [
        institution,
      ])
    ).rows;
    for (const action of [
      "guardian.created",
      "relationship.linked",
      "primary.changed",
      "preference.changed",
      "guardian.contact_changed",
      "relationship.ended",
      "communication_consent.recorded",
    ])
      assert.ok(
        audit.some((x) => x.action === action),
        action,
      );
    assert.ok(
      audit.every(
        (x) => x.actor_profile_id && x.student_id && x.guardian_id && x.reason && x.created_at,
      ),
    );
    console.log(
      `  PASS Phase 3B: canonical guardians, sibling reuse, multiple guardians, explicit duplicates, import preview/corrections, phone/consent/device lifecycle, project fencing, history/status, privacy and audit (${denials} denied paths).`,
    );
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT guardian_mapping");
    await db.query("RELEASE SAVEPOINT guardian_mapping");
    await role(owner);
  }
};
