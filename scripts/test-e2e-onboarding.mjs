// Compatibility entry point. Onboarding must never create synthetic production tenants
// or admin-confirm real users. Exercise the complete workflow in isolated PostgreSQL.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

console.log("Running isolated institution verification and tenant authorization checks.");
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", fileURLToPath(new URL("./verify-postgres.cjs", import.meta.url))],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
