/** Browser smoke test. Invitation responses are fixtures; no live enrollment or FCM send. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GUARDIAN_NOTIFICATION_CONSENT_VERSION } from "../src/lib/guardian-consent.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const origin = new URL(process.argv[2] ?? "http://127.0.0.1:4317");
const deploymentSmoke =
  process.argv.includes("--deployment-smoke") &&
  origin.protocol === "https:" &&
  origin.origin === new URL(process.env.ATTENDAI_APP_URL).origin;
assert.ok(
  ["127.0.0.1", "localhost"].includes(origin.hostname) || deploymentSmoke,
  "Use localhost or explicitly select the configured deployment with --deployment-smoke",
);
const temporaryRoot = resolve(root, ".tmp");
await mkdir(temporaryRoot, { recursive: true });
const profile = await mkdtemp(resolve(temporaryRoot, "guardian-browser-"));
const preview = process.argv[2]
  ? null
  : spawn(process.execPath, ["--env-file-if-exists=.env", "scripts/preview.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: origin.port,
        HOST: origin.hostname,
        FCM_DELIVERY_MODE: "disabled",
        SMS_DELIVERY_MODE: "disabled",
      },
      windowsHide: true,
      stdio: "ignore",
    });
const chrome = spawn(
  process.env.ATTENDAI_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let startupError;
preview?.on("error", (error) => {
  startupError = error;
});
chrome.on("error", (error) => {
  startupError = error;
});

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.handlers = new Map();
    this.nextId = 1;
    this.errors = [];
  }
  async connect() {
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        const handler = this.handlers.get(message.method);
        if (handler)
          void Promise.resolve(handler(message.params)).catch((error) => this.errors.push(error));
      }
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? "Browser evaluation failed",
      );
    return result.result.value;
  }
}

const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function until(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${description}`);
}

let cdp;
try {
  await until(async () => {
    if (startupError) throw startupError;
    if (preview && preview.exitCode !== null)
      throw new Error("Private preview stopped before browser testing");
    try {
      return (await fetch(new URL("/guardian-notifications", origin))).ok;
    } catch {
      return false;
    }
  }, "private production preview startup");
  let debugPort;
  await until(async () => {
    if (startupError) throw startupError;
    try {
      debugPort = Number(
        (await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0],
      );
      return Boolean(debugPort);
    } catch {
      return false;
    }
  }, "temporary Chrome startup");
  const target = await (
    await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })
  ).json();
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1024,
    height: 1280,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const browserErrors = [];
  cdp.handlers.set("Runtime.exceptionThrown", (event) =>
    browserErrors.push(event.exceptionDetails.text),
  );

  for (const [path, title] of [
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms &amp; Conditions"],
  ]) {
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, `${path} renders in the built preview`);
    const policyHtml = await response.text();
    assert.ok(policyHtml.includes(title), `${path} includes its policy title`);
    assert.ok(
      policyHtml.includes("Product draft pending final institutional and legal review."),
      `${path} states its review status`,
    );
  }
  const manifestResponse = await fetch(new URL("/guardian-notifications.webmanifest", origin));
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get("content-type"), /application\/manifest\+json/);
  assert.equal((await manifestResponse.json()).display, "standalone");

  const invitation = randomBytes(32).toString("base64url");
  let valid = true;
  let validateCalls = 0;
  let enrollmentCalls = 0;
  cdp.handlers.set("Fetch.requestPaused", async ({ requestId, request }) => {
    const input = JSON.parse(request.postData ?? "{}");
    const path = new URL(request.url).pathname;
    let response;
    if (path.endsWith("/validate")) {
      validateCalls += 1;
      assert.equal(
        input.invitation === invitation,
        true,
        "Private capability reaches validation only",
      );
      response = valid
        ? {
            valid: true,
            institution: "AttendAI Browser Test Institution",
            students: ["Student One"],
            consentVersion: GUARDIAN_NOTIFICATION_CONSENT_VERSION,
          }
        : { valid: false };
    } else {
      if (path.endsWith("/enroll")) enrollmentCalls += 1;
      response = { enabled: false };
    }
    await cdp.call("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(response)).toString("base64"),
    });
  });
  await cdp.call("Fetch.enable", {
    patterns: [{ urlPattern: new URL("/api/guardian/notifications/*", origin).toString() }],
  });
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    window.__guardianPermissionCalls = 0;
    window.__guardianUserGesture = false;
    if (window.Notification) Object.defineProperty(Notification, "requestPermission", {
      configurable: true, value: () => {
        window.__guardianPermissionCalls++;
        window.__guardianUserGesture = navigator.userActivation.isActive;
        return Promise.resolve("denied");
      }
    });
  `,
  });
  const temporaryUrl = new URL("/guardian-notifications", origin);
  temporaryUrl.hash = `invite=${invitation}`;
  await cdp.call("Page.navigate", { url: temporaryUrl.toString() });
  await until(
    () => cdp.evaluate(`Boolean(document.querySelector('input[type="checkbox"]'))`),
    "consent page hydration",
  );
  assert.equal(validateCalls, 1);
  assert.equal(await cdp.evaluate("location.hash"), "", "Invitation removed from browser location");
  assert.equal(
    await cdp.evaluate("window.__guardianPermissionCalls"),
    0,
    "No permission prompt on load",
  );
  assert.equal(
    await cdp.evaluate(`document.querySelector('input[type="checkbox"]').checked`),
    false,
  );
  assert.equal(
    await cdp.evaluate(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Enable Notifications').disabled`,
    ),
    true,
  );
  const visibleText = await cdp.evaluate("document.body.innerText");
  assert.ok(
    visibleText.includes("AttendAI Browser Test Institution") &&
      visibleText.includes("Student One"),
  );
  assert.ok(!visibleText.includes("Student Two"));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(visibleText), "No internal IDs displayed");
  assert.equal(
    await cdp.evaluate(`new URL(document.querySelector('a[href="/privacy"]').href).origin`),
    origin.origin,
  );

  const workerName = (await readdir(resolve(root, ".output/public/assets"))).find((name) =>
    /^firebase-messaging-sw-[\w-]+\.js$/.test(name),
  );
  assert.ok(workerName, "Built Firebase worker exists");
  const workerUrl = new URL(`/assets/${workerName}`, origin);
  const workerResponse = await fetch(workerUrl);
  assert.equal(workerResponse.status, 200);
  assert.equal(workerResponse.headers.get("service-worker-allowed"), "/");
  const scope = await cdp.evaluate(`(async () => {
    await navigator.serviceWorker.register(${JSON.stringify(workerUrl.toString())}, { type: 'module', scope: '/' });
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  })()`);
  assert.equal(scope, `${origin.origin}/`, "Real browser worker registration covers guardian page");

  async function click(expression) {
    const point = await cdp.evaluate(
      `(() => { const rect = (${expression}).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`,
    );
    await cdp.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await cdp.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
  }
  await click(`document.querySelector('input[type="checkbox"]')`);
  await until(
    () =>
      cdp.evaluate(
        `!Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Enable Notifications').disabled`,
      ),
    "consent enables button",
  );
  await click(
    `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Enable Notifications')`,
  );
  await until(
    () => cdp.evaluate(`document.body.innerText.includes('Permission denied.')`),
    "permission denial feedback",
  );
  assert.equal(await cdp.evaluate("window.__guardianPermissionCalls"), 1);
  assert.equal(
    await cdp.evaluate("window.__guardianUserGesture"),
    true,
    "Permission requested during user click",
  );
  assert.equal(enrollmentCalls, 0, "Denied permission creates no device enrollment");

  valid = false;
  await cdp.call("Page.navigate", { url: "about:blank" });
  await until(
    () => cdp.evaluate("location.href === 'about:blank' && document.readyState === 'complete'"),
    "fresh page for invalid invitation",
  );
  await cdp.call("Page.navigate", { url: temporaryUrl.toString() });
  await until(
    () => cdp.evaluate(`document.body.innerText.includes('No active device or valid invitation.')`),
    "invalid invitation feedback",
  );
  assert.equal(
    await cdp.evaluate(`document.querySelector('input[type="checkbox"]') === null`),
    true,
  );
  assert.equal(await cdp.evaluate("document.body.innerText.includes('Student One')"), false);
  valid = true;
  await cdp.evaluate(`(() => {
    const input = document.querySelector('#guardian-invitation');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(temporaryUrl.toString())});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until(
    () =>
      cdp.evaluate(
        `!Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Open enrollment link').disabled`,
      ),
    "pasted invitation ready",
  );
  await click(
    `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Open enrollment link')`,
  );
  await until(
    () => cdp.evaluate(`Boolean(document.querySelector('input[type="checkbox"]'))`),
    "pasted invitation reloads consent page",
  );
  assert.equal(
    await cdp.evaluate(`document.querySelector('input[type="checkbox"]').checked`),
    false,
  );
  assert.equal(await cdp.evaluate("location.hash"), "");
  assert.equal(validateCalls, 3);
  await cdp.evaluate(
    `(async () => Promise.all((await navigator.serviceWorker.getRegistrations()).map(registration => registration.unregister())))()`,
  );
  assert.deepEqual(cdp.errors, []);
  assert.deepEqual(browserErrors, []);
  console.log(
    "PASS: policy pages, manifest, browser worker root scope, unchecked consent, direct-click permission timing, denial, invalid links and pasted-link revalidation.",
  );
  console.log(
    "Invitation context and permission denial used isolated fixtures; no live guardian enrollment or provider send.",
  );
} finally {
  if (cdp) {
    await cdp.call("Browser.close").catch(() => {});
    cdp.socket.close();
  }
  if (chrome.exitCode === null) chrome.kill();
  if (preview && preview.exitCode === null) preview.kill();
  await pause(500);
  assert.ok(
    profile.startsWith(`${temporaryRoot}${sep}guardian-browser-`),
    "Cleanup stays inside temporary workspace",
  );
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  console.log("Temporary browser profile and invitation fixture removed.");
  if (preview) console.log("Private preview stopped.");
}
