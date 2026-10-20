import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { adaptRegistryRows, parseRegistryCsv } from "../src/lib/institution-registry.ts";

const [source, path, ...options] = process.argv.slice(2);
if (!["aishe", "ugc", "aicte"].includes(source) || !path)
  throw new Error(
    "Usage: npm run verification:import -- aishe|ugc|aicte <canonical.json|canonical.csv> [--apply]",
  );
const file = await readFile(path, "utf8");
const raw = path.toLowerCase().endsWith(".csv") ? parseRegistryCsv(file) : JSON.parse(file);
if (!Array.isArray(raw)) throw new Error("Expected an array of canonical import rows.");
const rows = adaptRegistryRows(source, raw);
console.log(
  JSON.stringify({
    source,
    rows: rows.length,
    mode: options.includes("--apply") ? "apply" : "validation only",
    sha256: createHash("sha256").update(file).digest("hex"),
  }),
);
if (options.includes("--apply")) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error(
      "Trusted server Supabase credentials are required; never use a browser key for imports.",
    );
  if (rows.length > 10000)
    throw new Error("Split this import into reviewed batches of at most 10000 rows.");
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc("import_institution_registry", {
    p_rows: rows,
    p_import_sha256: createHash("sha256").update(file).digest("hex"),
  });
  if (error) throw new Error("Registry import failed: " + error.message);
  console.log("Official source rows imported: " + data);
}
