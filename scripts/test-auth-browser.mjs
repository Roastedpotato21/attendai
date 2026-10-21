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

// Browser fixtures intercept Supabase requests; no synthetic production writes.
function installSupabaseFixture() {
  const realFetch = window.fetch.bind(window);
  window.__fixtureRequests = [];
  window.__otpRequests = [];
  const user = {
    id: "90000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "applicant@fixture.invalid",
    email_confirmed_at: "2020-01-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { name: "Fixture Representative" },
    identities: [{ id: "fixture-identity", provider: "email" }],
    created_at: "2020-01-01T00:00:00Z",
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
          sub: user.id,
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: "authenticated",
        }),
      ) +
      ".fixture",
    refresh_token: "fixture-refresh-token",
  });
  const application = {
    id: "90000000-0000-4000-8000-000000000010",
    institution_id: "90000000-0000-4000-8000-000000000020",
    institution_name: "Fictional Browser College",
    institution_type: "College",
    state: "Fixture State",
    city: "Fixture City",
    applicant_name: "Fixture Representative",
    account_email: user.email,
    applicant_phone: "+919000000001",
    leadership_role: "secretary",
    designation: "Authorized Secretary",
    status: "pending_manual_review",
    registry_confidence: "needs_review",
    matched_sources: [],
    registry_id: null,
    decision_reason: null,
    revision: 1,
    submitted_at: "2020-01-01T00:00:00Z",
  };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    const endpoint = url.pathname.match(/\/(auth|rest|storage)\/v1\//);
    if (!endpoint) return realFetch(input, init);
    const path = url.pathname.slice(endpoint.index);
    window.__fixtureRequests.push(path);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (v, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/auth/v1/user") return json(user);
    if (path === "/auth/v1/logout") return json({});
    if (path === "/auth/v1/signup")
      return json({ user: { ...user, email_confirmed_at: null }, session: null });
    if (path === "/auth/v1/verify") {
      window.__otpRequests.push({
        email: body.email,
        type: body.type,
        validFixture: body.token === "731942",
      });
      if (body.token !== "731942" || body.email !== user.email || body.type !== "email")
        return json({ code: "otp_expired", msg: "Token has expired or is invalid" }, 403);
      return json(session());
    }
    if (path === "/auth/v1/resend") {
      window.__otpRequests.push({ email: body.email, type: body.type });
      return json({});
    }
    if (path === "/auth/v1/token") {
      if (body.email !== user.email || body.password !== "fixture-pending-password")
        return json({ code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      return json(session());
    }
    if (path.endsWith("/rpc/search_institution_registry")) {
      if (body.p_query.includes("Unlisted")) return json([]);
      return json(
        ["Fixture State", "Other Fixture State"].map((state, i) => ({
          id: "90000000-0000-4000-8000-00000000003" + i,
          canonical_name: "Fictional Browser College",
          state,
          institution_type: "College",
          aishe_code: "C-FIXTURE-" + i,
          city: "Fixture City",
          official_website: null,
          sources: ["aishe"],
        })),
      );
    }
    if (path.endsWith("/rpc/my_institution_verification_access"))
      return json({
        allowed: true,
        can_apply: false,
        reviewer: false,
        application_id: application.id,
        status: application.status,
      });
    if (path.endsWith("/rpc/is_verification_reviewer")) return json(false);
    if (path.endsWith("/rpc/my_policy_status"))
      return json(
        ["terms", "privacy"].map((type, i) => ({
          id: "fixture-policy-" + i,
          type,
          version: "2026-10-15.1",
          accepted: true,
        })),
      );
    if (path === "/rest/v1/profiles")
      return json({
        id: user.id,
        name: "Fixture Representative",
        email: user.email,
        status: "active",
      });
    if (path === "/rest/v1/profile_institutions") return json([]);
    if (path === "/rest/v1/institution_verification_applications") return json(application);
    if (path === "/rest/v1/institution_verification_evidence") return json([]);
    throw new Error("Unconfigured isolated Supabase request: " + path);
  };
}
const page = await openDebugPage();
const client = new CdpClient(page.webSocketDebuggerUrl);
const clickButton = async (text) =>
  client.evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(" +
      JSON.stringify(text) +
      ")).click()",
  );
try {
  await client.connect();
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: "(" + installSupabaseFixture.toString() + ")();",
  });
  await navigate(client, "/login");
  await client.evaluate("localStorage.clear();sessionStorage.clear()");
  await navigate(client, "/dashboard");
  await waitForPath(client, "/login");
  await waitForLoginForm(client);
  assert.deepEqual(
    await client.evaluate(
      "({email:document.querySelector('#email').value,password:document.querySelector('#password').value})",
    ),
    { email: "", password: "" },
  );
  await navigate(client, "/create-account");
  await waitFor(
    client,
    "Boolean(document.querySelector('#institution-search'))",
    "registry search",
  );
  await fill(client, "#institution-search", "Fictional College");
  await clickButton("Search official registry");
  await waitFor(
    client,
    "document.body.innerText.includes('Several official records may match')",
    "ambiguous official matches",
  );
  await client.evaluate("document.querySelector('li button').click()");
  await waitFor(client, "Boolean(document.querySelector('#full-name'))", "identity form");
  assert.equal(
    await client.evaluate("Boolean(document.querySelector('#institution-code'))"),
    false,
  );
  assert.equal(
    await client.evaluate(
      "document.body.innerText.includes('It does not make you an institution administrator')",
    ),
    true,
  );
  await fill(client, "#full-name", "Fixture Representative");
  await fill(client, "#work-email", "applicant@fixture.invalid");
  await fill(client, "#new-password", "fixture-pending-password");
  await fill(client, "#confirm-password", "fixture-pending-password");
  await client.evaluate("document.querySelectorAll('input[type=checkbox]').forEach(e=>e.click())");
  await client.evaluate("document.querySelector('button[type=submit]').click()");
  await waitFor(
    client,
    "document.body.innerText.includes('Check your email')",
    "email verification",
  );
  assert.equal(
    await client.evaluate(
      "window.__fixtureRequests.some(p=>p.includes('provision_my_new_institution'))",
    ),
    false,
  );
  await waitFor(
    client,
    "Boolean(document.querySelector('#email-verification-code'))",
    "signup code slots",
  );
  assert.equal(
    await client.evaluate("document.querySelector('#email-verification-code').autocomplete"),
    "one-time-code",
  );
  assert.equal(
    await client.evaluate("document.querySelector('#verification-email').value"),
    "applicant@fixture.invalid",
  );
  const pasteCode = async (code) =>
    client.evaluate(
      `(()=>{const input=document.querySelector('#email-verification-code');input.focus();const data=new DataTransfer();data.setData('text',${JSON.stringify(code)});input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));})()`,
    );
  await pasteCode("12");
  assert.ok(
    await client.evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Verify email code')).disabled",
    ),
  );
  await client.evaluate(
    "document.querySelector('#email-verification-code').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}))",
  );
  await pasteCode("000000");
  await clickButton("Verify email code");
  await waitFor(
    client,
    "document.body.innerText.includes('This code could not be verified')",
    "expired code feedback",
  );
  await waitFor(
    client,
    "document.querySelectorAll('.code-slots__slot[data-filled]').length===0",
    "error drains digits",
  );
  await clickButton("Request another verification email");
  await waitFor(
    client,
    "document.body.innerText.includes('a new verification email has been requested')",
    "honest resend request status",
  );
  assert.ok(
    await client.evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Request another email in')).disabled",
    ),
  );
  assert.equal(
    await client.evaluate("window.__otpRequests.filter(r=>r.type==='signup').length"),
    1,
  );
  await navigate(client, "/create-account");
  await waitFor(client, "Boolean(document.querySelector('#institution-search'))", "manual search");
  await fill(client, "#institution-search", "Unlisted Fixture");
  await clickButton("Search official registry");
  await waitFor(
    client,
    "document.body.innerText.includes('does not mean your institution is invalid')",
    "manual fallback",
  );
  await clickButton("Institution not found");
  await waitFor(client, "Boolean(document.querySelector('#full-name'))", "manual applicant form");
  await navigate(client, "/login");
  await waitForLoginForm(client);
  await submitLogin(client, "nobody@fixture.invalid", "wrong-password");
  await waitFor(
    client,
    "document.body.innerText.includes('Invalid email or password')",
    "invalid password",
  );
  await submitLogin(client, "applicant@fixture.invalid", "fixture-pending-password");
  await waitForPath(client, "/institution-verification");
  await navigate(client, "/");
  await waitFor(
    client,
    "Boolean(document.querySelector('.aw-portal'))",
    "public opening for pending applicants",
  );
  assert.equal(await client.evaluate("location.pathname"), "/");
  await navigate(client, "/institution-verification");
  await waitFor(
    client,
    "document.body.innerText.includes('Pending verification')",
    "pending status",
  );
  for (const path of [
    "/dashboard",
    "/students",
    "/faculty",
    "/attendance",
    "/messages",
    "/voice-calls",
  ]) {
    await navigate(client, path);
    await waitForPath(client, "/institution-verification");
    await waitFor(
      client,
      "document.body.innerText.includes('Pending verification')",
      "pending URL gate",
    );
    assert.equal(await client.evaluate("Boolean(document.querySelector('aside'))"), false);
  }
  await navigate(client, "/institution-review");
  await waitFor(
    client,
    "document.body.innerText.includes('Platform reviewer access required')",
    "reviewer denial",
  );
  await navigate(client, "/privacy");
  await waitFor(client, "document.body.innerText.includes('Privacy Policy')", "legal page");
  await navigate(client, "/institution-verification");
  await waitFor(
    client,
    "document.body.innerText.includes('Pending verification')",
    "status reload",
  );
  await clickButton("Sign out");
  await waitForPath(client, "/login");
  await waitForLoginForm(client);
  await navigate(client, "/attendance");
  await waitForPath(client, "/login");
  await navigate(client, "/institution-verification");
  await waitFor(
    client,
    "Boolean(document.querySelector('#email-verification-code'))",
    "code entry after reload",
  );
  assert.equal(
    await client.evaluate("document.querySelector('#email-verification-code').value"),
    "",
  );
  await fill(client, "#verification-email", "applicant@fixture.invalid");
  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pasteCode("731942");
  await waitFor(
    client,
    "document.querySelectorAll('.code-slots__slot[data-filled]').length===6",
    "pasted digits in slots",
  );
  assert.ok(
    await client.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "Mobile OTP fits",
  );
  await clickButton("Verify email code");
  await waitFor(
    client,
    "document.body.innerText.includes('Email verified.')",
    "real verification response required",
  );
  assert.ok(
    await client.evaluate(
      "document.body.innerText.includes('institution still requires independent review')",
    ),
  );
  await client.evaluate(
    "Array.from(document.querySelectorAll('a')).find(a=>a.textContent.includes('Continue institution verification')).click()",
  );
  await waitFor(
    client,
    "document.body?.innerText.includes('Pending verification')",
    "OTP enters pending workflow",
  );
  assert.equal(
    await client.evaluate(
      "window.__fixtureRequests.some(p=>p.includes('provision_my_new_institution'))",
    ),
    false,
  );
  console.log(
    "Auth browser checks passed: empty credentials; ambiguous registry search; manual fallback; identity-only signup; invalid password; pending login/reload; six URL gates; reviewer denial; legal access; logout. All Supabase responses used isolated browser fixtures.",
  );
} finally {
  client.close();
  await fetch("http://127.0.0.1:" + debugPort + "/json/close/" + page.id).catch(() => undefined);
}
