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
  await waitForPath(client, "/");
  await waitFor(
    client,
    "document.body.innerText.includes('Your staff profile')",
    "scoped staff dashboard",
  );
}
function installPeriodFixture() {
  const previous = window.fetch.bind(window),
    inst = "93000000-0000-4000-8000-000000000001",
    today = "2026-10-21";
  const actor =
    localStorage.getItem("__period_actor") ??
    (localStorage.getItem("__phase2a_browser_role") === "faculty" ? "faculty" : "owner");
  const manages = actor === "owner" || actor === "ci",
    marker = actor === "faculty";
  const sections = [
    {
      id: "section-a",
      name: "North",
      program_id: "program",
      term_id: "term",
      program_name: "Recorded Program",
      term_name: "Recorded Term",
      can_schedule: manages,
      can_ci: actor === "ci",
    },
    {
      id: "section-b",
      name: "South",
      program_id: "program",
      term_id: "term",
      program_name: "Recorded Program",
      term_name: "Recorded Term",
      can_schedule: actor === "owner",
      can_ci: false,
    },
  ];
  const plan = {
    label: "Combined Lab",
    kind: "lab",
    slots: ["Lab 1", "Lab 2"],
    subject_name: "Recorded Laboratory",
    faculty_name: "Scheduled Faculty",
    timezone: "Asia/Kolkata",
    sections,
  };
  const original = {
    id: "session",
    rule_id: "rule",
    session_date: today,
    starts_at: "2026-10-21T03:30:00Z",
    ends_at: "2026-10-21T05:30:00Z",
    planned: plan,
    state: "pending",
    revision: 1,
    owner_section_id: "section-a",
    scheduled_faculty_id: "faculty",
    substitute_faculty_id: null,
    submitted_by: null,
    submitted_at: null,
    lock_at: null,
    cancel_reason: null,
    marking_authority: marker,
  };
  let session = JSON.parse(localStorage.getItem("__period_session") ?? "null") ?? original;
  let roster = JSON.parse(localStorage.getItem("__period_roster") ?? "null") ?? [
    {
      student_id: "student-a",
      section_id: "section-a",
      name_snapshot: "Recorded North Student",
      admission_snapshot: "0001",
      mark: null,
      original_status: null,
      mark_revision: null,
      approved_leave: false,
      can_ci_correct: actor === "ci",
    },
    {
      student_id: "student-b",
      section_id: "section-b",
      name_snapshot: "Recorded South Student",
      admission_snapshot: "0002",
      mark: null,
      original_status: null,
      mark_revision: null,
      approved_leave: false,
      can_ci_correct: false,
    },
  ];
  const persist = () => {
    localStorage.setItem("__period_session", JSON.stringify(session));
    localStorage.setItem("__period_roster", JSON.stringify(roster));
  };
  let draft = null;
  const events = [];
  window.__periodRequests = [];
  window.__periodForceLock = () => {
    session.state = "locked";
    session.lock_at = "2026-10-21T03:35:00Z";
    persist();
  };
  const catalog = {
    today,
    timezone: "Asia/Kolkata",
    sections: actor === "unrelated" ? [] : sections,
    subjects: [{ id: "subject", name: "Recorded Laboratory", program_id: "program", code: "LAB" }],
    faculty: [
      { id: "faculty", full_name: "Scheduled Faculty", designation: "Lecturer" },
      { id: "substitute", full_name: "Substitute Faculty", designation: "Lecturer" },
    ],
    rules: [
      {
        id: "rule",
        owner_section_id: "section-a",
        subject_id: "subject",
        faculty_id: "faculty",
        label: "Recorded weekly rule",
        kind: "lab",
        slots: ["Lab 1", "Lab 2"],
        starts_at: "09:00",
        ends_at: "11:00",
        weekday: 1,
        on_date: null,
        effective_from: today,
        effective_until: "2026-12-01",
        active: true,
        revision: 1,
        sections: ["section-a", "section-b"],
      },
    ],
    exceptions: [],
  };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin),
      rpc = url.pathname.split("/rpc/")[1],
      body = init.body ? JSON.parse(init.body) : {};
    const json = (x, status = 200) =>
      new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
    if (
      ![
        "period_timetable_catalog",
        "period_session_directory",
        "period_session_detail",
        "create_timetable_rule",
        "retire_timetable_rule",
        "add_timetable_exception",
        "materialize_period_sessions",
        "save_period_draft",
        "submit_period_session",
        "correct_period_mark",
        "assign_period_substitute",
        "approve_student_day_leave",
        "cancel_period_session",
      ].includes(rpc)
    )
      return previous(input, init);
    window.__periodRequests.push({ rpc, body });
    if (rpc === "period_timetable_catalog") return json(catalog);
    if (rpc === "period_session_directory")
      return json(
        actor === "unrelated"
          ? []
          : [
              {
                ...session,
                actual_submitter: session.submitted_at ? "Scheduled Faculty" : null,
                substitute_name: session.substitute_faculty_id ? "Substitute Faculty" : null,
              },
            ],
      );
    if (rpc === "period_session_detail") {
      if (actor === "unrelated") return json({ message: "Session outside current scope." }, 403);
      return json({
        session,
        server_time: "2026-10-21T03:40:00Z",
        can_mark: marker && !session.submitted_at && session.state !== "cancelled",
        can_grace_correct: marker && session.state === "grace_period",
        can_schedule: manages,
        can_substitute: actor === "ci",
        roster: roster
          .filter((r) => actor !== "ci" || r.section_id === "section-a")
          .map((r) => ({ ...r, can_ci_correct: actor === "ci" && r.section_id === "section-a" })),
        draft,
        history: events,
      });
    }
    if (rpc === "create_timetable_rule") {
      catalog.rules.push({
        ...body.p_details,
        id: "new-rule",
        sections: body.p_sections,
        revision: 1,
        active: true,
      });
      return json("new-rule");
    }
    if (rpc === "retire_timetable_rule") {
      catalog.rules.find((r) => r.id === body.p_rule).active = false;
      return json(null);
    }
    if (rpc === "add_timetable_exception") {
      catalog.exceptions.push({
        id: "exception",
        section_id: body.p_section,
        on_date: body.p_day,
        kind: body.p_rule ? "cancelled" : "holiday",
        reason: body.p_reason,
      });
      return json("exception");
    }
    if (rpc === "materialize_period_sessions") return json(0);
    if (rpc === "save_period_draft") {
      draft = body.p_records;
      session.revision++;
      persist();
      return json(session.revision);
    }
    if (rpc === "submit_period_session") {
      if (!marker || session.submitted_at || body.p_revision !== session.revision)
        return json({ message: "Stale or unauthorized submission" }, 403);
      roster.forEach((r) => {
        r.mark = body.p_records.find((x) => x.student_id === r.student_id).status;
        r.original_status = r.mark;
        r.mark_revision = 1;
      });
      session = {
        ...session,
        state: "grace_period",
        revision: session.revision + 1,
        submitted_at: "2026-10-21T03:40:00Z",
        lock_at: "2026-10-21T03:45:00Z",
        submitted_by: "faculty-profile",
        actual_faculty_id: "faculty",
      };
      persist();
      return json({ session_id: "session" });
    }
    if (rpc === "correct_period_mark") {
      const r = roster.find((r) => r.student_id === body.p_student);
      if (
        (actor === "ci" && r.section_id !== "section-a") ||
        (!marker && actor !== "ci") ||
        (marker && session.state !== "grace_period")
      )
        return json({ message: "No correction permission" }, 403);
      r.mark = body.p_new;
      r.mark_revision++;
      session.revision++;
      if (actor === "ci") session.state = "corrected";
      events.push({
        id: "event-" + events.length,
        student_id: r.student_id,
        action: actor === "ci" ? "mark.ci_corrected" : "mark.grace_corrected",
        actor_profile_id: "actor",
        created_at: "2026-10-21",
        reason: body.p_reason,
        previous: { status: body.p_old },
        current: { status: body.p_new },
      });
      persist();
      return json(null);
    }
    if (rpc === "assign_period_substitute") {
      session.substitute_faculty_id = body.p_faculty;
      session.revision++;
      persist();
      return json(null);
    }
    if (rpc === "approve_student_day_leave") {
      roster.find((r) => r.student_id === body.p_student).approved_leave = true;
      persist();
      return json("leave");
    }
    if (rpc === "cancel_period_session") {
      session.state = "cancelled";
      session.cancel_reason = body.p_reason;
      session.revision++;
      persist();
      return json(null);
    }
    throw new Error("Unconfigured period RPC " + rpc);
  };
}
try {
  await client.connect();
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "(" + installStaffFixture.toString() + ")();(" + installPeriodFixture.toString() + ")();",
  });
  await setMode("owner");
  await navigate(client, "/timetable");
  await waitFor(
    client,
    "Boolean(document.querySelector('select[aria-label=\"Timetable owner section\"]'))",
    "timetable form",
  );
  await fill(
    client,
    "input[aria-label='Period operation reason']",
    "Institution timetable reviewed with actual subject faculty assignments.",
  );
  await choose("select[aria-label='Timetable owner section']", "section-a");
  await choose("select[aria-label='Timetable subject']", "subject");
  await choose("select[aria-label='Timetable faculty']", "faculty");
  await choose("select[aria-label='Timetable kind']", "lab");
  await fill(client, "input[aria-label='Timetable label']", "New combined lab");
  await fill(client, "input[aria-label='Timetable slots']", "Practical A, Practical B");
  for (const [selector, value] of [
    ["input[aria-label='Timetable starts_at']", "09:00"],
    ["input[aria-label='Timetable ends_at']", "11:00"],
  ])
    await client.evaluate(
      "(()=>{const i=document.querySelector(" +
        JSON.stringify(selector) +
        ");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i," +
        JSON.stringify(value) +
        ");i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
  await fill(client, "input[aria-label='Timetable effective_from']", "2026-10-22");
  await fill(client, "input[aria-label='Timetable effective_until']", "2026-11-22");
  await client.evaluate(
    "document.querySelector('input[aria-label=\"Attach section section-b\"]').click()",
  );
  await click("Save reviewed timetable");
  await waitFor(
    client,
    "document.body.innerText.includes('New combined lab · lab')",
    "saved logical multi-slot rule",
  );
  const created = await client.evaluate(
    "window.__periodRequests.find(r=>r.rpc==='create_timetable_rule').body",
  );
  assert.deepEqual(created.p_sections, ["section-a", "section-b"]);
  assert.deepEqual(created.p_details.slots, ["Practical A", "Practical B"]);
  await choose("select[aria-label='Exception section']", "section-a");
  await fill(client, "input[aria-label='Exception date']", "2026-10-23");
  await click("Record holiday / cancellation");
  await waitFor(
    client,
    "document.body.innerText.includes('2026-10-23 · holiday')",
    "holiday exception",
  );
  await setMode("faculty");
  await navigate(client, "/period-attendance");
  await waitFor(
    client,
    "document.body.innerText.includes('Combined Lab')",
    "assigned session directory",
  );
  await click("Open Combined Lab");
  await waitFor(
    client,
    "document.body.innerText.includes('Recorded North Student')",
    "actual session roster",
  );
  assert.equal(
    await client.evaluate("document.querySelector('select[aria-label=\"Mark student-a\"]').value"),
    "",
    "No default absence/presence",
  );
  await choose("select[aria-label='Mark student-a']", "present");
  await choose("select[aria-label='Mark student-b']", "absent");
  await click("Save unsubmitted draft");
  await waitFor(
    client,
    "document.body.innerText.includes('Revision 2')",
    "versioned unsubmitted draft",
  );
  await fill(client, "input[aria-label='Final Submit confirmation']", "SUBMIT 2");
  await click("Final Submit");
  await waitFor(
    client,
    "document.body.innerText.includes('grace period')",
    "five-minute final submission window",
  );
  await fill(
    client,
    "input[aria-label='Period operation reason']",
    "Faculty corrected an accidental mark inside the recorded five-minute window.",
  );
  await choose("select[aria-label='Correct student-a']", "absent");
  await client.evaluate(
    "document.querySelector('select[aria-label=\"Correct student-a\"]').closest('form').querySelector('button').click()",
  );
  await waitFor(
    client,
    "window.__periodRequests.some(r=>r.rpc==='correct_period_mark')",
    "same-faculty correction",
  );
  await client.evaluate("window.__periodForceLock()");
  await click("Refresh roster and authority");
  await waitFor(
    client,
    "document.body.innerText.includes('Combined Lab · Recorded Laboratory · locked')",
    "server-derived lock",
  );
  assert.equal(
    await client.evaluate(
      "Boolean(document.querySelector('select[aria-label=\"Correct student-a\"]'))",
    ),
    false,
    "Faculty has no locked correction control",
  );
  await client.evaluate("localStorage.setItem('__period_actor','ci')");
  await navigate(client, "/period-attendance");
  await waitFor(client, "document.body.innerText.includes('Combined Lab')", "CI section dashboard");
  await click("Open Combined Lab");
  await waitFor(
    client,
    "document.body.innerText.includes('Recorded North Student')",
    "CI filtered merged roster",
  );
  assert.equal(
    await client.evaluate(
      "document.querySelector('section[aria-label=\"Session roster\"]').innerText.includes('Recorded South Student')",
    ),
    false,
  );
  await fill(
    client,
    "input[aria-label='Period operation reason']",
    "Scoped Class Incharge reviewed the locked attendance correction with records.",
  );
  await choose("select[aria-label='Correct student-a']", "present");
  await click("Correct recorded mark");
  await waitFor(
    client,
    "document.body.innerText.includes('Combined Lab · Recorded Laboratory · corrected')",
    "scoped locked correction",
  );
  await client.evaluate("localStorage.setItem('__period_actor','unrelated')");
  await navigate(client, "/period-attendance");
  await waitFor(
    client,
    "document.body.innerText.includes('No sessions in your current scope')",
    "unrelated faculty sees no sessions",
  );
  console.log(
    "Phase 4A browser checks passed: timetable/lab/merged slots, holiday, assigned sessions, blank roster defaults, draft, typed Final Submit, grace correction, locked faculty denial, CI section correction and unrelated scope. All responses are isolated fixtures.",
  );
} catch (error) {
  console.error(
    "Period browser state",
    await client.evaluate(
      "({path:location.pathname,body:document.body.innerText.slice(0,2400),requests:window.__periodRequests})",
    ),
  );
  throw error;
} finally {
  client.close();
  await fetch("http://127.0.0.1:" + debugPort + "/json/close/" + page.id).catch(() => undefined);
}
