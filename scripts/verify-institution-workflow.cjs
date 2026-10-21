const assert = require("node:assert/strict");

module.exports = async function verifyInstitutionWorkflow(db) {
  await db.query("BEGIN");
  const applicant = "90000000-0000-4000-8000-000000000001";
  const reviewer = "90000000-0000-4000-8000-000000000002";
  const outsider = "90000000-0000-4000-8000-000000000003";
  const unverified = "90000000-0000-4000-8000-000000000004";
  let assertionCount = 0;
  async function role(user, name = "authenticated") {
    await db.query("RESET ROLE");
    await db.query("SET LOCAL ROLE " + name);
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [user ?? "", name],
    );
  }
  async function value(sql, params = []) {
    return (await db.query(sql, params)).rows[0]?.value;
  }
  async function denied(
    sql,
    params = [],
    pattern = /required|unavailable|invalid|disabled|cannot|already|not |incomplete|expired|violates|denied|editable|re-review/i,
  ) {
    await db.query("SAVEPOINT expect_denial");
    try {
      await assert.rejects(db.query(sql, params), pattern);
      assertionCount++;
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT expect_denial");
      await db.query("RELEASE SAVEPOINT expect_denial");
    }
  }
  const details = (name = "Fictional Verification College", state = "Fixture State") => ({
    institution_name: name,
    institution_type: "College",
    state,
    city: "Fixture City",
    applicant_name: "Fixture Representative",
    applicant_phone: "+919000000001",
    official_email: "representative@fixture.invalid",
    designation: "Authorized Secretary",
    leadership_role: "secretary",
    signatory_name: "Fixture Director",
    signatory_designation: "Director",
    authorization_date: "2020-01-01",
    authority_statement:
      "Authorized by institutional leadership to create and administer the AttendAI institution account.",
    claimed_website: "https://fixture.invalid",
    claimed_aishe_code: "",
  });
  async function start(user, registry, d) {
    await role(user);
    return value("SELECT public.start_institution_verification($1,$2) AS value", [registry, d]);
  }
  let counter = 0;
  async function upload(user, appId, kind, hash, challengeId = null) {
    await role(null, "postgres");
    const institution = await value(
      "SELECT institution_id AS value FROM public.institution_verification_applications WHERE id=$1",
      [appId],
    );
    const id = await value("SELECT gen_random_uuid() AS value");
    const path =
      institution + "/" + appId + "/" + id + (kind === "challenge_photo" ? ".png" : ".pdf");
    const mime = kind === "challenge_photo" ? "image/png" : "application/pdf";
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('institution-verification',$1,$2)",
      [path, { size: 123, mimetype: mime }],
    );
    await role(null, "service_role");
    return value(
      "SELECT public.register_institution_verification_evidence($1,$2,$3,$4,$5,'fixture-evidence',$6,123,$7,$8) AS value",
      [
        user,
        appId,
        id,
        kind,
        path,
        mime,
        hash ?? (++counter).toString(16).padStart(64, "0"),
        challengeId,
      ],
    );
  }
  async function prepare(user, appId) {
    await upload(user, appId, "authorization_letter");
    await upload(user, appId, "recognition_document");
    await role(user);
    const challenge = await value(
      "SELECT public.issue_institution_verification_challenge($1) AS value",
      [appId],
    );
    await upload(user, appId, "challenge_photo", null, challenge.id);
    await role(user);
    assert.equal(
      await value("SELECT public.submit_institution_verification($1) AS value", [appId]),
      "pending_manual_review",
    );
  }
  async function acceptEvidence(appId) {
    await role(reviewer);
    const evidence = (
      await db.query(
        "SELECT id FROM public.institution_verification_evidence WHERE application_id=$1 AND deleted_at IS NULL",
        [appId],
      )
    ).rows;
    for (const e of evidence)
      await db.query("SELECT public.review_institution_evidence($1,'clean',true,$2)", [
        e.id,
        "Offline malware scan clean; authorization, recognition and challenge contents manually checked.",
      ]);
    return evidence;
  }
  try {
    await db.query(
      "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'applicant@fixture.invalid',now()),($2,'reviewer@fixture.invalid',now()),($3,'other@fixture.invalid',now()),($4,'unverified@fixture.invalid',NULL)",
      [applicant, reviewer, outsider, unverified],
    );
    await db.query(
      "INSERT INTO public.user_policy_acceptances(user_id,policy_version_id,acceptance_method) SELECT u.id,v.id,'signup' FROM auth.users u CROSS JOIN public.policy_versions v WHERE u.id=ANY($1::uuid[]) AND v.active",
      [[applicant, reviewer, outsider, unverified]],
    );
    await db.query(
      "INSERT INTO public.institution_verification_reviewers(auth_user_id,appointment_reason) VALUES($1,'Fixture platform reviewer appointed for isolated verification tests')",
      [reviewer],
    );
    await role(null, "service_role");
    const source = (id, name, state) => ({
      source: "aishe",
      externalId: id,
      aisheCode: id,
      canonicalName: name,
      institutionType: "College",
      state,
      city: "Fixture City",
      officialWebsite: "https://fixture.invalid",
      officialDomain: "fixture.invalid",
      status: "active",
      sourceUrl: "https://aishe.gov.in/",
      sourceUpdatedAt: "2020-01-01T00:00:00Z",
      registryId: null,
    });
    assert.equal(
      await value("SELECT public.import_institution_registry($1,$2) AS value", [
        JSON.stringify([
          source("C-FIXTURE-1", "Fictional Verification College", "Fixture State"),
          source("C-FIXTURE-2", "Fictional Verification College", "Another Fixture State"),
        ]),
        "a".repeat(64),
      ]),
      2,
    );
    await role(null, "postgres");
    const registry = await value(
      "SELECT id AS value FROM public.institution_registry WHERE aishe_code='C-FIXTURE-1'",
    );
    await role(null, "service_role");
    const cross = {
      ...source("UGC-FIXTURE-1", "Fictional Verification College", "Fixture State"),
      source: "ugc",
      registryId: registry,
      aisheCode: "C-FIXTURE-1",
      sourceUrl: "https://ugc.gov.in/",
    };
    await db.query("SELECT public.import_institution_registry($1,$2)", [
      JSON.stringify([cross]),
      "b".repeat(64),
    ]);
    await denied(
      "SELECT public.import_institution_registry($1,$2)",
      [JSON.stringify([{ ...cross, aisheCode: "WRONG-CODE" }]), "b".repeat(64)],
      /conflicts/,
    );
    await denied(
      "SELECT public.import_institution_registry($1,$2)",
      [JSON.stringify([{ ...cross, sourceUpdatedAt: "2019-01-01T00:00:00Z" }]), "b".repeat(64)],
      /stale/,
    );
    await db.query("SELECT public.import_institution_registry($1,$2)", [
      JSON.stringify([
        {
          ...source("C-FIXTURE-1", "Fictional Verification College", "Fixture State"),
          city: "Updated Fixture City",
          sourceUpdatedAt: "2021-01-01T00:00:00Z",
        },
      ]),
      "c".repeat(64),
    ]);
    await role(null, "postgres");
    assert.equal(
      await value("SELECT city AS value FROM public.institution_registry WHERE id=$1", [registry]),
      "Updated Fixture City",
    );
    await role(applicant);
    const matches = await value(
      "SELECT public.search_institution_registry('Fictional Verification') AS value",
    );
    assert.equal(matches.length, 2);
    assert.equal(matches[0].sources.length + matches[1].sources.length, 3);
    assert.deepEqual(
      await value("SELECT public.search_institution_registry('not found fixture') AS value"),
      [],
    );
    await denied("SELECT public.provision_my_new_institution()");
    await denied(
      "SELECT public.provision_my_new_institution_after_policy()",
      [],
      /permission denied/,
    );
    await role(unverified);
    await denied("SELECT public.start_institution_verification(NULL,$1)", [
      details("Unverified Fixture"),
    ]);
    const app = await start(applicant, registry, details());
    assert.equal(
      await value(
        "SELECT status AS value FROM public.institution_verification_applications WHERE id=$1",
        [app],
      ),
      "draft",
    );
    assert.equal(
      await value(
        "SELECT registry_confidence AS value FROM public.institution_verification_applications WHERE id=$1",
        [app],
      ),
      "cross_checked",
    );
    assert.equal(
      await value(
        "SELECT public.is_institution_member(institution_id) AS value FROM public.institution_verification_applications WHERE id=$1",
        [app],
      ),
      false,
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.profile_roles WHERE profile_id=public.current_profile_id()",
      ),
      0,
    );
    await denied("SELECT public.submit_attendance($1,CURRENT_DATE,'manual','[]'::jsonb)", [
      "20000000-0000-4000-8000-000000000001",
    ]);
    await denied("SELECT public.submit_institution_verification($1)", [app], /required/);
    await db.query(
      "UPDATE public.institution_verification_applications SET status='approved' WHERE id=$1",
      [app],
    );
    assert.equal(
      await value(
        "SELECT status AS value FROM public.institution_verification_applications WHERE id=$1",
        [app],
      ),
      "draft",
    );
    await role(null, "postgres");
    const institution = await value(
      "SELECT institution_id AS value FROM public.institution_verification_applications WHERE id=$1",
      [app],
    );
    await denied(
      "UPDATE public.institutions SET status='active' WHERE id=$1",
      [institution],
      /approval required/,
    );
    await denied(
      "UPDATE public.institutions SET verification_application_id=NULL WHERE id=$1",
      [institution],
      /cannot be detached/,
    );
    await role(outsider);
    await denied(
      "SELECT public.start_institution_verification($1,$2)",
      [registry, details()],
      /ALREADY_REGISTERED_OR_CLAIMED/,
    );
    await prepare(applicant, app);
    await role(applicant);
    await denied("SELECT public.review_institution_application($1,'approved',$2,true,true)", [
      app,
      "Applicant cannot grant their own institution access.",
    ]);
    await role(null, "postgres");
    await db.query(
      "INSERT INTO public.institution_verification_reviewers(auth_user_id,appointment_reason) VALUES($1,'Self review test deliberately supplies a reviewer grant')",
      [applicant],
    );
    await role(applicant);
    await denied("SELECT public.review_institution_application($1,'rejected',$2)", [
      app,
      "Even an appointed reviewer cannot review their own application.",
    ]);
    await role(null, "postgres");
    await db.query("DELETE FROM public.institution_verification_reviewers WHERE auth_user_id=$1", [
      applicant,
    ]);
    await role(outsider);
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.institution_verification_evidence WHERE application_id=$1",
        [app],
      ),
      0,
    );
    await role(null, "postgres");
    const photo = (
      await db.query(
        "SELECT * FROM public.institution_verification_evidence WHERE application_id=$1 AND kind='challenge_photo'",
        [app],
      )
    ).rows[0];
    await role(outsider);
    await denied("SELECT public.access_institution_verification_evidence($1)", [photo.id]);
    await role(applicant);
    assert.ok(
      await value("SELECT public.access_institution_verification_evidence($1) AS value", [
        photo.id,
      ]),
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.institution_official_contacts WHERE application_id=$1",
        [app],
      ),
      0,
    );
    await role(null, "postgres");
    await db.query(
      "CREATE POLICY fixture_broad_storage_policy ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true)",
    );
    await role(applicant);
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM storage.objects WHERE bucket_id='institution-verification'",
      ),
      0,
    );
    await denied(
      "INSERT INTO storage.objects(bucket_id,name) VALUES('institution-verification','forged')",
      [],
      /row-level security/,
    );
    await role(null, "postgres");
    await denied(
      "UPDATE storage.buckets SET public=true WHERE id='institution-verification'",
      [],
      /remain private/,
    );
    await denied(
      "UPDATE storage.buckets SET file_size_limit=NULL WHERE id='institution-verification'",
      [],
      /remain private/,
    );
    await role(reviewer);
    await denied(
      "SELECT public.review_institution_application($1,'pending_institution_confirmation',$2,true,true)",
      [app, "Documents alone cannot automatically authorize an institution."],
    );
    await acceptEvidence(app);
    await role(reviewer);
    await db.query(
      "SELECT public.review_institution_application($1,'pending_institution_confirmation',$2,true,true)",
      [
        app,
        "Recognition independently verified; all letter fields and fresh challenge manually accepted.",
      ],
    );
    await denied("SELECT public.review_institution_application($1,'approved',$2)", [
      app,
      "Evidence alone cannot bypass independent official contact confirmation.",
    ]);
    const contact = await value(
      "SELECT public.record_institution_official_contact($1,'email','registrar@fixture.invalid','official_directory','https://aishe.gov.in/',$2) AS value",
      [
        app,
        "Official contact sourced independently from a trusted directory, not application evidence.",
      ],
    );
    await denied(
      "SELECT public.record_institution_authority_confirmation($1,$2,'manual_official_phone','Officer','Registrar',true,'Fixture phone response')",
      [app, contact],
    );
    await db.query(
      "SELECT public.record_institution_authority_confirmation($1,$2,'manual_official_email','Fixture Officer','Registrar',true,$3)",
      [app, contact, "Fixture official reply archive reference 001"],
    );
    await role(null, "postgres");
    await db.query(
      "INSERT INTO public.institution_verification_reviewers(auth_user_id,appointment_reason) VALUES($1,'Own internal contact visibility regression fixture')",
      [applicant],
    );
    await role(applicant);
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.institution_official_contacts WHERE application_id=$1",
        [app],
      ),
      0,
    );
    await role(null, "postgres");
    await db.query("DELETE FROM public.institution_verification_reviewers WHERE auth_user_id=$1", [
      applicant,
    ]);
    await db.query("UPDATE auth.users SET email='changed@fixture.invalid' WHERE id=$1", [
      applicant,
    ]);
    await role(reviewer);
    await denied(
      "SELECT public.review_institution_application($1,'approved',$2)",
      [app, "An email change must invalidate the previously reviewed applicant identity."],
      /re-review/,
    );
    await role(null, "postgres");
    await db.query("UPDATE auth.users SET email='applicant@fixture.invalid' WHERE id=$1", [
      applicant,
    ]);
    await role(reviewer);
    await db.query(
      "SELECT public.record_institution_authority_confirmation($1,$2,'manual_official_email','Fixture Officer','Registrar',false,$3)",
      [app, contact, "Fixture contradictory official reply archive reference 002"],
    );
    await denied(
      "SELECT public.review_institution_application($1,'approved',$2)",
      [app, "Contradictory confirmations must not silently allow approval."],
      /disputed/,
    );
    await db.query("SELECT public.review_institution_application($1,'needs_more_information',$2)", [
      app,
      "Official registrar disputed authority; provide updated authorization evidence.",
    ]);
    await role(applicant);
    await db.query("SELECT public.save_institution_verification($1,$2)", [app, details()]);
    await db.query("SELECT public.submit_institution_verification($1)", [app]);
    await role(reviewer);
    await denied(
      "SELECT public.review_institution_application($1,'pending_institution_confirmation',$2,true,true)",
      [app, "Old accepted documents must not approve a newly revised application."],
      /revision/,
    );
    await acceptEvidence(app);
    await db.query(
      "SELECT public.review_institution_application($1,'pending_institution_confirmation',$2,true,true)",
      [app, "Updated authority evidence independently checked and clean for the new revision."],
    );
    await denied(
      "SELECT public.review_institution_application($1,'approved',$2)",
      [app, "Old official replies cannot authorize a revised application."],
      /confirmation/,
    );
    await db.query(
      "SELECT public.record_institution_authority_confirmation($1,$2,'manual_official_email','Fixture Officer','Registrar',true,$3)",
      [app, contact, "Fixture updated official reply archive reference 003"],
    );
    await db.query("SELECT public.review_institution_application($1,'approved',$2)", [
      app,
      "Institution existence and authority independently verified; official registrar confirmed the applicant.",
    ]);
    await role(applicant);
    assert.equal(
      await value("SELECT public.has_institution_role($1,ARRAY['admin']::user_role[]) AS value", [
        institution,
      ]),
      true,
    );
    assert.equal(
      await value(
        "SELECT owner_profile_id=public.current_profile_id() AS value FROM public.institutions WHERE id=$1",
        [institution],
      ),
      true,
    );
    await require("./verify-staff-setup.cjs")(db, {
      owner: applicant,
      other: outsider,
      institution,
    });
    await role(outsider);
    await denied(
      "SELECT public.start_institution_verification($1,$2)",
      [registry, details()],
      /ALREADY_REGISTERED/,
    );
    assert.ok(
      await value("SELECT public.request_institution_claim_recovery($1,$2,$3) AS value", [
        registry,
        "Fictional Verification College",
        "Please investigate an authorized administrator recovery request; no access should be granted automatically.",
      ]),
    );
    assert.equal(
      await value(
        "SELECT count(*)::int AS value FROM public.profile_roles WHERE profile_id=public.current_profile_id()",
      ),
      0,
    );
    const manual = await start(outsider, null, details("Fictional Unlisted College"));
    assert.equal(
      await value(
        "SELECT registry_confidence AS value FROM public.institution_verification_applications WHERE id=$1",
        [manual],
      ),
      "needs_review",
    );
    const expired = await value(
      "SELECT public.issue_institution_verification_challenge($1) AS value",
      [manual],
    );
    await role(null, "postgres");
    await db.query(
      "UPDATE public.institution_verification_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.id],
    );
    await db.query("SAVEPOINT expired_photo");
    await assert.rejects(
      upload(outsider, manual, "challenge_photo", "e".repeat(64), expired.id),
      /expired or already used/,
    );
    await db.query("ROLLBACK TO SAVEPOINT expired_photo");
    await db.query("RELEASE SAVEPOINT expired_photo");
    await role(outsider);
    const fresh = await value(
      "SELECT public.issue_institution_verification_challenge($1) AS value",
      [manual],
    );
    await db.query("SAVEPOINT reused_photo");
    await assert.rejects(
      upload(outsider, manual, "challenge_photo", photo.sha256, fresh.id),
      /verification_photo_no_reuse/,
    );
    await db.query("ROLLBACK TO SAVEPOINT reused_photo");
    await db.query("RELEASE SAVEPOINT reused_photo");
    await prepare(outsider, manual);
    await role(null, "postgres");
    const usedChallenge = await value(
      "SELECT challenge_id AS value FROM public.institution_verification_evidence WHERE application_id=$1 AND kind='challenge_photo'",
      [manual],
    );
    await db.query(
      "UPDATE public.institution_verification_applications SET status='needs_more_information' WHERE id=$1",
      [manual],
    );
    await db.query("SAVEPOINT replay_challenge");
    await assert.rejects(
      upload(outsider, manual, "challenge_photo", "f".repeat(64), usedChallenge),
      /expired or already used/,
    );
    await db.query("ROLLBACK TO SAVEPOINT replay_challenge");
    await db.query("RELEASE SAVEPOINT replay_challenge");
    await role(outsider);
    await db.query("SELECT public.submit_institution_verification($1)", [manual]);
    await role(reviewer);
    await db.query("SELECT public.review_institution_application($1,'rejected',$2)", [
      manual,
      "Institution authorization was not established by independent review.",
    ]);
    await role(outsider);
    assert.equal(
      await value(
        "SELECT public.is_institution_member(institution_id) AS value FROM public.institution_verification_applications WHERE id=$1",
        [manual],
      ),
      false,
    );
    await denied("SELECT public.save_institution_verification($1,$2)", [
      manual,
      details("Fictional Unlisted College"),
    ]);
    await role(reviewer);
    await db.query("SELECT public.review_institution_application($1,'revoked',$2)", [
      app,
      "Authority has been withdrawn by an independently verified institutional officer.",
    ]);
    await role(applicant);
    assert.equal(
      await value("SELECT public.is_institution_member($1) AS value", [institution]),
      false,
    );
    await denied("SELECT public.submit_attendance($1,CURRENT_DATE,'manual','[]'::jsonb)", [
      "20000000-0000-4000-8000-000000000001",
    ]);
    await role(null, "postgres");
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name,created_at) VALUES('institution-verification','old-orphan',now()-interval '2 hours'),('institution-verification','fresh-orphan',now())",
    );
    await role(applicant);
    await denied("SELECT * FROM public.verification_orphan_objects()", [], /permission denied/);
    await role(null, "service_role");
    const orphans = (await db.query("SELECT * FROM public.verification_orphan_objects()")).rows.map(
      (row) => row.object_path,
    );
    assert.ok(orphans.includes("old-orphan"));
    assert.ok(!orphans.includes("fresh-orphan"));
    assert.ok(!orphans.includes(photo.object_path));
    await role(null, "postgres");
    await db.query(
      "UPDATE public.institution_verification_evidence SET retention_until=now()-interval '1 day' WHERE id=$1",
      [photo.id],
    );
    await role(applicant);
    await denied(
      "SELECT public.access_institution_verification_evidence($1)",
      [photo.id],
      /expired or deleted/,
    );
    await role(null, "postgres");
    await db.query("DELETE FROM storage.objects WHERE name=$1", [photo.object_path]);
    await role(null, "service_role");
    await db.query("SELECT public.finish_verification_evidence_deletion($1)", [photo.id]);
    await role(null, "postgres");
    assert.equal(
      await value(
        "SELECT storage_deleted_at IS NOT NULL AS value FROM public.institution_verification_evidence WHERE id=$1",
        [photo.id],
      ),
      true,
    );
    assert.ok(
      await value(
        "SELECT count(*)::int > 10 AS value FROM public.institution_verification_events WHERE application_id=$1",
        [app],
      ),
    );
    console.log(
      "  ✓ institution verification: registry/crosscheck, ambiguous/not-found, independent authority, private storage, IDOR, expiry/replay, approval/revocation and pending API gates passed (" +
        assertionCount +
        " denied paths)",
    );
  } finally {
    await db.query("ROLLBACK");
    await db.query("RESET ROLE");
  }
};
