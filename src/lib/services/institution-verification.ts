import { supabase } from "@/lib/db/connection";
import type { EvidenceKind, VerificationEvidence } from "@/lib/institution-verification";

export async function verificationRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (error.code === "23505")
      throw new Error(
        "Institution already registered or claimed. Request authorized administrator review instead of creating a duplicate.",
      );
    if (error.code === "42501")
      throw new Error(error.message || "This verification action is not authorized.");
    throw new Error(error.message || "Verification could not be completed. Please try again.");
  }
  return data as T;
}
async function authorization(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to your verified account first.");
  return { Authorization: "Bearer " + data.session.access_token };
}
export async function uploadVerificationEvidence(
  applicationId: string,
  kind: EvidenceKind,
  file: File,
  challengeId?: string,
) {
  const body = new FormData();
  body.set("applicationId", applicationId);
  body.set("kind", kind);
  body.set("file", file);
  if (challengeId) body.set("challengeId", challengeId);
  const response = await fetch("/api/institution-verification/evidence", {
    method: "POST",
    headers: await authorization(),
    body,
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "Evidence upload failed.");
  }
}
export async function downloadVerificationEvidence(id: string) {
  const response = await fetch(
    "/api/institution-verification/evidence?id=" + encodeURIComponent(id),
    { headers: await authorization() },
  );
  if (!response.ok) throw new Error("Evidence download is unavailable.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "verification-evidence";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function deleteVerificationEvidence(id: string) {
  const response = await fetch(
    "/api/institution-verification/evidence?id=" + encodeURIComponent(id),
    { method: "DELETE", headers: await authorization() },
  );
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error ?? "Evidence deletion failed.");
  }
}
export async function verificationEvidence(applicationId: string): Promise<VerificationEvidence[]> {
  const { data, error } = await supabase
    .from("institution_verification_evidence")
    .select(
      "id,application_id,kind,original_name,mime_type,size_bytes,scan_state,review_state,retention_until,deleted_at,challenge_id,review_revision",
    )
    .eq("application_id", applicationId)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw new Error("Private evidence metadata could not be loaded.");
  return data as VerificationEvidence[];
}
