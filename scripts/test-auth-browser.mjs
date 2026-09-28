import assert from "node:assert/strict";

const baseUrl = process.argv[2] ?? "http://localhost:8081";
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
  const point = await client.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing input");
    const rect = input.getBoundingClientRect();
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
  await client.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "a",
    code: "KeyA",
    modifiers: 2,
  });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA" });
  await client.call("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Backspace",
    code: "Backspace",
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Backspace",
    code: "Backspace",
  });
  await client.call("Input.insertText", { text: value });
  await waitFor(
    client,
    `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
    `${selector} value`,
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

const page = await openDebugPage();
const client = new CdpClient(page.webSocketDebuggerUrl);

try {
  await client.connect();
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      new MutationObserver(() => {
        if (document.body?.innerText.includes("Good morning")) {
          sessionStorage.setItem("__attendai_dashboard_seen", "1");
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    `,
  });

  await navigate(client, "/");
  await client.evaluate(`localStorage.clear(); sessionStorage.clear()`);
  await navigate(client, "/");
  await waitForPath(client, "/login");
  await waitForLoginForm(client);
  const fresh = await client.evaluate(`({
    email: document.querySelector("#email")?.value,
    password: document.querySelector("#password")?.value,
    emailAutocomplete: document.querySelector("#email")?.autocomplete,
    passwordAutocomplete: document.querySelector("#password")?.autocomplete,
    dashboardSeen: sessionStorage.getItem("__attendai_dashboard_seen"),
    overlay: Boolean(document.querySelector(".vite-error-overlay, #webpack-dev-server-client-overlay")),
    bodyLength: document.body.innerText.trim().length,
  })`);
  assert.equal(fresh.email, "");
  assert.equal(fresh.password, "");
  assert.equal(fresh.emailAutocomplete, "email");
  assert.equal(fresh.passwordAutocomplete, "current-password");
  assert.equal(fresh.dashboardSeen, null);
  assert.equal(fresh.overlay, false);
  assert.ok(fresh.bodyLength > 0);

  await client.evaluate(`document.querySelector('a[href="/create-account"]')?.click()`);
  await waitForPath(client, "/create-account");
  await waitFor(
    client,
    `Boolean(document.querySelector("#full-name") && document.querySelector("#work-email") && document.querySelector("#institution-name") && document.querySelector("#institution-code") && document.querySelector("#new-password") && document.querySelector("#confirm-password"))`,
    "new institution account form",
  );
  const createAccountState = await client.evaluate(`({
    body: document.body.innerText,
    roleInputs: document.querySelectorAll('input[type="radio"], select').length,
    overlay: Boolean(document.querySelector(".vite-error-overlay, #webpack-dev-server-client-overlay")),
  })`);
  assert.equal(createAccountState.body.includes("Create your AttendAI institution account"), true);
  assert.equal(createAccountState.body.includes("Faculty and staff are invited later."), true);
  assert.equal(createAccountState.roleInputs, 0);
  assert.equal(createAccountState.overlay, false);

  await navigate(client, "/login");
  await waitForLoginForm(client, "login form after create-account navigation");

  await submitLogin(client, "nobody@example.invalid", "wrong-password");
  await sleep(500);
  const invalidState = await client.evaluate(`({
    pathname: location.pathname,
    body: document.body.innerText,
    email: document.querySelector("#email")?.value,
    passwordLength: document.querySelector("#password")?.value.length,
  })`);
  if (!invalidState.body.includes("Invalid email or password")) {
    throw new Error(`Unexpected invalid-login state: ${JSON.stringify(invalidState)}`);
  }
  await waitFor(
    client,
    `document.body.innerText.includes("Invalid email or password")`,
    "invalid-login error",
  );
  assert.equal(await client.evaluate(`location.pathname`), "/login");

  await navigate(client, "/login");
  await waitForLoginForm(client, "login form for student rejection");
  await submitLogin(client, "john.doe@student.edu", "student-password");
  await waitFor(
    client,
    `document.body.innerText.includes("available only to administrators, faculty, and staff")`,
    "student portal rejection",
  );
  assert.equal(await client.evaluate(`location.pathname`), "/login");

  await navigate(client, "/login");
  await waitForLoginForm(client);
  await submitLogin(client, "admin@attendai.com", "account-a-password");
  await waitForPath(client, "/");
  await waitFor(client, `document.body.innerText.includes("Good morning")`, "Account A dashboard");
  assert.equal(await client.evaluate(`document.body.innerText.includes("System Admin")`), true);

  await client.call("Page.reload", { ignoreCache: true });
  await waitForPath(client, "/");
  await waitFor(client, `document.body.innerText.includes("Good morning")`, "restored dashboard");

  await navigate(client, "/login");
  await waitForPath(client, "/");
  await waitFor(
    client,
    `Boolean(document.querySelector('button[title="Logout"]'))`,
    "authenticated shell after login-route redirect",
  );

  await client.evaluate(`document.querySelector('button[title="Logout"]').click()`);
  await waitForPath(client, "/login");
  await waitForLoginForm(client, "login form after logout");
  const afterLogout = await client.evaluate(`({
    email: document.querySelector("#email")?.value,
    password: document.querySelector("#password")?.value,
    mockSession: localStorage.getItem("mock_auth_session"),
  })`);
  assert.deepEqual(afterLogout, { email: "", password: "", mockSession: null });

  for (const path of [
    "/dashboard",
    "/attendance",
    "/students",
    "/analytics",
    "/interventions",
    "/messages",
    "/voice-calls",
  ]) {
    await navigate(client, path);
    await waitForPath(client, "/login");
    assert.equal(await client.evaluate(`document.body.innerText.includes("Good morning")`), false);
  }

  await waitForLoginForm(client, "login form for Account B");
  await submitLogin(client, "s.jenkins@attendai.com", "different-account-b-password");
  await waitForPath(client, "/");
  await waitFor(client, `document.body.innerText.includes("Good morning")`, "Account B dashboard");
  assert.equal(
    await client.evaluate(`document.body.innerText.includes("Dr. Sarah Jenkins")`),
    true,
  );

  console.log("Auth browser verification passed", {
    freshLogin: true,
    createAccountRoute: true,
    noPublicRoleSelection: true,
    emptyCredentials: true,
    invalidCredentialsRejected: true,
    studentAccountRejected: true,
    accountALogin: true,
    refreshRestored: true,
    authenticatedLoginRedirected: true,
    logoutClearedSession: true,
    protectedRoutesChecked: 7,
    accountBLogin: true,
  });
} finally {
  client.close();
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${page.id}`).catch(() => undefined);
}
