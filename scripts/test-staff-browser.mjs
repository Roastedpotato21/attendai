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
  await client.call("Input.insertText", { text: value });
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
try {
  await client.connect();
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: "(" + installStaffFixture.toString() + ")();",
  });
  await setMode("owner");
  assert.equal(
    await client.evaluate("document.body.innerText.includes('Institution Owner')"),
    true,
  );
  await navigate(client, "/institution-profile");
  await waitFor(
    client,
    "Boolean(document.querySelector('#official_address'))",
    "institution profile",
  );
  assert.equal(await client.evaluate("document.querySelector('#name').readOnly"), true);
  assert.equal(await client.evaluate("document.querySelector('#state').readOnly"), true);
  await fill(client, "#official_address", "Updated fixture official address");
  await click("Save institution profile");
  await waitFor(client, "document.body.innerText.includes('Changes saved.')", "profile save");
  await navigate(client, "/departments");
  await waitFor(
    client,
    "document.body.innerText.includes('Performing Arts')",
    "department directory",
  );
  await navigate(client, "/programs");
  await waitFor(
    client,
    "document.body.innerText.includes('Bachelor of Music')&&document.body.innerText.includes('Environmental Certificate')",
    "different institution programs",
  );
  await navigate(client, "/staff");
  await waitFor(client, "document.body.innerText.includes('Staff directory')", "staff directory");
  await click("Add staff");
  await waitFor(client, "Boolean(document.querySelector('#staff-full_name'))", "staff wizard");
  await fill(client, "#staff-full_name", "Fixture New Lecturer");
  await fill(client, "#staff-email", "new@staff-fixture.invalid");
  await fill(client, "#staff-phone", "+919000000004");
  await fill(client, "#staff-staff_code", "ART-NEW");
  await click("Continue");
  await choose("select[aria-label='Primary department']", "dept-art");
  await click("Continue");
  await fill(client, "#staff-designation", "Professor");
  await click("Continue");
  await client.evaluate(
    "Array.from(document.querySelectorAll('label')).filter(l=>['HOD','Class Incharge','Coordinator'].includes(l.textContent.trim())).forEach(l=>l.querySelector('input').click())",
  );
  await click("Continue");
  await waitFor(client, "document.body.innerText.includes('Responsibility')", "assignment step");
  await choose("select[aria-label='Responsibility program']", "program-music");
  await choose("select[aria-label='Responsibility term']", "term-studio");
  await choose("select[aria-label='Responsibility section']", "section-north");
  await choose("select[aria-label='Teaching subject']", "subject-composition");
  await fill(
    client,
    "input[aria-label='Assignment reason']",
    "Reviewed fixture subject assignment.",
  );
  await click("Add responsibility");
  await click("Review staff invitation");
  await click("Create staff & generate invitation");
  await waitFor(
    client,
    "document.body.innerText.includes('Invitation link generated')",
    "generated invitation status",
  );
  assert.equal(await client.evaluate("document.body.innerText.includes('no email sent')"), true);
  const created = await client.evaluate(
    "window.__staffRequests.find(r=>r.path.endsWith('/rpc/create_staff_record')).body",
  );
  assert.equal(created.p_details.designation, "Professor");
  assert.equal(created.p_roles.length, 4);
  assert.equal(created.p_assignments.length, 1);
  assert.equal(created.p_assignments[0].subject_id, "subject-composition");
  await setMode("faculty");
  await waitFor(
    client,
    "document.body.innerText.includes('Composition')&&document.body.innerText.includes('North')",
    "assigned subject and section",
  );
  assert.equal(
    await client.evaluate("document.body.innerText.includes('Complete campus overview')"),
    false,
  );
  assert.equal(
    await client.evaluate("document.body.innerText.includes('Institution setup')"),
    false,
  );
  for (const path of [
    "/staff",
    "/departments",
    "/programs",
    "/staff-assignments",
    "/institution-profile",
    "/attendance",
    "/students",
  ]) {
    await navigate(client, path);
    await waitForPath(client, "/");
    await waitFor(
      client,
      "document.body.innerText.includes('Your staff profile')",
      "faculty protected route",
    );
  }
  await client.evaluate("localStorage.setItem('__phase2a_browser_invited','1')");
  await navigate(client, "/accept-invite?staff_invitation=" + "a".repeat(64));
  await waitFor(
    client,
    "Boolean(document.querySelector('#new-password'))",
    "invitation completion",
  );
  assert.equal(await client.evaluate("location.search.includes('staff_invitation')"), false);
  await fill(client, "#new-password", "fixture-new-password");
  await fill(client, "#confirm-password", "fixture-new-password");
  await client.evaluate("document.querySelectorAll('input[type=checkbox]').forEach(e=>e.click())");
  await client.evaluate("document.querySelector('button[type=submit]').click()");
  await waitForPath(client, "/");
  await waitFor(
    client,
    "document.body.innerText.includes('Your staff profile')",
    "accepted invitation dashboard",
  );
  assert.equal(
    await client.evaluate(
      "window.__staffRequests.some(r=>r.path.endsWith('/rpc/activate_my_staff_invitation'))",
    ),
    false,
  );
  assert.equal(
    await client.evaluate(
      "window.__staffRequests.some(r=>r.path.endsWith('/rpc/accept_staff_setup_invitation'))",
    ),
    true,
  );
  console.log(
    "Phase 2A browser checks passed: owner dashboard/profile identity lock; department/program pages; six-step staff wizard; multi-role subject assignment; honest generated-link status; scoped faculty dashboard; seven protected URLs; token-based invitation acceptance. All responses were isolated browser fixtures.",
  );
} catch (error) {
  console.error(
    "Isolated browser state",
    await client.evaluate(
      "({path:location.pathname,body:document.body.innerText.slice(0,1600),requests:window.__staffRequests?.map(r=>r.path)})",
    ),
  );
  throw error;
} finally {
  client.close();
  await fetch("http://127.0.0.1:" + debugPort + "/json/close/" + page.id).catch(() => undefined);
}
