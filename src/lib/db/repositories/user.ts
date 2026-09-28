import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
import type { DbUser } from "../schema";
import type { UserRole } from "@/lib/types";
import { fromSupabaseError } from "../errors";

const STAFF_PORTAL_ROLES: readonly UserRole[] = ["admin", "faculty", "staff"];

export type StaffAccessResolution =
  | { status: "allowed"; user: DbUser }
  | {
      status:
        | "profile_missing"
        | "profile_inactive"
        | "no_membership"
        | "membership_inactive"
        | "student_only"
        | "role_missing";
    };

export const userRepository = {
  /** Resolve portal access from the authenticated identity and tenant-scoped grants. */
  async resolveStaffAccess(authUserId: string): Promise<StaffAccessResolution> {
    if (!hasDatabaseConnection() || !supabase) throw new Error("Supabase mode is required");

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, email, status, student_id, created_at, updated_at")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (profileError) throw fromSupabaseError("staff profile lookup", profileError);
    if (!profile) return { status: "profile_missing" };
    if (profile.status !== "active") return { status: "profile_inactive" };

    const { data: memberships, error: membershipsError } = await supabase
      .from("profile_institutions")
      .select("institution_id, status")
      .eq("profile_id", profile.id);
    if (membershipsError) throw fromSupabaseError("staff membership lookup", membershipsError);
    if (!memberships?.length) return { status: "no_membership" };
    const membershipIds = memberships
      .filter((membership) => membership.status === "active")
      .map((membership) => membership.institution_id);
    if (!membershipIds.length) return { status: "membership_inactive" };

    const { data: institutions, error: institutionsError } = await supabase
      .from("institutions")
      .select("id")
      .in("id", membershipIds);
    if (institutionsError) throw fromSupabaseError("active institution lookup", institutionsError);
    const activeInstitutionIds = new Set(institutions?.map((institution) => institution.id));
    if (!activeInstitutionIds.size) return { status: "membership_inactive" };

    const { data: roles, error: rolesError } = await supabase
      .from("profile_roles")
      .select("institution_id, role_code")
      .eq("profile_id", profile.id);
    if (rolesError) throw fromSupabaseError("staff role lookup", rolesError);
    const activeRoles = (roles ?? []).filter((role) =>
      activeInstitutionIds.has(role.institution_id),
    );
    const role = activeRoles.find((assignment) =>
      STAFF_PORTAL_ROLES.includes(assignment.role_code as UserRole),
    )?.role_code as UserRole | undefined;
    if (!role)
      return {
        status: activeRoles.some((assignment) => assignment.role_code === "student")
          ? "student_only"
          : "role_missing",
      };
    return {
      status: "allowed",
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role,
        studentId: profile.student_id,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
    };
  },

  async findById(id: string): Promise<DbUser | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw fromSupabaseError("profile lookup", error);
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        studentId: data.student_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    const user = memoryDb.users.find((u) => u.id === id);
    return user || null;
  },

  async findByEmail(email: string): Promise<DbUser | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      if (error) throw fromSupabaseError("profile email lookup", error);
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        studentId: data.student_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    const user = memoryDb.users.find((u) => u.email === email);
    return user || null;
  },

  async findAll(): Promise<DbUser[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("profiles").select("*");
      if (error) throw fromSupabaseError("profile list", error);
      if (!data) return [];

      return data.map((d) => ({
        id: d.id,
        name: d.name,
        email: d.email,
        role: d.role,
        studentId: d.student_id,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }));
    }

    return memoryDb.users;
  },
};
