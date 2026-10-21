export const setupRoles = [
  "institution_admin",
  "faculty",
  "class_incharge",
  "hod",
  "coordinator",
  "staff",
] as const;
export type SetupRole = (typeof setupRoles)[number];
export const roleLabels: Record<string, string> = {
  institution_owner: "Institution Owner",
  institution_admin: "Institution Admin",
  faculty: "Faculty",
  class_incharge: "Class Incharge",
  hod: "HOD",
  coordinator: "Coordinator",
  staff: "Staff",
};
export type Membership = { id: string; name: string; can_manage: boolean };
export type InstitutionProfile = {
  institution_id: string;
  name: string;
  state: string;
  institution_type: string;
  verified_identity: boolean;
  owner_profile_id: string | null;
  city: string;
  official_address: string;
  academic_year: string;
  timezone: string;
  official_email: string;
  official_phone: string;
  website: string;
  brand_name: string;
  brand_color: string;
  logo_data_url: string | null;
};
export type Department = { id: string; institution_id: string; name: string; code: string };
export type Program = Department & { department_id: string };
export type Term = {
  id: string;
  institution_id: string;
  program_id: string;
  name: string;
  academic_year: string;
  term_kind: "year" | "semester" | "term";
  year_number: number | null;
  starts_on: string;
  ends_on: string;
};
export type Section = {
  id: string;
  institution_id: string;
  program_id: string;
  term_id: string;
  class_id: string;
  name: string;
};
export type Subject = Department & { program_id: string };
export type Staff = {
  id: string;
  institution_id: string;
  profile_id: string | null;
  full_name: string;
  email: string;
  phone: string;
  staff_code: string | null;
  primary_department_id: string | null;
  designation: string;
  status: "draft" | "invited" | "active" | "on_leave" | "inactive" | "left_institution";
};
export type StaffDetails = {
  full_name: string;
  email: string;
  phone: string;
  staff_code: string;
  primary_department_id: string;
  designation: string;
};
export const emptyStaff: StaffDetails = {
  full_name: "",
  email: "",
  phone: "",
  staff_code: "",
  primary_department_id: "",
  designation: "",
};
export type ResponsibilityKind =
  "department_member" | "teaching" | "class_incharge" | "hod" | "coordinator";
export type ResponsibilityDraft = {
  kind: ResponsibilityKind;
  department_id: string;
  program_id: string;
  term_id: string;
  section_id: string;
  subject_id: string;
  academic_year: string;
  effective_from: string;
  effective_until: string;
  reason: string;
};
export type Responsibility = Omit<
  ResponsibilityDraft,
  "program_id" | "term_id" | "section_id" | "subject_id"
> & {
  id: string;
  staff_id: string;
  program_id: string | null;
  term_id: string | null;
  section_id: string | null;
  subject_id: string | null;
  active: boolean;
  closed_at: string | null;
  ended_on?: string | null;
  end_reason?: string | null;
  handover_from_id?: string | null;
  substitution_for_id?: string | null;
};
export type RoleGrant = {
  id: string;
  staff_id: string;
  role: SetupRole;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  closed_at: string | null;
  ended_on?: string | null;
  end_reason?: string | null;
  reason: string;
};
export function institutionDay(timezone: string, now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return parts["year"] + "-" + parts["month"] + "-" + parts["day"];
}
export function currentRoleGrant(role: RoleGrant, day: string): boolean {
  return (
    role.active &&
    role.valid_from <= day &&
    (!role.valid_until || role.valid_until >= day) &&
    (!role.ended_on || role.ended_on >= day)
  );
}
export type AuditEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_profile_id: string | null;
  created_at: string;
  previous: unknown;
  current: unknown;
};
export type SetupCatalog = {
  departments: Department[];
  programs: Program[];
  terms: Term[];
  sections: Section[];
  subjects: Subject[];
  staff: Staff[];
  roles: RoleGrant[];
  responsibilities: Responsibility[];
  audit: AuditEntry[];
};
export type WorkspaceAssignment = Responsibility & {
  department_name: string;
  program_name: string | null;
  term_name: string | null;
  section_name: string | null;
  subject_name: string | null;
  role_effective: boolean;
  can_mark_subject: boolean;
};
export type StaffWorkspace = {
  legacy_classes?: { id: string; name: string }[];
  staff: Staff | null;
  primary_department: string | null;
  roles: string[];
  institution: InstitutionProfile;
  can_manage_setup: boolean;
  assignments: WorkspaceAssignment[];
  memberships: Membership[];
};
export const setupPaths = [
  "/institution-profile",
  "/departments",
  "/programs",
  "/staff",
  "/staff-assignments",
] as const;
export function staffRouteAllowed(
  path: string,
  managed: boolean,
  canManage: boolean,
  legacyClasses = false,
): boolean {
  if (!managed) return true;
  if (canManage) return true;
  if (legacyClasses && ["/attendance", "/students"].includes(path)) return true;
  return (
    path === "/" ||
    path === "/staff-profile" ||
    path === "/students" ||
    path === "/student-promotion" ||
    path === "/period-attendance" ||
    path === "/timetable" ||
    (canManage && setupPaths.includes(path as (typeof setupPaths)[number]))
  );
}
