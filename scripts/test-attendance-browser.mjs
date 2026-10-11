import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.argv[2] ?? "http://localhost:8081";
const debugPort = process.argv[3] ?? "9222";
const state = JSON.parse(readFileSync(join(tmpdir(), "attendai-attendance-fixture.json"), "utf8"));
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${state.main.session.access_token}` } },
});
async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
async function saved(date) {
  const sessions = await checked(
    db.from("attendance_sessions").select("*").eq("class_id", state.classId).eq("date", date),
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].institution_id, state.institutionId);
  const records = await checked(
    db.from("attendance_records").select("*").eq("session_id", sessions[0].id),
  );
  assert.equal(records.length, 3);
  return { session: sessions[0], records };
}
const storageKey = `sb-${new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const page = await (
  await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(baseUrl)}`, {
    method: "PUT",
  })
).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
const exceptions = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown")
    exceptions.push(message.params.exceptionDetails.text);
  if (!message.id) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  message.error ? request.reject(message.error) : request.resolve(message.result);
});
function call(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression, description) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await pause(200);
  }
  throw new Error(`Timed out: ${description}; ${await evaluate("document.body.innerText")}`);
}
async function chooseClass() {
  await wait('Boolean(document.querySelector("button[role=combobox]"))', "class selector");
  await evaluate('document.querySelector("button[role=combobox]").click()');
  await wait(
    'Array.from(document.querySelectorAll("[role=option]")).some(el=>el.textContent.trim()==="CSE-A")',
    "CSE-A dropdown option",
  );
  await evaluate(
    'Array.from(document.querySelectorAll("[role=option]")).find(el=>el.textContent.trim()==="CSE-A").click()',
  );
  await wait(
    'document.querySelectorAll("tbody tr").length===3 && document.body.innerText.includes("Student Three")',
    "three students",
  );
}
async function clickText(text) {
  await wait(
    `Array.from(document.querySelectorAll("button")).some(el=>el.textContent.trim()===${JSON.stringify(text)} && !el.disabled)`,
    `enabled ${text} button`,
  );
  await evaluate(
    `(()=>{const button=Array.from(document.querySelectorAll("button")).find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error("Button missing");button.click();})()`,
  );
}
async function setDate(date) {
  await evaluate(
    `(()=>{const input=document.querySelector('input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(date)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await pause(500);
  await wait('document.querySelectorAll("tbody tr").length===3', "register after date change");
}
async function mark(labels) {
  for (const [index, name] of ["Student One", "Student Two", "Student Three"].entries()) {
    await evaluate(
      `(()=>{const row=Array.from(document.querySelectorAll('tbody tr')).find(el=>el.innerText.includes(${JSON.stringify(name)}));Array.from(row.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(labels[index])}).click();})()`,
    );
  }
  await pause(200);
}
async function save(button, title) {
  await clickText(button);
  await wait(`document.body.innerText.includes(${JSON.stringify(title)})`, title);
  await clickText("Close");
}
try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify(state.main.session))});`,
  });
  await call("Page.navigate", { url: `${baseUrl}/attendance` });
  await chooseClass();
  assert.equal(await evaluate('document.querySelector("input[type=date]").value'), state.date);
  await setDate(state.firstSubmissionDate);
  await wait('document.body.innerText.includes("Submit Register")', "new register");
  await mark(["P", "A", "P"]);
  await save("Submit Register", "Register Submitted");
  const first = await saved(state.firstSubmissionDate);
  assert.deepEqual(
    [first.session.total_present, first.session.total_absent, first.session.total_late],
    [2, 1, 0],
  );
  console.log("PASS: first UI submission created one session and three records", {
    date: state.firstSubmissionDate,
    sessionId: first.session.id,
  });
  await setDate(state.date);
  await wait('document.body.innerText.includes("Saved attendance loaded")', "existing register");
  await mark(["P", "A", "P"]);
  await save("Save Changes", "Register Updated");
  const baseline = await saved(state.date);
  assert.deepEqual(
    [baseline.session.total_present, baseline.session.total_absent, baseline.session.total_late],
    [2, 1, 0],
  );
  await mark(["P", "P", "L"]);
  const counts = await evaluate("document.body.innerText");
  for (const [label, count] of [
    ["Present", 2],
    ["Absent", 0],
    ["Late", 1],
    ["Unmarked", 0],
  ])
    assert.match(counts, new RegExp(`${label}\\s+${count}`, "i"));
  // Search must never truncate the saved register.
  await evaluate(
    '(()=>{const input=Array.from(document.querySelectorAll("input")).find(el=>el.placeholder.startsWith("Search name"));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Student One");input.dispatchEvent(new Event("input",{bubbles:true}));})()',
  );
  await save("Save Changes", "Register Updated");
  await save("Save Changes", "Register Updated");
  const final = await saved(state.date);
  assert.equal(final.session.id, baseline.session.id);
  assert.deepEqual(final.records.map((r) => r.id).sort(), baseline.records.map((r) => r.id).sort());
  assert.deepEqual(
    [final.session.total_present, final.session.total_absent, final.session.total_late],
    [2, 0, 1],
  );
  for (const [index, status] of ["present", "present", "late"].entries())
    assert.equal(
      final.records.find((r) => r.student_id === state.students[index].id).status,
      status,
    );
  await call("Page.reload", { ignoreCache: true });
  await chooseClass();
  await wait(
    'document.body.innerText.includes("Saved attendance loaded")',
    "saved register after refresh",
  );
  for (const [name, status] of [
    ["Student One", "present"],
    ["Student Two", "present"],
    ["Student Three", "late"],
  ]) {
    const row = await evaluate(
      `Array.from(document.querySelectorAll("tbody tr")).find(el=>el.innerText.includes(${JSON.stringify(name)})).innerText`,
    );
    assert.ok(row.includes(status));
  }
  assert.deepEqual(exceptions, []);
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  const screenshotPath = join(tmpdir(), "attendai-attendance-verified.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log(
    "PASS: real user JWT, CSE-A dropdown, three students, correction to present/present/late, counters 2/0/1/0, repeated save keeps one session and stable record IDs, complete register saved despite search, refresh restores saved statuses, no browser exceptions.",
    { date: state.date, screenshotPath },
  );
} finally {
  socket.close();
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${page.id}`).catch(() => undefined);
}
