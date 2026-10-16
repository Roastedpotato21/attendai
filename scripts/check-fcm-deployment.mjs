/** Read-only public deployment diagnostics; never reads or prints device credentials. */
const origin = new URL(process.env.ATTENDAI_APP_URL);
const page = await fetch(new URL("/guardian-notifications", origin), {
  signal: AbortSignal.timeout(15000),
});
const html = await page.text();
const assets = new Set(html.match(/\/assets\/[^"'\\<>\s]+\.js/g) ?? []);
let route = "";
let worker = "";
for (const path of assets) {
  if (!path.includes("guardian-notifications")) continue;
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15000) });
  route = await response.text();
  worker = route.match(/\/assets\/firebase-messaging-sw-[\w-]+\.js/)?.[0] ?? "";
}
const result = {
  pageHttp: page.status,
  manifestHttp: 0,
  manifestStandalone: false,
  guardianBundleFound: Boolean(route),
  rootScopeRequested: /scope\s*:\s*["'`]\/["'`]/.test(route),
  workerFound: Boolean(worker),
};
const manifestResponse = await fetch(new URL("/guardian-notifications.webmanifest", origin), {
  signal: AbortSignal.timeout(15000),
});
result.manifestHttp = manifestResponse.status;
if (manifestResponse.ok) {
  try {
    const manifest = await manifestResponse.json();
    result.manifestStandalone =
      manifest.display === "standalone" && manifest.start_url === "/guardian-notifications";
  } catch {
    result.manifestStandalone = false;
  }
}
if (worker) {
  const response = await fetch(new URL(worker, origin), { signal: AbortSignal.timeout(15000) });
  result.workerHttp = response.status;
  result.workerAllowedScope = response.headers.get("service-worker-allowed");
  result.workerContentType = response.headers.get("content-type");
}
console.log(JSON.stringify(result));
if (
  !page.ok ||
  result.manifestHttp !== 200 ||
  !result.manifestStandalone ||
  !result.guardianBundleFound ||
  !result.rootScopeRequested ||
  !result.workerFound ||
  result.workerHttp !== 200 ||
  result.workerAllowedScope !== "/" ||
  !/^(text|application)\/javascript\b/i.test(result.workerContentType ?? "")
) {
  process.exitCode = 1;
}
