const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
module.exports = async function verifyStaffLifecycle(db, { owner, reviewer, other, institution }) {
  await db.query("SAVEPOINT phase2b");
  const people = [1, 2, 3, 4].map((n) => `93000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  const email = (n) => `lifecycle-${n}@staff-fixture.invalid`;
  const reason = "Reviewed Phase 2B lifecycle action in an isolated database fixture.";
  let deniedCount = 0,
    scenarios = 0;
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
    pattern = (error) => ["42501", "22023", "23505", "23514"].includes(error.code),
  ) {
    await db.query("SAVEPOINT denied_lifecycle");
    try {
      await assert.rejects(db.query(sql, args), pattern);
      deniedCount++;
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT denied_lifecycle");
      await db.query("RELEASE SAVEPOINT denied_lifecycle");
    }
  }
  async function scenario(name, fn) {
    await role(owner);
    await db.query("SAVEPOINT lifecycle_case");
    try {
      await fn();
      scenarios++;
      console.log("  PASS Phase 2B: " + name);
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT lifecycle_case");
      await db.query("RELEASE SAVEPOINT lifecycle_case");
      await role(null, "postgres");
    }
  }
  try {
    await role(null, "postgres");
    for (let n = 0; n < people.length; n++)
      await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())", [
        people[n],
        email(n),
      ]);
    await db.query(
      "INSERT INTO public.user_policy_acceptances(user_id,policy_version_id,acceptance_method) SELECT u.id,v.id,'access_gate' FROM auth.users u CROSS JOIN public.policy_versions v WHERE u.id=ANY($1::uuid[]) AND v.active",
      [people],
    );
    const ownerProfile = await value(
      "SELECT id AS value FROM public.profiles WHERE auth_user_id=$1",
      [owner],
    );
    const original = (
      await db.query(
        "SELECT a.* FROM public.institution_verification_applications a JOIN public.institutions i ON i.verification_application_id=a.id WHERE i.id=$1",
        [institution],
      )
    ).rows[0];
    await role(owner);
    const today = await value("SELECT public.setup_today($1)::text AS value", [institution]);
    const date = async (n) => value("SELECT ($1::date+$2::int)::text AS value", [today, n]);
    const tomorrow = await date(1),
      last = await date(365),
      past = await date(-10),
      leaveEnd = await date(7);
    const ownerStaff = await value(
      "SELECT id AS value FROM public.staff_records WHERE institution_id=$1 AND profile_id=$2",
      [institution, ownerProfile],
    );
    const entity = (kind, details) =>
      value("SELECT public.create_academic_entity($1,$2,$3) AS value", [
        institution,
        kind,
        details,
      ]);
    const department = await entity("department", { name: "Lifecycle Studies", code: "LIFE" });
    const program = await entity("program", {
      name: "Institution defined course",
      code: "LC",
      department_id: department,
    });
    const term = await entity("term", {
      program_id: program,
      name: "Lifecycle Term",
      academic_year: "Lifecycle fixture year",
      term_kind: "term",
      starts_on: await date(-365),
      ends_on: await date(730),
    });
    const section = await entity("section", { term_id: term, name: "A" });
    const subject = await entity("subject", {
      program_id: program,
      name: "Lifecycle subject",
      code: "LS",
    });
    const staff = [];
    for (let n = 0; n < people.length; n++) {
      await role(owner);
      staff[n] = await value("SELECT public.create_staff_record($1,$2,$3) AS value", [
        institution,
        {
          full_name: "Lifecycle fixture " + n,
          email: email(n),
          phone: "",
          staff_code: "LIFE-" + n,
          designation: "Professor",
          primary_department_id: department,
        },
        ["faculty", "class_incharge", "hod", "coordinator", "staff"],
      ]);
      if (n < 3) {
        const token = String(n + 1).repeat(64),
          hash = createHash("sha256").update(token).digest("hex");
        await db.query("SELECT public.prepare_staff_invitation($1,$2,$3)", [
          staff[n],
          people[n],
          hash,
        ]);
        await role(people[n]);
        await db.query("SELECT public.accept_staff_setup_invitation($1)", [token]);
      }
    }
    await role(owner);
    const assignment = (kind, more = {}) => ({
      kind,
      department_id: department,
      program_id: "",
      term_id: "",
      section_id: "",
      subject_id: "",
      academic_year: "Lifecycle fixture year",
      effective_from: past,
      effective_until: last,
      reason,
      ...more,
    });
    const add = (kind, more = {}) =>
      value("SELECT public.add_staff_responsibility($1,$2) AS value", [
        staff[0],
        assignment(kind, more),
      ]);
    const teaching = await add("teaching", {
      program_id: program,
      term_id: term,
      section_id: section,
      subject_id: subject,
    });
    const incharge = await add("class_incharge", {
      program_id: program,
      term_id: term,
      section_id: section,
    });
    await add("hod");
    await add("coordinator", { program_id: program, term_id: term });
    await add("department_member");
    const currentDuties = async () =>
      (
        await db.query(
          "SELECT id FROM public.staff_responsibilities WHERE staff_id=$1 AND active",
          [staff[0]],
        )
      ).rows;
    const change = (state, decisions, close = true, until = null) =>
      db.query("SELECT public.change_staff_lifecycle($1,$2,$3,$4,$5,$6)", [
        staff[0],
        state,
        reason,
        JSON.stringify(decisions),
        close,
        until,
      ]);
    const transfer = (successor, expected = ownerProfile, confirmation = "TRANSFER " + email(1)) =>
      db.query("SELECT public.transfer_institution_ownership($1,$2,$3,$4,$5)", [
        institution,
        successor,
        expected,
        confirmation,
        reason,
      ]);
    await scenario(
      "owner exit protection, strong confirmation, pending/unverified/cross-tenant transfer guards",
      async () => {
        await denied("SELECT public.change_staff_lifecycle($1,'inactive',$2,'[]',true)", [
          ownerStaff,
          reason,
        ]);
        await denied("SELECT public.transfer_institution_ownership($1,$2,$3,'yes',$4)", [
          institution,
          staff[1],
          ownerProfile,
          reason,
        ]);
        await denied("SELECT public.transfer_institution_ownership($1,$2,$3,$4,$5)", [
          institution,
          staff[3],
          ownerProfile,
          "TRANSFER " + email(3),
          reason,
        ]);
        await denied("SELECT public.transfer_institution_ownership($1,$2,$3,$4,$5)", [
          institution,
          staff[1],
          people[2],
          "TRANSFER " + email(1),
          reason,
        ]);
        await role(null, "postgres");
        await db.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1", [people[1]]);
        await role(owner);
        await denied("SELECT public.transfer_institution_ownership($1,$2,$3,$4,$5)", [
          institution,
          staff[1],
          ownerProfile,
          "TRANSFER " + email(1),
          reason,
        ]);
        await role(other);
        await denied("SELECT public.transfer_institution_ownership($1,$2,$3,$4,$5)", [
          institution,
          staff[1],
          ownerProfile,
          "TRANSFER " + email(1),
          reason,
        ]);
      },
    );
    await scenario(
      "secondary admins remain separate from ownership and cannot appoint admins or successors",
      async () => {
        for (const s of staff.slice(1, 3))
          await db.query(
            "SELECT public.set_staff_roles($1,ARRAY['institution_admin','faculty'],$2)",
            [s, reason],
          );
        await role(people[1]);
        assert.equal(await value("SELECT public.setup_is_admin($1) AS value", [institution]), true);
        await denied("SELECT public.transfer_institution_ownership($1,$2,$3,$4,$5)", [
          institution,
          staff[1],
          ownerProfile,
          "TRANSFER " + email(1),
          reason,
        ]);
        await denied("SELECT public.set_staff_roles($1,ARRAY['institution_admin','faculty'],$2)", [
          staff[0],
          reason,
        ]);
        await denied("SELECT public.save_owner_succession($1,$2,$3)", [
          institution,
          staff[1],
          reason,
        ]);
        await role(owner);
        await db.query("SELECT public.save_owner_succession($1,$2,$3)", [
          institution,
          staff[1],
          reason,
        ]);
        await transfer(staff[1]);
        assert.equal(
          await value("SELECT public.setup_is_admin($1) AS value", [institution]),
          false,
        );
        await denied("SELECT public.save_owner_succession($1,$2,$3)", [
          institution,
          staff[2],
          reason,
        ]);
        await role(people[1]);
        assert.ok(
          (
            await value("SELECT public.my_staff_portal_access($1) AS value", [institution])
          ).user.setupRoles.includes("institution_owner"),
        );
        assert.equal(
          await value(
            "SELECT count(*)::int AS value FROM public.institution_succession_settings WHERE institution_id=$1",
            [institution],
          ),
          0,
        );
        await role(null, "postgres");
        assert.equal(
          await value(
            "SELECT applicant_profile_id AS value FROM public.institution_verification_applications WHERE id=$1",
            [original.id],
          ),
          ownerProfile,
        );
      },
    );
    await scenario(
      "dated role transitions retain original values and append replacement grants",
      async () => {
        await db.query("SELECT public.set_staff_roles($1,ARRAY['hod'],$2)", [staff[0], reason]);
        const grant = (
          await db.query(
            "SELECT * FROM public.staff_role_grants WHERE staff_id=$1 AND role='faculty'",
            [staff[0]],
          )
        ).rows[0];
        assert.equal(grant.active, false);
        assert.ok(grant.ended_on);
        assert.equal(grant.reason, "Initial role selection by institution administrator.");
        await db.query("SELECT public.set_staff_roles($1,ARRAY['faculty','class_incharge'],$2)", [
          staff[0],
          reason,
        ]);
        assert.equal(
          await value(
            "SELECT count(*)::int AS value FROM public.staff_role_grants WHERE staff_id=$1 AND role='faculty'",
            [staff[0]],
          ),
          2,
        );
        await role(people[0]);
        await denied("SELECT public.set_staff_roles($1,ARRAY['institution_admin'],$2)", [
          staff[0],
          reason,
        ]);
      },
    );
    await scenario(
      "dated Class Incharge handover, no overlap, historical holders, HOD exclusivity",
      async () => {
        await db.query("SELECT public.handover_staff_responsibility($1,$2,$3,$4)", [
          incharge,
          staff[1],
          tomorrow,
          reason,
        ]);
        const historical = await value(
          "SELECT public.staff_responsibility_history($1,$2) AS value",
          [institution, today],
        );
        assert.equal(historical.find((a) => a.kind === "class_incharge").staff_id, staff[0]);
        const future = await value("SELECT public.staff_responsibility_history($1,$2) AS value", [
          institution,
          tomorrow,
        ]);
        assert.equal(future.find((a) => a.kind === "class_incharge").staff_id, staff[1]);
        await denied("SELECT public.add_staff_responsibility($1,$2)", [
          staff[2],
          assignment("class_incharge", {
            program_id: program,
            term_id: term,
            section_id: section,
            effective_from: tomorrow,
          }),
        ]);
        await db.query("SELECT public.set_staff_responsibility_rules($1,true,$2)", [
          institution,
          reason,
        ]);
        await denied("SELECT public.add_staff_responsibility($1,$2)", [
          staff[1],
          assignment("hod"),
        ]);
        await role(people[0]);
        assert.equal(
          await value("SELECT public.can_manage_assigned_section($1,$2) AS value", [
            section,
            today,
          ]),
          true,
        );
        assert.equal(
          await value("SELECT public.can_manage_assigned_section($1,$2) AS value", [
            section,
            tomorrow,
          ]),
          false,
        );
        await role(people[1]);
        assert.equal(
          await value("SELECT public.can_manage_assigned_section($1,$2) AS value", [
            section,
            tomorrow,
          ]),
          true,
        );
        await role(null, "postgres");
        const old = (
          await db.query(
            "SELECT *,effective_until::text original_end FROM public.staff_responsibilities WHERE id=$1",
            [incharge],
          )
        ).rows[0];
        assert.equal(old.original_end, last);
        assert.equal(old.reason, reason);
      },
    );
    await scenario(
      "closed exclusive assignments still prevent conflicting backdated history",
      async () => {
        await db.query("SELECT public.close_staff_responsibility($1,$2)", [incharge, reason]);
        await denied("SELECT public.add_staff_responsibility($1,$2)", [
          staff[1],
          assignment("class_incharge", {
            program_id: program,
            term_id: term,
            section_id: section,
            effective_until: await date(-1),
          }),
        ]);
        await db.query("SELECT public.add_staff_responsibility($1,$2)", [
          staff[1],
          assignment("class_incharge", {
            program_id: program,
            term_id: term,
            section_id: section,
            effective_from: today,
          }),
        ]);
        const holders = await value("SELECT public.staff_responsibility_history($1,$2) AS value", [
          institution,
          await date(-1),
        ]);
        assert.equal(holders.filter((a) => a.kind === "class_incharge").length, 1);
        assert.equal(holders.find((a) => a.kind === "class_incharge").staff_id, staff[0]);
      },
    );
    await scenario(
      "responsibility preview is mandatory; atomic failure preserves all access and assignments",
      async () => {
        await denied("SELECT public.change_staff_lifecycle($1,'inactive',$2,'[]',true)", [
          staff[0],
          reason,
        ]);
        await denied("SELECT public.change_staff_lifecycle($1,'inactive',$2,'[]',false)", [
          staff[0],
          reason,
        ]);
        assert.equal(
          await value("SELECT status AS value FROM public.staff_records WHERE id=$1", [staff[0]]),
          "active",
        );
        assert.equal((await currentDuties()).length, 5);
      },
    );
    await scenario(
      "temporary leave creates dated substitutes and resumptions without automatic return",
      async () => {
        const choices = (await currentDuties()).map((a) => ({
          id: a.id,
          action: "substitute",
          to_staff: staff[1],
        }));
        await change("on_leave", choices, true, leaveEnd);
        await denied("SELECT public.reactivate_staff($1,ARRAY['faculty'],$2)", [staff[0], reason]);
        assert.equal(
          await value(
            "SELECT count(*)::int AS value FROM public.staff_leave_periods WHERE staff_id=$1",
            [staff[0]],
          ),
          1,
        );
        assert.equal(
          await value(
            "SELECT count(*)::int AS value FROM public.staff_responsibilities WHERE staff_id=$1 AND substitution_for_id IS NOT NULL",
            [staff[1]],
          ),
          5,
        );
        await role(people[0]);
        assert.equal(
          await value("SELECT public.is_institution_member($1) AS value", [institution]),
          false,
        );
        assert.equal(
          (await value("SELECT public.my_staff_portal_access($1) AS value", [institution])).status,
          "role_missing",
        );
        await role(people[1]);
        assert.equal(
          await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [
            section,
            subject,
            term,
          ]),
          true,
        );
      },
    );
    await scenario(
      "deactivation revokes stale token/membership/roles, preserves identity and requires explicit reactivation",
      async () => {
        const choices = (await currentDuties()).map((a) => ({ id: a.id, action: "close" }));
        await change("left_institution", choices);
        await denied("SELECT public.staff_invitation_context($1)", [staff[0]]);
        await denied("SELECT public.add_staff_responsibility($1,$2)", [
          staff[0],
          assignment("hod"),
        ]);
        await role(null, "postgres");
        await db.query(
          "UPDATE public.profile_institutions SET status='active' WHERE profile_id=$1 AND institution_id=$2",
          [people[0], institution],
        );
        await db.query(
          "INSERT INTO public.profile_roles(profile_id,institution_id,role_code) VALUES($1,$2,'admin') ON CONFLICT DO NOTHING",
          [people[0], institution],
        );
        await role(people[0]);
        assert.equal(
          await value("SELECT public.is_institution_member($1) AS value", [institution]),
          false,
        );
        assert.equal(
          await value("SELECT public.setup_is_admin($1) AS value", [institution]),
          false,
        );
        assert.equal(
          await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [
            section,
            subject,
            term,
          ]),
          false,
        );
        await denied("SELECT public.my_staff_workspace($1)", [institution]);
        await role(null, "service_role");
        assert.equal(
          (
            await db.query("SELECT * FROM public.authorized_staff_admin_institutions($1)", [
              people[0],
            ])
          ).rows.length,
          0,
        );
        await role(owner);
        assert.ok(
          (
            await value("SELECT public.staff_responsibility_history($1,$2) AS value", [
              institution,
              past,
            ])
          ).length >= 5,
        );
        await db.query("SELECT public.reactivate_staff($1,ARRAY['faculty'],$2)", [
          staff[0],
          reason,
        ]);
        await role(people[0]);
        assert.equal(
          (await value("SELECT public.my_staff_portal_access($1) AS value", [institution])).status,
          "allowed",
        );
        assert.equal(
          await value("SELECT public.can_mark_assigned_subject($1,$2,$3) AS value", [
            section,
            subject,
            term,
          ]),
          false,
        );
      },
    );
    await scenario(
      "expired term rollover keeps identities and closes only completed term duties",
      async () => {
        const endedTerm = await entity("term", {
          program_id: program,
          name: "Previous Year",
          academic_year: "Previous fixture year",
          term_kind: "year",
          starts_on: await date(-730),
          ends_on: await date(-366),
        });
        const endedSection = await entity("section", { term_id: endedTerm, name: "Previous A" });
        await db.query("SELECT public.add_staff_responsibility($1,$2)", [
          staff[1],
          assignment("teaching", {
            program_id: program,
            term_id: endedTerm,
            section_id: endedSection,
            subject_id: subject,
            academic_year: "Previous fixture year",
            effective_from: await date(-730),
            effective_until: await date(-366),
          }),
        ]);
        assert.equal(
          await value("SELECT public.rollover_staff_term($1,$2,$3) AS value", [
            institution,
            endedTerm,
            reason,
          ]),
          1,
        );
        await denied("SELECT public.rollover_staff_term($1,$2,$3)", [institution, term, reason]);
        assert.equal(
          await value("SELECT status AS value FROM public.staff_records WHERE id=$1", [staff[1]]),
          "active",
        );
      },
    );
    // Exercise actual quarantined evidence registration/review/official contact
    // confirmation. No status/authority booleans are forged to approve recovery.
    async function recoveryDraft(
      person = 1,
      purpose = "ownership_recovery",
      capability = "institution_owner",
      targetInstitution = institution,
    ) {
      await role(people[person]);
      return value("SELECT public.start_staff_authority_review($1,$2,$3,$4,$5) AS value", [
        targetInstitution,
        purpose,
        capability,
        {
          institution_name: original.institution_name,
          institution_type: original.institution_type,
          state: original.state,
          applicant_name: "Lifecycle successor",
          applicant_phone: "+919000000004",
          designation: "Registrar",
          leadership_role: "registrar",
          signatory_name: "Institution Governing Officer",
          signatory_designation: "Secretary",
          authorization_date: today,
          authority_statement:
            "Authority specifically confirmed for institution leadership succession.",
        },
        reason,
      ]);
    }
    async function prepareRecovery(app, person = 1) {
      await role(people[person]);
      const challenge = await value(
        "SELECT public.issue_institution_verification_challenge($1) AS value",
        [app],
      );
      for (const kind of ["authorization_letter", "recognition_document", "challenge_photo"]) {
        const id = randomUUID(),
          path = `${institution}/${app}/${id}.png`,
          hash = createHash("sha256").update(id).digest("hex");
        await role(null, "postgres");
        await db.query(
          'INSERT INTO storage.objects(bucket_id,name,metadata) VALUES(\'institution-verification\',$1,\'{"size":16,"mimetype":"image/png"}\')',
          [path],
        );
        await role(null, "service_role");
        await db.query(
          "SELECT public.register_institution_verification_evidence($1,$2,$3,$4,$5,$6,'image/png',16,$7,$8)",
          [
            people[person],
            app,
            id,
            kind,
            path,
            "isolated-evidence.png",
            hash,
            kind === "challenge_photo" ? challenge.id : null,
          ],
        );
      }
      await role(people[person]);
      await db.query("SELECT public.submit_institution_verification($1)", [app]);
      await role(reviewer);
      const evidence = (
        await db.query(
          "SELECT id FROM public.institution_verification_evidence WHERE application_id=$1",
          [app],
        )
      ).rows;
      for (const e of evidence)
        await db.query("SELECT public.review_institution_evidence($1,'clean',true,$2)", [
          e.id,
          "Trusted external scan and manual authority/challenge inspection completed.",
        ]);
      await db.query(
        "SELECT public.review_institution_application($1,'pending_institution_confirmation',$2,true,true)",
        [app, reason],
      );
      const contact = await value(
        "SELECT public.record_institution_official_contact($1,'email','secretary@institution-fixture.invalid','official_directory','https://institution-fixture.invalid/official-directory',$2) AS value",
        [
          app,
          "Official contact independently located and checked outside applicant-provided documents.",
        ],
      );
      return contact;
    }
    async function confirm(app, contact, confirmed = true) {
      await role(reviewer);
      await db.query(
        "SELECT public.record_institution_authority_confirmation($1,$2,'manual_official_email','Governing Officer','Secretary',$3,$4)",
        [app, contact, confirmed, "Private isolated official reply reference " + randomUUID()],
      );
    }
    await scenario(
      "emergency recovery requires fresh evidence, independent reviewer and actual official confirmation",
      async () => {
        const app = await recoveryDraft();
        await role(reviewer);
        await denied("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
        const contact = await prepareRecovery(app);
        await denied("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
        await role(null, "postgres");
        await db.query(
          "INSERT INTO public.institution_verification_reviewers(auth_user_id,appointment_reason) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [people[1], reason],
        );
        await role(people[1]);
        await denied("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
        await role(owner);
        await denied("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
        await confirm(app, contact);
        await db.query("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
        await role(people[1]);
        assert.ok(
          (
            await value("SELECT public.my_staff_portal_access($1) AS value", [institution])
          ).user.setupRoles.includes("institution_owner"),
        );
        assert.equal(
          await value(
            "SELECT count(*)::int AS value FROM public.institution_official_contacts WHERE application_id=$1",
            [app],
          ),
          0,
          "Applicant cannot read private reviewer contacts",
        );
        await role(owner);
        assert.equal(
          await value("SELECT public.setup_is_admin($1) AS value", [institution]),
          false,
        );
        await role(null, "postgres");
        assert.equal(
          await value(
            "SELECT applicant_profile_id AS value FROM public.institution_verification_applications WHERE id=$1",
            [original.id],
          ),
          ownerProfile,
        );
      },
    );
    await scenario(
      "recovery fails closed after ownership changes or disputed confirmation",
      async () => {
        const app = await recoveryDraft();
        const contact = await prepareRecovery(app);
        await confirm(app, contact, false);
        await confirm(app, contact, true);
        await denied("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
        await role(owner);
        await transfer(staff[2], ownerProfile, "TRANSFER " + email(2));
        await role(reviewer);
        await denied("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
      },
    );
    await scenario(
      "principal/registrar replacement verifies new authority without overwriting old representative",
      async () => {
        const app = await recoveryDraft(1, "leadership_replacement", "institution_admin");
        const contact = await prepareRecovery(app);
        await confirm(app, contact);
        await db.query("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
        await role(people[1]);
        assert.equal(await value("SELECT public.setup_is_admin($1) AS value", [institution]), true);
        const portal = await value("SELECT public.my_staff_portal_access($1) AS value", [
          institution,
        ]);
        assert.equal(portal.user.setupRoles.includes("institution_owner"), false);
        await role(owner);
        assert.equal(
          await value("SELECT owner_profile_id AS value FROM public.institutions WHERE id=$1", [
            institution,
          ]),
          ownerProfile,
        );
        assert.equal(
          await value("SELECT designation AS value FROM public.staff_records WHERE id=$1", [
            staff[1],
          ]),
          "Registrar",
        );
      },
    );
    await scenario(
      "external successor receives no membership until full independent recovery approval",
      async () => {
        const external = "93000000-0000-4000-8000-000000000099";
        const index = people.push(external) - 1;
        await role(null, "postgres");
        await db.query(
          "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'external-successor@staff-fixture.invalid',now())",
          [external],
        );
        await db.query(
          "INSERT INTO public.user_policy_acceptances(user_id,policy_version_id,acceptance_method) SELECT $1,id,'access_gate' FROM public.policy_versions WHERE active",
          [external],
        );
        const app = await recoveryDraft(index, "ownership_recovery", "institution_owner", null);
        assert.equal(
          await value("SELECT public.is_institution_member($1) AS value", [institution]),
          false,
        );
        assert.equal(
          (await value("SELECT public.my_staff_portal_access($1) AS value", [institution])).status,
          "role_missing",
        );
        await denied("SELECT public.apply_owner_succession($1,$2,$3,$4)", [
          institution,
          staff[1],
          ownerProfile,
          reason,
        ]);
        const contact = await prepareRecovery(app, index);
        await confirm(app, contact);
        await db.query("SELECT public.review_institution_application($1,'approved',$2)", [
          app,
          reason,
        ]);
        await role(external);
        assert.ok(
          (
            await value("SELECT public.my_staff_portal_access($1) AS value", [institution])
          ).user.setupRoles.includes("institution_owner"),
        );
        await role(null, "postgres");
        assert.equal(
          await value(
            "SELECT count(*)::int AS value FROM public.staff_lifecycle_events WHERE institution_id=$1 AND action='staff.authority_activated' AND reason=$2",
            [institution, reason],
          ),
          1,
        );
      },
    );
    await scenario(
      "pending invitation is revoked by deactivation and cannot be replayed",
      async () => {
        const token = "e".repeat(64),
          hash = createHash("sha256").update(token).digest("hex");
        await db.query("SELECT public.prepare_staff_invitation($1,$2,$3)", [
          staff[3],
          people[3],
          hash,
        ]);
        await db.query("SELECT public.change_staff_lifecycle($1,'inactive',$2,'[]',true)", [
          staff[3],
          reason,
        ]);
        await role(people[3]);
        await denied("SELECT public.accept_staff_setup_invitation($1)", [token]);
        await role(null, "postgres");
        assert.equal(
          await value("SELECT count(*)::int AS value FROM auth.users WHERE id=$1", [people[3]]),
          1,
        );
      },
    );
    await scenario(
      "legacy whole-class duties require explicit closure and never revive on reactivation",
      async () => {
        await role(null, "postgres");
        await db.query(
          "UPDATE public.staff_records SET legacy_class_assignments=true WHERE id=$1",
          [staff[0]],
        );
        const facultyId = await value(
          "INSERT INTO public.faculty(institution_id,user_id,department,role) VALUES($1,$2,'Lifecycle Studies','lecturer') RETURNING id AS value",
          [institution, people[0]],
        );
        const classId = await value(
          "SELECT class_id AS value FROM public.academic_sections WHERE id=$1",
          [section],
        );
        const mapping = await value(
          "INSERT INTO public.class_faculty(institution_id,faculty_id,class_id) VALUES($1,$2,$3) RETURNING id AS value",
          [institution, facultyId, classId],
        );
        await role(owner);
        const choices = (await currentDuties()).map((a) => ({ id: a.id, action: "close" }));
        await denied("SELECT public.change_staff_lifecycle($1,'inactive',$2,$3,true)", [
          staff[0],
          reason,
          JSON.stringify(choices),
        ]);
        const preview = await value("SELECT public.staff_lifecycle_overview($1) AS value", [
          institution,
        ]);
        assert.ok(preview.legacy_duties.some((a) => a.id === mapping));
        await change("inactive", [...choices, { id: mapping, action: "close" }]);
        await db.query("SELECT public.reactivate_staff($1,ARRAY['faculty'],$2)", [
          staff[0],
          reason,
        ]);
        await role(people[0]);
        assert.equal(await value("SELECT public.can_manage_class($1) AS value", [classId]), false);
        await role(null, "postgres");
        assert.equal(
          await value(
            "SELECT closed_at IS NOT NULL AS value FROM public.class_faculty WHERE id=$1",
            [mapping],
          ),
          true,
        );
        const events = (
          await db.query(
            "SELECT * FROM public.staff_lifecycle_events WHERE target_staff_id=$1 AND action IN ('staff.inactive','staff.reactivated')",
            [staff[0]],
          )
        ).rows;
        assert.equal(events.length, 2);
        for (const e of events) {
          assert.equal(e.actor_profile_id, ownerProfile);
          assert.equal(e.reason, reason);
          assert.ok(e.previous);
          assert.ok(e.current);
          assert.ok(e.created_at);
        }
      },
    );
    await scenario("changed successor record blocks previously confirmed recovery", async () => {
      const app = await recoveryDraft();
      const contact = await prepareRecovery(app);
      await confirm(app, contact);
      await role(null, "postgres");
      await db.query(
        "UPDATE public.staff_records SET updated_at=now()+interval '1 second' WHERE id=$1",
        [staff[1]],
      );
      await role(reviewer);
      await denied("SELECT public.review_institution_application($1,'approved',$2)", [app, reason]);
    });
    await scenario(
      "cross-institution successor and immutable role/assignment history",
      async () => {
        await role(null, "postgres");
        const otherInstitution = randomUUID();
        await db.query(
          "INSERT INTO public.institutions(id,name,code) VALUES($1,'Other lifecycle fixture institution',$2)",
          [otherInstitution, "lifecycle-" + otherInstitution],
        );
        await db.query(
          "INSERT INTO public.profile_institutions(institution_id,profile_id,status) VALUES($1,$2,'active')",
          [otherInstitution, people[2]],
        );
        const cross = await value(
          "INSERT INTO public.staff_records(institution_id,profile_id,full_name,email,designation,status) VALUES($1,$2,'Other institution successor',$3,'Lecturer','active') RETURNING id AS value",
          [otherInstitution, people[2], email(2)],
        );
        await role(owner);
        await denied("SELECT public.transfer_institution_ownership($1,$2,$3,$4,$5)", [
          institution,
          cross,
          ownerProfile,
          "TRANSFER " + email(2),
          reason,
        ]);
        await denied("SELECT public.handover_staff_responsibility($1,$2,$3,$4)", [
          incharge,
          cross,
          tomorrow,
          reason,
        ]);
        await role(null, "postgres");
        await denied(
          "UPDATE public.staff_responsibilities SET effective_until=effective_until+1 WHERE id=$1",
          [teaching],
        );
        await denied(
          "UPDATE public.staff_role_grants SET reason='Attempt to rewrite the recorded original role reason.' WHERE staff_id=$1",
          [staff[0]],
        );
      },
    );
    await scenario(
      "cross-tenant lifecycle changes, private audit and forged history are blocked",
      async () => {
        await role(other);
        await denied("SELECT public.change_staff_lifecycle($1,'inactive',$2,'[]',true)", [
          staff[0],
          reason,
        ]);
        await denied("SELECT public.staff_lifecycle_overview($1)", [institution]);
        await denied("SELECT public.handover_staff_responsibility($1,$2,$3,$4)", [
          teaching,
          staff[1],
          tomorrow,
          reason,
        ]);
        await role(people[0]);
        assert.equal(
          await value(
            "SELECT count(*)::int AS value FROM public.staff_lifecycle_events WHERE institution_id=$1",
            [institution],
          ),
          0,
        );
        assert.equal(
          (
            await db.query(
              "UPDATE public.institutions SET owner_profile_id=public.current_profile_id() WHERE id=$1 RETURNING id",
              [institution],
            )
          ).rowCount,
          0,
        );
      },
    );
    console.log(
      `  PASS Phase 2B lifecycle: ${scenarios} scenarios, ${deniedCount} denied paths; no production access.`,
    );
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT phase2b");
    await db.query("RELEASE SAVEPOINT phase2b");
    await role(null, "postgres");
  }
};
