import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const statePath = join(tmpdir(), "attendai-attendance-fixture.json");
const boundedFetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: boundedFetch },
};
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const client = (session) =>
  createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    ...options,
    global: { fetch: boundedFetch, headers: { Authorization: `Bearer ${session.access_token}` } },
  });
async function checked(query) {
  const { data, error } = await query;
  if (error) throw new Error(`${error.code}: ${error.message}`);
  return data;
}
async function sessionFor(email) {
  const link = await checked(admin.auth.admin.generateLink({ type: "magiclink", email }));
  const auth = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY,
    options,
  );
  const result = await checked(
    auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }),
  );
  assert.ok(result.session);
  return result.session;
}
async function testIdentity(email, institutionId, role) {
  let profile = await checked(admin.from("profiles").select("id").eq("email", email).maybeSingle());
  if (!profile) {
    const result = await checked(
      admin.auth.admin.createUser({
        email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
        user_metadata: { name: "Attendance Development Test" },
      }),
    );
    profile = await checked(
      admin.from("profiles").select("id").eq("auth_user_id", result.user.id).single(),
    );
  }
  await checked(
    admin
      .from("profile_institutions")
      .upsert(
        { profile_id: profile.id, institution_id: institutionId, status: "active" },
        { onConflict: "profile_id,institution_id" },
      ),
  );
  await checked(
    admin
      .from("profile_roles")
      .upsert(
        { profile_id: profile.id, institution_id: institutionId, role_code: role },
        { onConflict: "profile_id,institution_id,role_code" },
      ),
  );
  return { id: profile.id, session: await sessionFor(email) };
}
if (process.argv.includes("--prepare-fixture")) {
  assert.ok(
    process.argv.includes("--development"),
    "Explicit development environment confirmation is required",
  );
  const email = process.argv.find((value) => value.startsWith("--email="))?.slice(8);
  assert.ok(email, "Pass the authorized attendance account with --email=");
  const profile = await checked(
    admin.from("profiles").select("id,status").eq("email", email).single(),
  );
  assert.equal(profile.status, "active");
  const roles = await checked(
    admin.from("profile_roles").select("institution_id,role_code").eq("profile_id", profile.id),
  );
  const role = roles.find((row) => row.role_code === "admin" || row.role_code === "faculty");
  assert.ok(role, "Account needs an existing administrator or faculty assignment");
  const institutionId = role.institution_id;
  const membership = await checked(
    admin
      .from("profile_institutions")
      .select("status")
      .eq("profile_id", profile.id)
      .eq("institution_id", institutionId)
      .single(),
  );
  assert.equal(membership.status, "active");
  let cls = await checked(
    admin
      .from("classes")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("name", "CSE")
      .eq("section", "A")
      .maybeSingle(),
  );
  if (!cls)
    cls = await checked(
      admin
        .from("classes")
        .insert({
          institution_id: institutionId,
          name: "CSE",
          section: "A",
          full_name: "CSE-A",
          active: true,
        })
        .select("id")
        .single(),
    );
  let parent = await checked(
    admin
      .from("parents")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("name", "Attendance Test Guardian")
      .maybeSingle(),
  );
  if (!parent)
    parent = await checked(
      admin
        .from("parents")
        .insert({
          institution_id: institutionId,
          name: "Attendance Test Guardian",
          phone: "+15550000001",
          language: "en",
          preferred_channel: "sms",
          active: true,
          communication_consent: false,
        })
        .select("id")
        .single(),
    );
  const students = [];
  for (const [index, name] of ["Student One", "Student Two", "Student Three"].entries()) {
    let student = await checked(
      admin
        .from("students")
        .select("id,name")
        .eq("class_id", cls.id)
        .eq("roll", `ATT-TEST-${index + 1}`)
        .maybeSingle(),
    );
    if (!student)
      student = await checked(
        admin
          .from("students")
          .insert({
            institution_id: institutionId,
            class_id: cls.id,
            parent_id: parent.id,
            name,
            roll: `ATT-TEST-${index + 1}`,
            admission_number: `attendance-test-${index + 1}`,
            enrollment_status: "active",
            status: "present",
            risk: "low",
          })
          .select("id,name")
          .single(),
      );
    await checked(
      admin.from("student_parents").upsert(
        {
          institution_id: institutionId,
          student_id: student.id,
          parent_id: parent.id,
          relationship: "guardian",
          is_primary: true,
          receives_notifications: false,
        },
        { onConflict: "student_id,parent_id" },
      ),
    );
    students.push(student);
  }
  const assigned = await testIdentity(
    "attendance-assigned@example.invalid",
    institutionId,
    "faculty",
  );
  const unassigned = await testIdentity(
    "attendance-unassigned@example.invalid",
    institutionId,
    "faculty",
  );
  let faculty = await checked(
    admin
      .from("faculty")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("user_id", assigned.id)
      .maybeSingle(),
  );
  if (!faculty)
    faculty = await checked(
      admin
        .from("faculty")
        .insert({
          institution_id: institutionId,
          user_id: assigned.id,
          department: "CSE",
          role: "lecturer",
          employee_code: "ATT-TEST-FACULTY",
          active: true,
        })
        .select("id")
        .single(),
    );
  await checked(
    admin
      .from("class_faculty")
      .upsert(
        { institution_id: institutionId, faculty_id: faculty.id, class_id: cls.id },
        { onConflict: "faculty_id,class_id" },
      ),
  );
  if (role.role_code === "faculty") {
    let own = await checked(
      admin
        .from("faculty")
        .select("id")
        .eq("institution_id", institutionId)
        .eq("user_id", profile.id)
        .maybeSingle(),
    );
    if (!own)
      own = await checked(
        admin
          .from("faculty")
          .insert({
            institution_id: institutionId,
            user_id: profile.id,
            department: "CSE",
            role: "lecturer",
            active: true,
          })
          .select("id")
          .single(),
      );
    await checked(
      admin
        .from("class_faculty")
        .upsert(
          { institution_id: institutionId, faculty_id: own.id, class_id: cls.id },
          { onConflict: "faculty_id,class_id" },
        ),
    );
  }
  const otherInstitutions = await checked(
    admin.from("institutions").select("id,code").neq("id", institutionId).eq("status", "active"),
  );
  const other = otherInstitutions.find((row) => row.code.startsWith("e2e-test-"));
  assert.ok(other, "Use an existing isolated E2E test institution for cross-tenant verification");
  const unrelated = await testIdentity(
    "attendance-other-tenant@example.invalid",
    other.id,
    "admin",
  );
  const studentIdentity = await testIdentity(
    "attendance-student@example.invalid",
    institutionId,
    "student",
  );
  await checked(
    admin.from("profiles").update({ student_id: students[0].id }).eq("id", studentIdentity.id),
  );
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const saved = await checked(
    admin.from("attendance_sessions").select("id,date").eq("class_id", cls.id),
  );
  const firstDate = new Date(`${date}T12:00:00Z`);
  while (saved.some((row) => row.date === firstDate.toISOString().slice(0, 10)))
    firstDate.setUTCDate(firstDate.getUTCDate() - 1);
  const state = {
    institutionId,
    classId: cls.id,
    students,
    date,
    firstSubmissionDate: firstDate.toISOString().slice(0, 10),
    main: { id: profile.id, session: await sessionFor(email) },
    assigned,
    unassigned,
    unrelated,
    studentIdentity,
  };
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log("Development fixture ready", {
    class: "CSE-A",
    institutionId,
    students: students.map((s) => s.name),
    accountRole: role.role_code,
    parentConsent: false,
    statePath,
  });
} else if (process.argv.includes("--verify")) {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const main = client(state.main.session);
  const sessions = await checked(
    main
      .from("attendance_sessions")
      .select("*")
      .eq("class_id", state.classId)
      .eq("date", state.date),
  );
  assert.equal(sessions.length, 1);
  const session = sessions[0];
  assert.equal(session.institution_id, state.institutionId);
  assert.deepEqual([session.total_present, session.total_absent, session.total_late], [2, 0, 1]);
  const records = await checked(
    main.from("attendance_records").select("*").eq("session_id", session.id),
  );
  assert.equal(records.length, 3);
  for (const [index, status] of ["present", "present", "late"].entries()) {
    const record = records.find((row) => row.student_id === state.students[index].id);
    assert.equal(record?.status, status);
    assert.equal(record.institution_id, state.institutionId);
  }
  const payload = {
    p_class_id: state.classId,
    p_date: state.date,
    p_method: "manual",
    p_records: records.map((row) => ({ student_id: row.student_id, status: row.status })),
  };
  const duplicate = await main.rpc("submit_attendance", payload);
  assert.equal(duplicate.error?.code, "23505");
  for (const identity of [state.unassigned, state.unrelated, state.studentIdentity]) {
    const scoped = client(identity.session);
    assert.equal(
      await checked(scoped.rpc("can_manage_class", { target_class_id: state.classId })),
      false,
    );
    const denied = await scoped.rpc("submit_attendance", { ...payload, p_date: "2026-01-02" });
    assert.ok(["42501", "P0002"].includes(denied.error?.code));
    const editDenied = await scoped.rpc("update_attendance", {
      p_session_id: session.id,
      p_expected_revision: session.revision,
      p_records: payload.p_records,
    });
    assert.ok(["42501", "P0002"].includes(editDenied.error?.code));
    const hidden = await checked(
      scoped.from("attendance_records").select("id").eq("session_id", session.id),
    );
    if (identity !== state.studentIdentity) assert.equal(hidden.length, 0);
    const hiddenSessions = await checked(
      scoped.from("attendance_sessions").select("id").eq("id", session.id),
    );
    if (identity !== state.studentIdentity) assert.equal(hiddenSessions.length, 0);
    const write = await scoped.from("attendance_sessions").insert({
      institution_id: state.institutionId,
      class_id: state.classId,
      date: "2026-01-03",
      method: "manual",
    });
    console.log("Unauthorized direct write rejected", {
      identity: identity.id,
      code: write.error?.code,
      message: write.error?.message,
    });
    assert.ok(["42501", "23503"].includes(write.error?.code));
  }
  const faculty = client(state.assigned.session);
  console.log("Checking assigned-faculty permission and real correction RPCs...");
  assert.equal(
    await checked(faculty.rpc("can_manage_class", { target_class_id: state.classId })),
    true,
  );
  const editArgs = {
    p_session_id: session.id,
    p_expected_revision: session.revision,
    p_records: payload.p_records,
  };
  const corrected = await checked(main.rpc("update_attendance", editArgs));
  console.log("Administrator correction succeeded", {
    sessionId: corrected.session_id,
    revision: corrected.revision,
  });
  assert.equal(corrected.session_id, session.id);
  assert.equal(corrected.revision, session.revision + 1);
  const stale = await faculty.rpc("update_attendance", editArgs);
  assert.equal(stale.error?.code, "PT409");
  const facultyEdit = await checked(
    faculty.rpc("update_attendance", { ...editArgs, p_expected_revision: corrected.revision }),
  );
  console.log("Assigned faculty correction succeeded", { revision: facultyEdit.revision });
  assert.equal(facultyEdit.session_id, session.id);
  const concurrent = await Promise.all(
    [main, faculty].map((scoped) =>
      scoped.rpc("update_attendance", { ...editArgs, p_expected_revision: facultyEdit.revision }),
    ),
  );
  assert.equal(concurrent.filter((result) => !result.error).length, 1);
  assert.equal(concurrent.find((result) => result.error)?.error.code, "PT409");
  const finalRevision = concurrent.find((result) => !result.error).data.revision;
  const malformed = await main.rpc("update_attendance", {
    ...editArgs,
    p_expected_revision: finalRevision,
    p_records: [...payload.p_records, { student_id: state.students[0].id, status: "absent" }],
  });
  assert.equal(malformed.error?.code, "22023");
  const unchanged = await checked(
    main.from("attendance_records").select("*").eq("session_id", session.id),
  );
  assert.deepEqual(
    unchanged.map((r) => [r.id, r.status]).sort(),
    records.map((r) => [r.id, r.status]).sort(),
  );
  assert.equal(
    (
      await checked(
        main.from("attendance_sessions").select("revision").eq("id", session.id).single(),
      )
    ).revision,
    finalRevision,
  );
  const facultyDate = new Date(`${state.date}T12:00:00Z`);
  facultyDate.setUTCDate(facultyDate.getUTCDate() - 1);
  const previousDate = facultyDate.toISOString().slice(0, 10);
  const existing = await checked(
    faculty
      .from("attendance_sessions")
      .select("id")
      .eq("class_id", state.classId)
      .eq("date", previousDate),
  );
  if (!existing.length)
    await checked(faculty.rpc("submit_attendance", { ...payload, p_date: previousDate }));
  assert.equal(
    (
      await checked(
        faculty
          .from("attendance_sessions")
          .select("id")
          .eq("class_id", state.classId)
          .eq("date", previousDate),
      )
    ).length,
    1,
  );
  const jobs = await checked(
    main
      .from("communication_jobs")
      .select("id")
      .eq("institution_id", state.institutionId)
      .like("idempotency_key", `absence:${state.institutionId}:${state.date}:%`),
  );
  assert.equal(jobs.length, 0);
  assert.equal(
    (
      await checked(
        main
          .from("attendance_sessions")
          .select("id")
          .eq("class_id", state.classId)
          .eq("date", state.date),
      )
    ).length,
    1,
  );
  console.log(
    "PASS: real persistence, 2/0/1 totals, same-session admin/faculty updates, stable record IDs, stale edits rejected, malformed update unchanged, unique creation protection, unassigned faculty/student modification denial, cross-tenant read/write denial; no outbox jobs because test guardian consent is false.",
  );
} else {
  console.log(
    "Read scripts/inspect-attendance.mjs first. Prepare only in a confirmed development project: --prepare-fixture --development --email=<authorized-account>. After browser submission run --verify.",
  );
}
