import assert from "node:assert/strict";

const baseUrl = process.argv[2] ?? "http://localhost:8081";
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname),
  "Browser fixtures must run against a local preview.",
);
const debugPort = process.argv[3] ?? "9222";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openDebugPage() {
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${baseUrl}/`)}`,
    { method: "PUT" },
  );
  if (!response.ok) throw new Error(`Chrome debugging endpoint returned ${response.status}`);
  return response.json();
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? "Browser evaluation failed",
      );
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitFor(client, expression, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function navigate(client, path) {
  await client.call("Page.navigate", { url: `${baseUrl}${path}` });
  await waitFor(client, `document.readyState === "complete"`, `${path} to load`);
}

async function waitForPath(client, pathname) {
  await waitFor(
    client,
    `location.pathname === ${JSON.stringify(pathname)}`,
    `pathname ${pathname}`,
  );
}

async function waitForLoginForm(client, description = "hydrated login form") {
  await waitFor(
    client,
    `(() => {
      const input = document.querySelector("#email");
      return Boolean(input && Object.keys(input).some((key) => key.startsWith("__reactProps")));
    })()`,
    description,
  );
}

async function fill(client, selector, value) {
  await client.evaluate(
    "(() => { const input = document.querySelector(" +
      JSON.stringify(selector) +
      "); if (!(input instanceof HTMLInputElement)) throw new Error('Missing input'); input.scrollIntoView({block:'center'}); input.focus(); input.select(); })()",
  );
  const dateInput = await client.evaluate(
    "document.querySelector(" + JSON.stringify(selector) + ")?.type === 'date'",
  );
  if (dateInput)
    await client.evaluate(
      "(()=>{const input=document.querySelector(" +
        JSON.stringify(selector) +
        ");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input," +
        JSON.stringify(value) +
        ");input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
  else await client.call("Input.insertText", { text: value });
  await waitFor(
    client,
    "document.querySelector(" + JSON.stringify(selector) + ")?.value === " + JSON.stringify(value),
    selector + " value",
  );
}
async function submitLogin(client, email, password) {
  await fill(client, "#email", email);
  await fill(client, "#password", password);
  const point = await client.evaluate(`(() => {
    const button = document.querySelector('button[type="submit"]');
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await client.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await client.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

// All fixture records are local browser responses. No Auth users or emails are created.
function installStaffFixture() {
  const realFetch = window.fetch.bind(window);
  window.__staffRequests = [];
  const mode = localStorage.getItem("__phase2a_browser_role") ?? "owner";
  const isOwner = mode === "owner";
  const inst = "93000000-0000-4000-8000-000000000001";
  const id = isOwner
    ? "93000000-0000-4000-8000-000000000002"
    : "93000000-0000-4000-8000-000000000003";
  const user = {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: mode + "@staff-fixture.invalid",
    email_confirmed_at: "2020-01-01",
    app_metadata: { provider: "email" },
    user_metadata: {},
    identities: [{ id: "fixture", provider: "email" }],
    created_at: "2020-01-01",
  };
  const session = () => ({
    user,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    access_token:
      "eyJhbGciOiJIUzI1NiJ9." +
      btoa(
        JSON.stringify({
          sub: id,
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: "authenticated",
        }),
      ) +
      ".fixture",
    refresh_token: "fixture-token",
  });
  const departments = [
    { id: "dept-art", institution_id: inst, name: "Performing Arts", code: "ART" },
    { id: "dept-env", institution_id: inst, name: "Environmental Studies", code: "ENV" },
  ];
  const programs = [
    {
      id: "program-music",
      institution_id: inst,
      name: "Bachelor of Music",
      code: "MUS",
      department_id: "dept-art",
    },
    {
      id: "program-field",
      institution_id: inst,
      name: "Environmental Certificate",
      code: "EC",
      department_id: "dept-env",
    },
  ];
  const terms = [
    {
      id: "term-studio",
      institution_id: inst,
      program_id: "program-music",
      name: "Studio Term",
      academic_year: "2026-27",
      term_kind: "term",
      starts_on: "2020-01-01",
      ends_on: "2090-12-31",
    },
  ];
  const sections = [
    {
      id: "section-north",
      institution_id: inst,
      program_id: "program-music",
      term_id: "term-studio",
      class_id: "fixture-class",
      name: "North",
    },
  ];
  const subjects = [
    {
      id: "subject-composition",
      institution_id: inst,
      program_id: "program-music",
      name: "Composition",
      code: "COMP",
    },
  ];
  const owner = {
    id: "owner-staff",
    institution_id: inst,
    profile_id: "93000000-0000-4000-8000-000000000002",
    full_name: "Fixture Verified Owner",
    email: "owner@staff-fixture.invalid",
    phone: "+919000000001",
    staff_code: null,
    primary_department_id: null,
    designation: "Registrar",
    status: "active",
  };
  const faculty = {
    id: "faculty-staff",
    institution_id: inst,
    profile_id: "93000000-0000-4000-8000-000000000003",
    full_name: "Fixture Music Faculty",
    email: "faculty@staff-fixture.invalid",
    phone: "+919000000002",
    staff_code: "ART-1",
    primary_department_id: "dept-art",
    designation: "Professor",
    status: "active",
  };
  const staff = [owner, faculty];
  const allRoles = ["faculty", "hod", "class_incharge", "coordinator"];
  const grants = allRoles.map((role, index) => ({
    id: "role-" + index,
    institution_id: inst,
    staff_id: faculty.id,
    role,
    active: true,
    valid_from: "2020-01-01",
    valid_until: null,
    closed_at: null,
    reason: "Isolated browser role fixture.",
  }));
  const profile = {
    institution_id: inst,
    name: "Fictional Browser Institution",
    state: "Fixture State",
    institution_type: "College",
    verified_identity: true,
    owner_profile_id: owner.profile_id,
    official_address: "Fixture address 123",
    city: "Fixture City",
    academic_year: "2026-27",
    timezone: "Asia/Kolkata",
    official_email: "office@staff-fixture.invalid",
    official_phone: "+919000000003",
    website: "https://staff-fixture.invalid",
    brand_name: "Fixture Institution",
    brand_color: "#2563eb",
    logo_data_url: null,
  };
  const assignment = {
    id: "fixture-teaching",
    staff_id: faculty.id,
    kind: "teaching",
    department_id: "dept-art",
    department_name: "Performing Arts",
    program_id: "program-music",
    program_name: "Bachelor of Music",
    term_id: "term-studio",
    term_name: "Studio Term",
    section_id: "section-north",
    section_name: "North",
    subject_id: "subject-composition",
    subject_name: "Composition",
    academic_year: "2026-27",
    effective_from: "2020-01-01",
    effective_until: "2090-12-31",
    active: true,
    role_effective: true,
    can_mark_subject: true,
  };
  const tables = {
    academic_departments: departments,
    academic_programs: programs,
    academic_terms: terms,
    academic_sections: sections,
    academic_subjects: subjects,
    staff_records: staff,
    staff_role_grants: grants,
    staff_responsibilities: [assignment],
    staff_setup_audit: [],
  };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    const localInvite = url.pathname === "/api/institution-setup/staff-invitation";
    const endpoint = url.pathname.match(/\/(auth|rest|storage)\/v1\//);
    if (!endpoint && !localInvite) return realFetch(input, init);
    const path = localInvite ? url.pathname : url.pathname.slice(endpoint.index);
    const body = init.body ? JSON.parse(init.body) : {};
    window.__staffRequests.push({ path, body });
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (localInvite)
      return json(
        {
          id: "fixture-invitation",
          invitationLink: "https://auth.fixture.invalid/private-test-link",
          deliveryStatus: "link_generated",
          manualDeliveryRequired: true,
        },
        201,
      );
    if (path === "/auth/v1/token") return json(session());
    if (path === "/auth/v1/user") return json(user);
    if (path === "/auth/v1/logout") return json({});
    if (path === "/rest/v1/profiles")
      return json({
        id,
        name: isOwner ? owner.full_name : faculty.full_name,
        email: user.email,
        status: "active",
        created_at: "2020-01-01",
        updated_at: "2020-01-01",
      });
    if (path === "/rest/v1/profile_institutions")
      return json([
        {
          institution_id: inst,
          status: localStorage.getItem("__phase2a_browser_invited") ? "invited" : "active",
        },
      ]);
    if (path === "/rest/v1/institutions") return json([{ id: inst }]);
    const rpc = path.split("/rpc/")[1];
    if (rpc === "my_staff_portal_access")
      return json({
        status: "allowed",
        user: {
          id,
          name: isOwner ? owner.full_name : faculty.full_name,
          email: user.email,
          role: isOwner ? "admin" : "faculty",
          staffModel: true,
          institutionId: inst,
          setupRoles: isOwner ? ["institution_owner"] : allRoles,
          canManageSetup: isOwner,
          createdAt: "2020-01-01",
          updatedAt: "2020-01-01",
        },
      });
    if (rpc === "my_staff_memberships")
      return json([{ id: inst, name: profile.name, can_manage: isOwner }]);
    if (rpc === "my_staff_workspace")
      return json({
        staff: isOwner ? owner : faculty,
        institution: profile,
        roles: isOwner ? ["institution_owner"] : allRoles,
        primary_department: isOwner ? null : "Performing Arts",
        can_manage_setup: isOwner,
        memberships: [{ id: inst, name: profile.name, can_manage: isOwner }],
        assignments: isOwner ? [] : [assignment],
      });
    if (rpc === "institution_setup_profile") return json(profile);
    if (rpc === "staff_lifecycle_overview")
      return json({
        candidates: staff
          .filter((s) => s.status === "active")
          .map((s) => ({
            id: s.id,
            profile_id: s.profile_id,
            name: s.full_name,
            email: s.email,
            designation: s.designation,
          })),
        events: [],
        succession: null,
        single_hod: false,
        legacy_duties: [],
      });
    if (rpc === "period_timetable_catalog")
      return json({
        today: "2026-10-21",
        timezone: "Asia/Kolkata",
        sections: [],
        subjects: [],
        faculty: [],
        rules: [],
        exceptions: [],
      });
    if (rpc === "period_session_directory") return json([]);
    if (rpc === "staff_authority_status") return json([]);
    if (rpc === "start_staff_authority_review")
      return json(
        { message: "Fixture authority review is already pending; no capability granted." },
        409,
      );
    if (rpc === "transfer_institution_ownership")
      return json({ message: "Fixture owner changed; refresh successor details." }, 409);
    if (rpc === "change_staff_lifecycle") {
      const target = staff.find((s) => s.id === body.p_staff);
      target.status = body.p_status;
      grants
        .filter((r) => r.staff_id === target.id)
        .forEach((r) => {
          r.active = false;
        });
      if (target.id === assignment.staff_id) assignment.active = false;
      return json(null);
    }
    if (rpc === "reactivate_staff") {
      staff.find((s) => s.id === body.p_staff).status = "active";
      body.p_roles.forEach((role, index) =>
        grants.push({
          id: "reactivated-" + index,
          institution_id: inst,
          staff_id: body.p_staff,
          role,
          active: true,
          valid_from: "2020-01-01",
          valid_until: null,
          closed_at: null,
          reason: body.p_reason,
        }),
      );
      return json(null);
    }
    if (rpc === "my_institution_verification_access") return json({ allowed: false });
    if (rpc === "my_policy_status")
      return json(
        ["terms", "privacy"].map((type, index) => ({
          id: "fixture-policy-" + index,
          type,
          version: "2026-10-15.1",
          accepted: true,
        })),
      );
    if (rpc === "accept_current_policies") return json(null);
    if (rpc === "save_institution_setup_profile") {
      Object.assign(profile, body.p_details);
      return json(null);
    }
    if (rpc === "create_staff_record") {
      staff.push({
        id: "new-fixture-staff",
        institution_id: inst,
        ...body.p_details,
        status: "draft",
        profile_id: null,
      });
      return json("new-fixture-staff");
    }
    if (rpc === "accept_staff_setup_invitation") {
      localStorage.removeItem("__phase2a_browser_invited");
      return json(inst);
    }
    const table = path.split("/rest/v1/")[1];
    if (Object.hasOwn(tables, table)) return json(tables[table]);
    throw new Error("Unconfigured isolated staff request: " + path);
  };
}
const page = await openDebugPage();
const client = new CdpClient(page.webSocketDebuggerUrl);
const click = async (text) =>
  client.evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===" +
      JSON.stringify(text) +
      ").click()",
  );
const choose = async (selector, value) =>
  client.evaluate(
    "(()=>{const el=document.querySelector(" +
      JSON.stringify(selector) +
      ");el.value=" +
      JSON.stringify(value) +
      ";el.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
async function setMode(mode) {
  await navigate(client, "/login");
  await client.evaluate(
    "localStorage.clear();sessionStorage.clear();localStorage.setItem('__phase2a_browser_role'," +
      JSON.stringify(mode) +
      ")",
  );
  await navigate(client, "/login");
  await waitForLoginForm(client);
  await submitLogin(client, mode + "@staff-fixture.invalid", "fixture-password");
  await waitForPath(client, "/dashboard");
  await waitFor(
    client,
    "document.body.innerText.includes('Your staff profile')",
    "scoped staff dashboard",
  );
}
function installAcademicFixture() {
  const previous = window.fetch.bind(window);
  window.__studentRequests = [];
  const owner = localStorage.getItem("__phase2a_browser_role") !== "faculty";
  const inst = "93000000-0000-4000-8000-000000000001";
  const students = [
    {
      id: "student-one",
      institution_id: inst,
      name: "Fixture Student One",
      admission_number: "EXIST-001",
      roll: "0001",
      enrollment_status: "active",
      admitted_on: "2024-07-01",
      entry_type: "lateral",
      academic_managed: true,
      academic_version: 1,
      section_name: "North",
      program_name: "Bachelor of Music",
      term_name: "Studio Term",
      cohort_name: "Recorded Music Cohort",
      cohort_id: "cohort-music",
      term_id: "term-studio",
    },
    {
      id: "student-two",
      institution_id: inst,
      name: "Fixture Student Two",
      admission_number: "EXIST-002",
      roll: "0002",
      enrollment_status: "active",
      admitted_on: "2024-07-01",
      entry_type: "transfer",
      academic_managed: true,
      academic_version: 1,
      section_name: "North",
      program_name: "Bachelor of Music",
      term_name: "Studio Term",
      cohort_name: "Recorded Music Cohort",
      cohort_id: "cohort-music",
      term_id: "term-studio",
    },
  ];
  const catalog = {
    can_import: owner,
    can_manage: owner,
    departments: [{ id: "dept-art", name: "Performing Arts", code: "ART" }],
    programs: [
      { id: "program-music", department_id: "dept-art", name: "Bachelor of Music", code: "MUS" },
    ],
    terms: [
      {
        id: "term-studio",
        program_id: "program-music",
        name: "Studio Term",
        academic_year: "2026-27",
        term_kind: "year",
        year_number: 2,
        starts_on: "2020-01-01",
        ends_on: "2090-12-31",
      },
      {
        id: "term-next",
        program_id: "program-music",
        name: "Next Term",
        academic_year: "Next academic year",
        term_kind: "year",
        year_number: 3,
        starts_on: "2020-01-01",
        ends_on: "2090-12-31",
      },
    ],
    sections: [
      { id: "section-north", program_id: "program-music", term_id: "term-studio", name: "North" },
      { id: "section-next", program_id: "program-music", term_id: "term-next", name: "Next" },
    ],
    cohorts: [
      {
        id: "cohort-music",
        program_id: "program-music",
        name: "Recorded Music Cohort",
        code: "MUSIC",
        starts_on: "2024-07-01",
        expected_ends_on: "2028-06-30",
        description: "Recorded intake",
      },
    ],
  };
  const history = {
    id: "placement-one",
    student_id: "student-one",
    department_id: "dept-art",
    program_id: "program-music",
    term_id: "term-studio",
    section_id: "section-north",
    cohort_id: "cohort-music",
    starts_on: "2024-07-01",
    ends_on: "2090-12-31",
    change_type: "entry",
    reason: "Recorded actual lateral entry placement.",
    created_by: "fixture-owner",
    created_at: "2024-07-01",
    department_name: "Performing Arts",
    program_name: "Bachelor of Music",
    term_name: "Studio Term",
    year_number: 2,
    term_kind: "year",
    section_name: "North",
    cohort_name: "Recorded Music Cohort",
  };
  let batch = null;
  const guardians = [];
  window.__academicStudentCount = () => students.length;
  function preview(rows) {
    return rows.map((data, i) => ({
      row_number: i + 1,
      data,
      errors:
        data.action === "skip"
          ? []
          : data.admission_number === "EXIST-001"
            ? ["Existing student: explicitly resolve or skip."]
            : [],
      warnings: [],
      existing_students:
        data.admission_number === "EXIST-001"
          ? [
              {
                id: "student-one",
                name: "Fixture Student One",
                admission_number: "EXIST-001",
                roll_number: "0001",
              },
            ]
          : [],
      potential_duplicates: [],
      outcome:
        data.action === "skip"
          ? "skipped"
          : data.admission_number === "EXIST-001"
            ? "rejected"
            : "valid",
    }));
  }
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin),
      rpc = url.pathname.split("/rpc/")[1],
      body = init.body ? JSON.parse(init.body) : {};
    const json = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    const known = [
      "student_academic_catalog",
      "student_academic_directory",
      "student_academic_profile",
      "create_student_cohort",
      "stage_student_import",
      "revise_student_import",
      "commit_student_import",
      "stage_student_promotion",
      "commit_student_promotion",
      "change_student_academic_status",
      "student_guardians",
      "search_student_guardians",
      "link_student_guardian",
      "change_guardian_relationship",
      "update_guardian_contact",
      "record_guardian_communication_consent",
      "stage_guardian_relationship_import",
      "revise_guardian_relationship_import",
      "commit_guardian_relationship_import",
    ];
    if (!known.includes(rpc) && !url.pathname.endsWith("/rest/v1/student_import_batches"))
      return previous(input, init);
    window.__studentRequests.push({ rpc, path: url.pathname, body });
    if (rpc === "student_guardians")
      return json({
        can_manage: owner,
        relationships: owner ? guardians.filter((g) => g.student_id === body.p_student) : [],
      });
    if (rpc === "search_student_guardians")
      return json(
        guardians
          .map((g) => ({ ...g, id: g.guardian_id }))
          .filter((g, i, all) => all.findIndex((x) => x.id === g.id) === i),
      );
    if (rpc === "link_student_guardian") {
      const d = body.p_guardian;
      const id = "guardian-link-" + guardians.length;
      guardians.push({
        ...body.p_relationship,
        id,
        student_id: body.p_student,
        guardian_id: d.guardian_id || "guardian-" + id,
        name: d.guardian_name,
        phone: d.guardian_mobile,
        email: d.guardian_email,
        language: d.guardian_language,
        guardian_active: true,
        communication_consent: false,
        contact_version: 0,
        revision: 1,
        status: "active",
        registered_devices: 0,
        preference_eligible: false,
        can_edit_identity: true,
        contact_metadata: {},
        end_reason: null,
      });
      return json(id);
    }
    if (rpc === "change_guardian_relationship") {
      const g = guardians.find((x) => x.id === body.p_relationship),
        c = body.p_changes;
      if (c.action === "primary") {
        guardians
          .filter((x) => x.student_id === g.student_id)
          .forEach((x) => (x.is_primary = x.id === g.id));
      }
      if (c.action === "preference") g.receives_notifications = c.receives_notifications;
      if (c.action === "end") {
        g.status = "ended";
        g.effective_until = c.effective_until;
        g.end_reason = body.p_reason;
      }
      g.revision++;
      return json(null);
    }
    if (rpc === "update_guardian_contact") {
      guardians
        .filter((x) => x.guardian_id === body.p_guardian)
        .forEach((g) => {
          Object.assign(g, body.p_details);
          g.communication_consent = false;
          g.contact_version++;
        });
      return json(null);
    }
    if (rpc === "record_guardian_communication_consent") {
      guardians
        .filter((x) => x.guardian_id === body.p_guardian)
        .forEach((g) => {
          g.communication_consent = body.p_accepted;
          g.contact_version++;
        });
      return json(null);
    }
    if (rpc === "student_academic_catalog") return json(catalog);
    if (rpc === "student_academic_directory") return json(owner ? students : []);
    if (rpc === "student_academic_profile") {
      const student = students.find((s) => s.id === body.p_student);
      return json({
        student,
        history: [history],
        current: student.enrollment_status === "active" ? history : null,
        entry_term: { name: "Studio Term", year_number: 2 },
        entry_cohort: { name: "Recorded Music Cohort" },
        can_edit: owner,
        can_move: owner,
      });
    }
    if (rpc === "create_student_cohort") {
      catalog.cohorts.push({ ...body.p_details, id: "new-cohort" });
      return json("new-cohort");
    }
    if (rpc === "stage_student_import" || rpc === "stage_guardian_relationship_import") {
      batch = {
        id: "import-batch",
        institution_id: inst,
        filename: body.p_filename,
        kind: rpc === "stage_student_import" ? "import" : "guardian_import",
        status: "preview",
        revision: 1,
        rows: body.p_rows,
        preview:
          rpc === "stage_student_import"
            ? preview(body.p_rows)
            : body.p_rows.map((data, i) => ({
                row_number: i + 1,
                data,
                outcome: "valid",
                errors: [],
                warnings: ["Communication consent remains separate."],
              })),
      };
      return json(batch);
    }
    if (rpc === "revise_student_import" || rpc === "revise_guardian_relationship_import") {
      batch = {
        ...batch,
        rows: body.p_rows,
        preview: preview(body.p_rows),
        revision: batch.revision + 1,
      };
      return json(batch);
    }
    if (rpc === "commit_guardian_relationship_import") {
      batch.status = "committed";
      return json(
        body.p_selected.map((n) => ({
          row_number: n,
          student_id: "student-one",
          relationship_id: "imported-link",
        })),
      );
    }
    if (rpc === "commit_student_import") {
      const results = body.p_selected.map((n) => ({ row_number: n, student_id: "imported-" + n }));
      results.forEach((r) =>
        students.push({ id: r.student_id, name: "New imported fixture student" }),
      );
      batch.status = "committed";
      return json(results);
    }
    if (rpc === "stage_student_promotion") {
      batch = {
        id: "promotion-batch",
        institution_id: inst,
        filename: "cohort promotion",
        kind: "promotion",
        status: "preview",
        revision: 1,
        rows: body.p_rows,
        preview: body.p_rows.map((r, i) => ({
          row_number: i + 1,
          data: r,
          name: students.find((s) => s.id === r.student_id).name,
          outcome: r.action === "exclude" ? "skipped" : "valid",
          errors: [],
          warnings: [],
        })),
      };
      return json(batch);
    }
    if (rpc === "commit_student_promotion") {
      batch.status = "committed";
      return json(1);
    }
    if (rpc === "change_student_academic_status") {
      students.find((s) => s.id === body.p_student).enrollment_status = body.p_status;
      return json(null);
    }
    return json(batch ? [{ id: batch.id, filename: batch.filename, status: batch.status }] : []);
  };
}
try {
  await client.connect();
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "(" + installStaffFixture.toString() + ")();(" + installAcademicFixture.toString() + ")();",
  });
  await setMode("owner");
  await navigate(client, "/students");
  await waitFor(
    client,
    "document.body.innerText.includes('Fixture Student One')",
    "academic directory",
  );
  await click("Fixture Student One");
  await waitFor(
    client,
    "document.body.innerText.includes('Placement history')",
    "canonical student profile",
  );
  assert.equal(
    await client.evaluate(
      "document.body.innerText.includes('lateral')&&document.body.innerText.includes('Recorded Music Cohort')",
    ),
    true,
  );
  await fill(
    client,
    "input[aria-label='Academic change reason']",
    "Guardian contacts and authorization independently reviewed.",
  );
  await waitFor(
    client,
    "document.body.innerText.includes('No guardian relationships recorded.')",
    "guardian section",
  );
  await client.evaluate(
    "[...document.querySelectorAll('summary')].find(x=>x.textContent==='Add Guardian').click()",
  );
  await fill(client, "input[aria-label='Guardian full name']", "Fixture Guardian Mother");
  await fill(client, "input[aria-label='Guardian mobile (+country code)']", "+919876540001");
  await fill(client, "input[aria-label='Guardian effective from']", "2026-07-01");
  await choose("select[aria-label='Guardian relationship']", "mother");
  await client.evaluate(
    "[...document.querySelectorAll('label')].find(x=>x.textContent.includes('Primary notification recipient')).querySelector('input').click()",
  );
  await click("Confirm guardian link");
  await waitFor(
    client,
    "document.querySelector('section[aria-label=\"Student guardians\"]').innerText.includes('Fixture Guardian Mother')",
    "new guardian link",
  );
  assert.equal(
    await client.evaluate(
      "document.querySelector('section[aria-label=\"Student guardians\"]').innerText.includes('Communication consent: Not recorded')",
    ),
    true,
  );
  await click("Fixture Student Two");
  await waitFor(
    client,
    "document.body.innerText.includes('Student profile — Fixture Student Two')&&document.body.innerText.includes('No guardian relationships recorded.')",
    "second child guardian profile",
  );
  await client.evaluate(
    "[...document.querySelectorAll('summary')].find(x=>x.textContent==='Add Guardian').click()",
  );
  await fill(client, "input[aria-label='Search existing guardian']", "Fixture Guardian");
  await click("Find guardian candidates");
  await waitFor(
    client,
    "[...document.querySelectorAll('button')].some(x=>x.textContent.includes('use reviewed identity'))",
    "reviewed guardian search",
  );
  await client.evaluate(
    "[...document.querySelectorAll('button')].find(x=>x.textContent.includes('use reviewed identity')).click()",
  );
  await fill(client, "input[aria-label='Guardian effective from']", "2026-07-01");
  await click("Confirm guardian link");
  await waitFor(
    client,
    "document.querySelector('section[aria-label=\"Student guardians\"]').innerText.includes('Fixture Guardian Mother')",
    "shared guardian reuse",
  );
  const reuse = await client.evaluate(
    "window.__studentRequests.filter(r=>r.rpc==='link_student_guardian').at(-1).body",
  );
  assert.ok(reuse.p_guardian.guardian_id);
  await click("Fixture Student One");
  await waitFor(
    client,
    "document.body.innerText.includes('Student profile — Fixture Student One')&&Boolean(document.querySelector('input[aria-label=\"Edit guardian phone\"]'))",
    "first child contacts",
  );
  await choose("select[aria-label='Recorded guardian communication consent']", "true");
  await client.evaluate(
    "[...document.querySelectorAll('summary')].find(x=>x.textContent==='Record separate communication consent / withdrawal').click()",
  );
  await fill(
    client,
    "input[aria-label='Communication consent evidence reference']",
    "Recorded affirmative consent in isolated browser fixture.",
  );
  await click("Record communication consent decision");
  await waitFor(
    client,
    "document.querySelector('section[aria-label=\"Student guardians\"]').innerText.includes('Communication consent: Recorded')",
    "separate communication consent",
  );
  await client.evaluate(
    "[...document.querySelectorAll('summary')].find(x=>x.textContent==='Edit Guardian').click()",
  );
  await fill(client, "input[aria-label='Edit guardian phone']", "+919876540005");
  await click("Save guardian contact");
  await waitFor(
    client,
    "document.querySelector('section[aria-label=\"Student guardians\"]').innerText.includes('+919876540005')&&document.querySelector('section[aria-label=\"Student guardians\"]').innerText.includes('Communication consent: Not recorded')",
    "phone change consent review",
  );
  await click("Allow notification preference");
  await waitFor(
    client,
    "[...document.querySelectorAll('button')].some(x=>x.textContent==='Stop Notifications')",
    "relationship notification preference",
  );
  await click("Stop Notifications");
  await waitFor(
    client,
    "[...document.querySelectorAll('button')].some(x=>x.textContent==='Allow notification preference')",
    "stop notification preference",
  );
  await fill(
    client,
    "input[aria-label='Relationship cutoff for Fixture Guardian Mother']",
    "2026-10-20",
  );
  await click("End Relationship");
  await waitFor(
    client,
    "document.querySelector('section[aria-label=\"Student guardians\"]').innerText.includes('ended')",
    "retained ended relationship",
  );
  await fill(
    client,
    "input[aria-label='Academic change reason']",
    "Graduation independently reviewed in student records.",
  );
  await choose("select[aria-label='New academic student status']", "graduated");
  await click("Confirm student status");
  await waitFor(
    client,
    "document.body.innerText.includes('No current academic placement recorded.')",
    "graduated placement",
  );
  assert.equal(
    await client.evaluate(
      "document.body.innerText.includes('Recorded actual lateral entry placement.')",
    ),
    true,
  );
  await navigate(client, "/cohorts");
  await waitFor(
    client,
    "Boolean(document.querySelector('select[aria-label=\"Cohort program\"]'))",
    "cohort setup",
  );
  await fill(
    client,
    "input[aria-label='Academic change reason']",
    "New institution cohort dates reviewed by admissions office.",
  );
  await choose("select[aria-label='Cohort program']", "program-music");
  await fill(client, "input[aria-label='Cohort name']", "New reviewed cohort");
  await fill(client, "input[aria-label='Cohort code']", "NEW");
  await fill(client, "input[aria-label='Cohort starts_on']", "2026-07-01");
  await fill(client, "input[aria-label='Cohort expected_ends_on']", "2030-06-30");
  await click("Create cohort");
  await waitFor(
    client,
    "document.body.innerText.includes('New reviewed cohort (NEW)')",
    "cohort creation",
  );
  await navigate(client, "/student-import");
  await waitFor(
    client,
    "Boolean(document.querySelector('input[aria-label=\"Student import file\"]'))",
    "import form",
  );
  await fill(
    client,
    "input[aria-label='Academic change reason']",
    "Admissions reviewed against actual institutional student records.",
  );
  const headers = [
    "full_name",
    "admission_number",
    "roll_number",
    "admitted_on",
    "department_code",
    "program_code",
    "cohort_code",
    "academic_year",
    "term_name",
    "section_name",
    "entry_type",
    "entry_academic_year",
    "entry_term_name",
    "starts_on",
  ];
  const values = [
    [
      "New Student",
      "NEW-003",
      "0003",
      "2026-07-01",
      "ART",
      "MUS",
      "MUSIC",
      "2026-27",
      "Studio Term",
      "North",
      "lateral",
      "2026-27",
      "Studio Term",
      "2026-07-01",
    ],
    [
      "Fixture Student One",
      "EXIST-001",
      "0001",
      "2026-07-01",
      "ART",
      "MUS",
      "MUSIC",
      "2026-27",
      "Studio Term",
      "North",
      "normal",
      "2026-27",
      "Studio Term",
      "2026-07-01",
    ],
  ];
  const csv = [headers.join(","), ...values.map((r) => r.join(","))].join("\n");
  await client.evaluate(
    "(()=>{const d=new DataTransfer();d.items.add(new File([" +
      JSON.stringify(csv) +
      "],'reviewed.csv',{type:'text/csv'}));const el=document.querySelector('input[aria-label=\"Student import file\"]');el.files=d.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await waitFor(
    client,
    "document.body.innerText.includes('Valid rows: 1')&&document.body.innerText.includes('Rejected rows: 1')",
    "validated preview counts",
  );
  assert.equal(
    await client.evaluate("window.__academicStudentCount()"),
    2,
    "Preview inserts no students",
  );
  assert.equal(
    await client.evaluate("document.body.innerText.includes('Existing students: 1')"),
    true,
  );
  await client.evaluate(
    "Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.startsWith('Row 2:')).click()",
  );
  await choose("select[aria-label='Row 2 resolution']", "skip");
  await client.evaluate(
    "Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.startsWith('Row 2:')).parentElement.querySelector('button').click()",
  );
  await waitFor(
    client,
    "document.body.innerText.includes('Revision 2')&&document.body.innerText.includes('Skipped: 1')",
    "row correction and new revision",
  );
  assert.equal(
    await client.evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('selected valid rows')).disabled",
    ),
    true,
  );
  await fill(client, "input[aria-label='Import confirmation']", "IMPORT 1");
  await click("Commit 1 selected valid rows");
  await waitFor(
    client,
    "document.body.innerText.includes('Imported 1 reviewed identities/placements.')",
    "import result",
  );
  const imported = await client.evaluate(
    "window.__studentRequests.find(r=>r.rpc==='commit_student_import').body",
  );
  assert.deepEqual(imported.p_selected, [1]);
  assert.equal(imported.p_revision, 2);
  await choose("select[aria-label='Import type']", "guardians");
  const beforeGuardianImport = await client.evaluate("window.__academicStudentCount()");
  const guardianCsv =
    "admission_number,guardian_name,guardian_relationship,guardian_mobile,guardian_effective_from,guardian_receives_notifications\nEXIST-001,Imported Fixture Guardian,guardian,+919876540011,2026-07-01,true";
  await client.evaluate(
    "(()=>{const d=new DataTransfer();d.items.add(new File([" +
      JSON.stringify(guardianCsv) +
      "],'guardians.csv',{type:'text/csv'}));const el=document.querySelector('input[aria-label=\"Student import file\"]');el.files=d.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await waitFor(
    client,
    "document.body.innerText.includes('Valid rows: 1')&&document.body.innerText.includes('Import preview — guardians.csv')",
    "guardian-only import preview",
  );
  assert.equal(await client.evaluate("window.__academicStudentCount()"), beforeGuardianImport);
  await fill(client, "input[aria-label='Import confirmation']", "IMPORT 1");
  await click("Commit 1 selected valid rows");
  await waitFor(
    client,
    "document.body.innerText.includes('Imported 1 guardian relationships.')",
    "guardian-only import result",
  );
  assert.equal(
    await client.evaluate("window.__academicStudentCount()"),
    beforeGuardianImport,
    "Guardian import never creates another student identity",
  );
  await navigate(client, "/student-promotion");
  await waitFor(
    client,
    "Boolean(document.querySelector('select[aria-label=\"Promotion source cohort\"]'))",
    "promotion form",
  );
  await fill(
    client,
    "input[aria-label='Academic change reason']",
    "Academic promotion reviewed with individual exception decisions.",
  );
  await choose("select[aria-label='Promotion source cohort']", "cohort-music");
  await choose("select[aria-label='Promotion source term']", "term-studio");
  await click("Load cohort students");
  await waitFor(
    client,
    "document.body.innerText.includes('Fixture Student Two')",
    "cohort selection",
  );
  await choose("select[aria-label='Target section']", "section-next");
  await choose("select[aria-label='Target cohort']", "cohort-music");
  await fill(client, "input[aria-label='Placement effective date']", "2027-07-01");
  await choose("select[aria-label='Promotion action student-two']", "exclude");
  await click("Preview promotion");
  await waitFor(
    client,
    "document.body.innerText.includes('Promotion preview')&&document.body.innerText.includes('Skipped: 1')",
    "promotion exceptions preview",
  );
  await fill(client, "input[aria-label='Promotion confirmation']", "PROMOTE 1");
  await click("Apply reviewed promotion");
  await waitFor(client, "document.body.innerText.includes('committed')", "promotion commit");
  assert.equal(
    await client.evaluate("window.__studentRequests.some(r=>r.rpc==='commit_student_promotion')"),
    true,
  );
  await setMode("faculty");
  await navigate(client, "/students");
  await waitFor(
    client,
    "document.body.innerText.includes('No students found in this scope.')",
    "unrelated faculty scoped directory",
  );
  await navigate(client, "/student-import");
  await waitForPath(client, "/dashboard");
  console.log(
    "Phase 3A/3B browser checks passed: student profile/history, guardian add and sibling reuse, separate consent, phone change review, preferences and retained ended links; student/guardian import previews and typed commits; cohort creation, graduation, promotion exceptions and unrelated faculty scope. All data is isolated browser fixtures.",
  );
} catch (error) {
  console.error(
    "Academic browser state",
    await client.evaluate(
      "({path:location.pathname,body:document.body.innerText.slice(0,2200),requests:window.__studentRequests})",
    ),
  );
  throw error;
} finally {
  client.close();
  await fetch("http://127.0.0.1:" + debugPort + "/json/close/" + page.id).catch(() => undefined);
}
