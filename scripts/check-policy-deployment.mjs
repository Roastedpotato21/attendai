import { createClient } from "@supabase/supabase-js";
import { POLICY_VERSION } from "../src/lib/policies.ts";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await db
  .from("policy_versions")
  .select("policy_type,version,active")
  .eq("active", true);
console.log(
  JSON.stringify({
    policyMigrationVisible: !error,
    activeVersions: error ? [] : data.map(({ policy_type, version }) => ({ policy_type, version })),
  }),
);
const origin = new URL(process.env.ATTENDAI_APP_URL);
const [privacyResponse, termsResponse] = await Promise.all([
  fetch(new URL("/privacy", origin)),
  fetch(new URL("/terms", origin)),
]);
const [privacyHtml, termsHtml] = await Promise.all([privacyResponse.text(), termsResponse.text()]);
const privacyPageVisible =
  privacyResponse.ok &&
  privacyHtml.includes("Privacy Policy") &&
  privacyHtml.includes("guardian notification");
const termsPageVisible = termsResponse.ok && termsHtml.includes("Terms & Conditions");
console.log(
  JSON.stringify({
    privacyRouteHttp: privacyResponse.status,
    privacyPageVisible,
    termsRouteHttp: termsResponse.status,
    termsPageVisible,
  }),
);
const versions = new Map((data ?? []).map(({ policy_type, version }) => [policy_type, version]));
if (
  error ||
  versions.get("terms") !== POLICY_VERSION ||
  versions.get("privacy") !== POLICY_VERSION ||
  !privacyPageVisible ||
  !termsPageVisible
) {
  process.exitCode = 1;
}
