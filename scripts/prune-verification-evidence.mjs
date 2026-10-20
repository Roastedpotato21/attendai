import { createClient } from "@supabase/supabase-js";
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Server-only Supabase configuration is required.");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await db
  .from("institution_verification_evidence")
  .select("id,object_path")
  .is("storage_deleted_at", null)
  .or("retention_until.lte." + new Date().toISOString() + ",deleted_at.not.is.null")
  .order("retention_until")
  .limit(100);
if (error) throw new Error("Retention inventory failed.");
const apply = process.argv.includes("--apply");
let deleted = 0;
for (const row of data) {
  if (!apply) continue;
  const { error: removeError } = await db.storage
    .from("institution-verification")
    .remove([row.object_path]);
  if (removeError) throw new Error("Private evidence deletion failed; rerun the retention worker.");
  const { error: recordError } = await db.rpc("finish_verification_evidence_deletion", {
    p_id: row.id,
  });
  if (recordError)
    throw new Error(
      "Physical deletion completed but the audit receipt is pending; rerun the worker.",
    );
  deleted++;
}
const { data: orphans, error: orphanError } = await db.rpc("verification_orphan_objects");
if (orphanError) throw new Error("Orphaned evidence inventory failed.");
if (apply && orphans.length) {
  const { error: orphanDeleteError } = await db.storage
    .from("institution-verification")
    .remove(orphans.map((row) => row.object_path));
  if (orphanDeleteError)
    throw new Error("Orphaned private evidence deletion failed; rerun the retention worker.");
}
console.log(
  JSON.stringify({
    mode: apply ? "apply" : "inventory only",
    due: data.length,
    deleted,
    orphanedObjects: orphans.length,
  }),
);
