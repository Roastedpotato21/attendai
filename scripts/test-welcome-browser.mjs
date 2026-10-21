/** Local public-page checks. External requests are intercepted; no production API calls. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:4195");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Use a local preview");
const port = process.argv[3] ?? "9339";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.id = 0;
  }
  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data),
        pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = ++this.id;
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
    if (result.exceptionDetails)
      throw Error(result.exceptionDetails.exception?.description ?? "Evaluation failed");
    return result.result.value;
  }
}

const page = await (
  await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
).json();
const client = new Cdp(page.webSocketDebuggerUrl);
await client.connect();
const errors = [],
  nonlocalWrites = [];
client.socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown")
    errors.push(message.params.exceptionDetails.text);
  if (message.method === "Fetch.requestPaused") {
    const { request, requestId } = message.params;
    if (new URL(request.url).origin === base.origin) {
      void client.call("Fetch.continueRequest", { requestId });
    } else {
      if (!["GET", "HEAD"].includes(request.method)) nonlocalWrites.push(request.method);
      // Existing root font stylesheets may be requested. Never contact a remote API.
      void client.call("Fetch.fulfillRequest", { requestId, responseCode: 200, body: "" });
    }
  }
});
async function until(expression, description) {
  for (let n = 0; n < 200; n++) {
    if (await client.evaluate(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw Error(`Timed out: ${description}`);
}
async function navigate(path) {
  await client.call("Page.navigate", { url: new URL(path, base).href });
  await until(
    `document.readyState === 'complete' && location.pathname === ${JSON.stringify(path)}`,
    path,
  );
}
async function welcome(width = 1440, height = 1000) {
  await client.call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await navigate("/welcome");
  await until(
    `document.querySelector('.aw-portal')?.dataset.portalReady === 'true'`,
    "ready portal",
  );
  await client.evaluate("scrollTo(0,0)");
  await sleep(150);
}
async function section(id) {
  await client.evaluate(`document.getElementById(${JSON.stringify(id)}).scrollIntoView()`);
  await sleep(250);
}
async function key(key) {
  const code = { Enter: 13, Escape: 27, Home: 36, ArrowRight: 39 }[key];
  await client.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: key,
    text: key === "Enter" ? "\r" : undefined,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    windowsVirtualKeyCode: code,
    nativeVirtualKeyCode: code,
  });
}
try {
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.bringToFront");
  await client.call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    window.__welcomeMetrics = { cls: 0, longTasks: [] };
    new PerformanceObserver(list => list.getEntries().forEach(e => {
      if (!e.hadRecentInput) window.__welcomeMetrics.cls += e.value;
    })).observe({type:'layout-shift', buffered:true});
    new PerformanceObserver(list => list.getEntries().forEach(e => window.__welcomeMetrics.longTasks.push(e.duration)))
      .observe({type:'longtask', buffered:true});
  `,
  });

  const html = await (await fetch(new URL("/welcome", base))).text();
  assert.ok(
    html.includes("Attendance,") && html.includes("AttendAI"),
    "Public content is server rendered",
  );
  await welcome();
  await navigate("/");
  await until(
    `document.querySelector('.aw-portal')?.dataset.portalReady === 'true'`,
    "root landing opening",
  );
  await sleep(200);
  assert.equal(await client.evaluate("location.pathname"), "/", "Home stays public");
  assert.equal(
    await client.evaluate(`document.querySelector('[data-portal-art] text').textContent.trim()`),
    "AttendAI",
  );
  assert.ok(
    await client.evaluate(
      `document.fonts.check('500 20px "Attend Sans"') && document.fonts.check('700 100px "Attend Portal"')`,
    ),
  );
  assert.equal(
    await client.evaluate(`document.querySelector('h1').textContent`),
    "Attendance,without theadministrative noise.",
  );
  assert.equal(await client.evaluate(`document.querySelectorAll('.aw-desktop-nav a').length`), 6);

  await client.evaluate(`document.querySelector('[data-portal-letter="0"]').focus()`);
  await key("ArrowRight");
  assert.equal(await client.evaluate(`document.activeElement.dataset.portalLetter`), "1");
  assert.equal(
    await client.evaluate(`document.activeElement.getAttribute('aria-checked')`),
    "true",
  );
  await key("Home");
  const initial = await client.evaluate(
    `document.querySelector('[data-portal-art] clipPath').getAttribute('transform')`,
  );
  await client.evaluate("scrollTo(0,1000)");
  await sleep(100);
  assert.notEqual(
    await client.evaluate(
      `document.querySelector('[data-portal-art] clipPath').getAttribute('transform')`,
    ),
    initial,
  );
  assert.equal(await client.evaluate(`document.querySelector('.aw-portal-front').inert`), true);
  await section("homepage");
  assert.equal(
    await client.evaluate(
      `getComputedStyle(document.querySelector('[data-portal-field]')).clipPath`,
    ),
    "none",
  );
  await until(
    `document.querySelector('.aw-hero .aw-circuit').dataset.running === 'true'`,
    "live hero wires",
  );
  const pulse = await client.evaluate(
    `getComputedStyle(document.querySelector('.aw-hero .aw-pulse')).strokeDashoffset`,
  );
  await sleep(100);
  assert.notEqual(
    await client.evaluate(
      `getComputedStyle(document.querySelector('.aw-hero .aw-pulse')).strokeDashoffset`,
    ),
    pulse,
  );

  for (const id of [
    "product",
    "attendance",
    "guardians",
    "solutions",
    "security",
    "docs",
    "pricing",
  ]) {
    await section(id);
    await until(
      `Array.from(document.getElementById(${JSON.stringify(id)}).querySelectorAll('[data-reveal]')).every(e=>e.classList.contains('aw-revealed'))`,
      `${id} revealed content`,
    );
  }
  await until(
    `document.querySelector('.aw-hero .aw-circuit').dataset.running === 'false'`,
    "offscreen wires paused",
  );
  assert.ok(
    await client.evaluate(
      `document.getElementById('pricing').textContent.includes('have not been published')`,
    ),
  );
  await section("docs");
  await client.evaluate(`document.querySelector('#docs summary').focus()`);
  await key("Enter");
  await until(`document.querySelector('#docs details').open`, "guide opened by keyboard");
  await sleep(450);
  const expandedHeight = await client.evaluate(
    `document.querySelector('#docs details').getBoundingClientRect().height`,
  );
  await key("Enter");
  await sleep(80);
  const closing = await client.evaluate(
    `({height:document.querySelector('#docs details').getBoundingClientRect().height,open:document.querySelector('#docs details').open,animated:document.querySelector('#docs details').getAnimations().length>0})`,
  );
  assert.ok(
    closing.animated && closing.open && closing.height < expandedHeight,
    "Docs closes with a visible height animation",
  );
  await until(`!document.querySelector('#docs details').open`, "guide closed after animation");
  assert.equal(
    await client.evaluate(`document.querySelectorAll('.aw-footer nav').length > 0`),
    true,
  );
  assert.equal(
    await client.evaluate(
      `Array.from(document.querySelectorAll('.attend-landing a[href^="#"]')).every(a=>document.getElementById(a.hash.slice(1)))`,
    ),
    true,
    "Every anchor resolves",
  );
  assert.ok(
    await client.evaluate(
      `Array.from(document.querySelectorAll('a')).filter(a=>a.textContent.includes('Get Started')).every(a=>a.getAttribute('href')==='/create-account')`,
    ),
  );

  for (const width of [320, 390, 768, 1024, 1440]) {
    await welcome(width, width < 600 ? 844 : 1000);
    for (const id of ["homepage", "product", "attendance", "guardians", "docs", "contact"]) {
      await section(id);
      assert.ok(
        await client.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`),
        `No overflow at ${width}px, ${id}`,
      );
    }
    assert.equal(
      await client.evaluate(
        `getComputedStyle(document.querySelector('.aw-device-wrap')).display !== 'none'`,
      ),
      true,
      "Device retained on mobile",
    );
    if (width === 390) {
      await section("homepage");
      await client.evaluate(`document.querySelector('.aw-mobile-toggle').click()`);
      assert.ok(
        await client.evaluate(
          `document.querySelector('.aw-mobile-toggle').getAttribute('aria-expanded') === 'true'`,
        ),
      );
      await key("Escape");
      assert.ok(
        await client.evaluate(
          `document.activeElement.classList.contains('aw-mobile-toggle') && !document.querySelector('.aw-mobile-nav')`,
        ),
      );
      await client.evaluate(`document.querySelector('.aw-mobile-toggle').click()`);
      await until(`document.querySelector('.aw-mobile-nav')`, "mobile menu reopened");
      await client.evaluate(`document.querySelector('.aw-mobile-nav a[href="#pricing"]').click()`);
      await sleep(1200);
      assert.equal(await client.evaluate(`document.activeElement.id`), "pricing");
      assert.equal(await client.evaluate(`!!document.querySelector('.aw-mobile-nav')`), false);
    }
  }

  await client.call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await welcome(390, 844);
  const contrastFailures = await client.evaluate(`(() => {
    const rgb = value => (value.match(/[\\d.]+/g) ?? []).map(Number);
    const luminance = color => color.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
    const failures = [], walker = document.createTreeWalker(document.querySelector('.attend-landing'), NodeFilter.SHOW_TEXT);
    for(let node; node=walker.nextNode();) {
      const e=node.parentElement;
      if(!node.textContent.trim() || e.closest('[aria-hidden="true"],svg,style,script') || !e.getClientRects().length) continue;
      const style=getComputedStyle(e);if(style.visibility==='hidden' || Number(style.opacity)===0)continue;
      const fg=rgb(style.color); let bg=[255,255,255]; const chain=[];
      for(let p=e;p;p=p.parentElement)chain.push(p);
      for(const p of chain.reverse()) { const c=rgb(getComputedStyle(p).backgroundColor), a=c[3]??1;bg=bg.map((v,i)=>(c[i]??0)*a+v*(1-a)); }
      const l1=luminance(fg),l2=luminance(bg),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
      const large=parseFloat(style.fontSize)>=24 || (parseFloat(style.fontSize)>=18.66 && Number(style.fontWeight)>=700);
      if(ratio < (large?2.99:4.49))failures.push({text:node.textContent.trim().slice(0,45),ratio,fg:style.color,bg});
    }
    return failures;
  })()`);
  assert.deepEqual(contrastFailures, [], "WCAG AA text contrast in the landing palette");
  assert.equal(
    await client.evaluate(`document.querySelector('.aw-portal').dataset.portalMotion`),
    "off",
  );
  assert.equal(
    await client.evaluate(`getComputedStyle(document.querySelector('[data-portal-pin]')).position`),
    "relative",
  );
  assert.equal(
    await client.evaluate(`getComputedStyle(document.querySelector('.aw-pulse')).animationName`),
    "none",
  );
  await client.evaluate(`document.querySelector('.aw-skip').focus()`);
  await key("Enter");
  await sleep(150);
  assert.equal(await client.evaluate(`document.activeElement.id`), "main-content");
  assert.equal(
    await client.evaluate(
      `document.querySelector('.aw-portal-content').offsetTop <= innerHeight + 1`,
    ),
    true,
    "No extended portal scroll in reduced motion",
  );
  await section("homepage");
  await client.evaluate(`document.querySelector('.aw-nav-start').click()`);
  await until(
    `location.pathname === '/create-account' && document.querySelector('input')`,
    "existing signup",
  );
  assert.ok(
    await client.evaluate(`!!document.querySelector('.aw-auth-signup')`),
    "Signup uses the shared theme",
  );
  await navigate("/welcome");
  await until(`document.querySelector('.aw-portal-signin')`, "opening sign-in link");
  await client.evaluate(`document.querySelector('.aw-portal-signin').click()`);
  await until(
    `location.pathname === '/login' && document.querySelector('#email')`,
    "existing login",
  );
  assert.ok(
    await client.evaluate(`!!document.querySelector('.aw-auth')`),
    "Sign-in uses the shared theme",
  );
  await mkdir(".tmp/entry-screenshots", { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await client.call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    for (const path of ["/login", "/create-account"]) {
      await navigate(path);
      await until(
        `!!document.querySelector('.aw-auth') && !!document.querySelector('input')`,
        "themed account page ready",
      );
      await sleep(200);
      assert.ok(
        await client.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`),
        `${path} fits ${width}px`,
      );
      assert.equal(
        await client.evaluate(
          `getComputedStyle(document.querySelector('.aw-auth')).getPropertyValue('--primary').trim()`,
        ),
        "#68442e",
      );
      const screenshot = await client.call("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `.tmp/entry-screenshots/${path.slice(1)}-${width}.png`,
        Buffer.from(screenshot.data, "base64"),
      );
    }
  }
  for (const path of ["/dashboard", "/attendance"]) {
    await client.call("Page.navigate", { url: new URL(path, base).href });
    await until(
      `location.pathname === '/login' && document.querySelector('#email')`,
      "protected route still redirects",
    );
  }
  for (const path of ["/privacy", "/terms"]) {
    await navigate(path);
    await until(`!!document.querySelector('.aw-policy')`, "themed policy page");
    assert.ok(await client.evaluate(`document.body.innerText.length > 100`));
    assert.ok(
      await client.evaluate(
        `getComputedStyle(document.querySelector('h1')).fontFamily.includes('Attend Sans')`,
      ),
    );
    assert.equal(
      await client.evaluate(
        `getComputedStyle(document.querySelector('.aw-policy h1 > span')).animationName`,
      ),
      "none",
      "Reduced motion policy title",
    );
    assert.equal(
      await client.evaluate(
        `getComputedStyle(document.querySelector('.aw-policy')).backgroundColor`,
      ),
      "rgb(229, 228, 223)",
      "Cool light cream",
    );
    for (const width of [390, 1440]) {
      await client.call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
      await client.evaluate("scrollTo(0,0)");
      await sleep(200);
      assert.ok(
        await client.evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`),
        "Policy fits viewport",
      );
      const screenshot = await client.call("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `.tmp/entry-screenshots/${path.slice(1)}-${width}.png`,
        Buffer.from(screenshot.data, "base64"),
      );
    }
  }
  await navigate("/policy-consent");
  await until(`!!document.querySelector('.aw-auth')`, "themed policy acceptance");
  await client.evaluate(`document.documentElement.classList.add('dark')`);
  assert.equal(
    await client.evaluate(
      `getComputedStyle(document.documentElement).getPropertyValue('--background').trim()`,
    ),
    "#211710",
    "Application dark theme uses brown",
  );
  await client.evaluate(`document.documentElement.classList.remove('dark')`);

  await client.call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await navigate("/privacy");
  await until(`document.querySelector('.aw-policy-motion')`, "policy motion enabled");
  assert.equal(
    await client.evaluate(
      `getComputedStyle(document.querySelector('.aw-policy h1 > span')).animationName`,
    ),
    "aw-policy-title",
  );
  await client.evaluate(`document.querySelector('.aw-policy-body section').scrollIntoView()`);
  await until(
    `document.querySelector('.aw-policy-body section').classList.contains('aw-policy-visible')`,
    "policy section entrance",
  );
  await welcome();
  await section("homepage");
  await sleep(1400);
  const frames = await client.evaluate(`new Promise(resolve=>{
    const gaps=[];let previous=performance.now();
    function frame(now){gaps.push(now-previous);previous=now;if(gaps.length<120)requestAnimationFrame(frame);else resolve(gaps.slice(1));}
    requestAnimationFrame(frame);
  })`);
  const metrics = await client.evaluate(`window.__welcomeMetrics`);
  assert.ok(metrics.cls < 0.01, `Visible layout shift: ${metrics.cls}`);
  assert.deepEqual(errors, [], "No browser runtime exceptions");
  assert.deepEqual(nonlocalWrites, [], "No attempted external mutations");
  const sorted = frames.toSorted((a, b) => a - b);
  console.log(
    "PASS: portal/letter selection, live and paused wires, revealed sections, fonts, anchors, keyboard, mobile menu, reduced motion, existing entry and protected routes.",
  );
  console.log(
    "PASS: no horizontal overflow at 320, 390, 768, 1024 and 1440px; no external API calls.",
  );
  console.log(
    JSON.stringify({
      localHeadlessPerformance: {
        cls: metrics.cls,
        frameMedianMs: sorted[Math.floor(sorted.length / 2)],
        frameP95Ms: sorted[Math.floor(sorted.length * 0.95)],
        longTasks: metrics.longTasks.length,
      },
    }),
  );
} finally {
  await client.call("Fetch.disable").catch(() => {});
  client.socket.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`);
}
