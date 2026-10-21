import { supabase } from "@/lib/db/connection";
import { readAllRows } from "@/lib/db/pagination";
import type {
  SetupCatalog,
  Membership,
  InstitutionProfile,
  StaffWorkspace,
} from "@/lib/staff-setup";
export async function setupRpc<T>(name: string, parameters?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    if (error.code === "23505")
      throw new Error(
        "That institution email, staff ID, code or current responsibility already exists.",
      );
    throw new Error(error.message || "Institution setup could not be completed.");
  }
  return data as T;
}
export const setupMemberships = () => setupRpc<Membership[]>("my_staff_memberships");
export const setupProfile = (id: string) =>
  setupRpc<InstitutionProfile>("institution_setup_profile", { p_institution: id });
export const staffWorkspace = (id: string) =>
  setupRpc<StaffWorkspace>("my_staff_workspace", { p_institution: id });
export async function setupCatalog(id: string): Promise<SetupCatalog> {
  const tables = [
    "academic_departments",
    "academic_programs",
    "academic_terms",
    "academic_sections",
    "academic_subjects",
    "staff_records",
    "staff_role_grants",
    "staff_responsibilities",
  ] as const;
  const data = await Promise.all(
    tables.map((table) =>
      readAllRows(
        (from, to) =>
          supabase.from(table).select("*").eq("institution_id", id).order("id").range(from, to),
        table,
      ),
    ),
  );
  const { data: audit, error } = await supabase
    .from("staff_setup_audit")
    .select("*")
    .eq("institution_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Setup audit history could not be loaded.");
  return {
    departments: data[0],
    programs: data[1],
    terms: data[2],
    sections: data[3],
    subjects: data[4],
    staff: data[5],
    roles: data[6],
    responsibilities: data[7],
    audit: audit ?? [],
  } as unknown as SetupCatalog;
}
export async function generateStaffInvitation(staffId: string): Promise<{
  invitationLink: string;
  deliveryStatus: "link_generated";
  manualDeliveryRequired: true;
}> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to continue.");
  const response = await fetch("/api/institution-setup/staff-invitation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: "Bearer " + data.session.access_token,
    },
    body: JSON.stringify({ staffId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Invitation generation failed.");
  return result;
}
export async function saveLogo(id: string, file: File) {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 262144)
    throw new Error("Use a PNG/JPEG logo up to 256 KiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoded = "";
  for (const byte of bytes) encoded += String.fromCharCode(byte);
  await setupRpc("set_institution_setup_logo", {
    p_institution: id,
    p_base64: btoa(encoded),
    p_mime: file.type,
  });
}
