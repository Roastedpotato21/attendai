import { hasDatabaseConnection, supabase, memoryDb } from "../connection";
import type { Faculty, FacultyRole } from "@/lib/types";
import { fromSupabaseError } from "../errors";

function toFacultyRole(role: string): FacultyRole {
  switch (role) {
    case "hod":
      return "HOD";
    case "professor":
      return "Faculty";
    case "assistant_professor":
      return "Class Teacher";
    case "lecturer":
      return "Faculty";
    default:
      return "Faculty";
  }
}

export const facultyRepository = {
  async findAll(): Promise<Faculty[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("faculty")
        .select("id, department, role, profiles(name, email), class_faculty(classes(full_name))")
        .order("department");

      if (error) throw fromSupabaseError("faculty list", error);
      if (!data) return [];

      return data.map((row) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return {
          id: row.id,
          name: profile?.name ?? "Unknown faculty",
          email: profile?.email ?? "",
          department: row.department,
          role: toFacultyRole(row.role),
          classes: (row.class_faculty ?? []).flatMap((assignment) => {
            const assignedClass = Array.isArray(assignment.classes)
              ? assignment.classes[0]
              : assignment.classes;
            return assignedClass?.full_name ? [assignedClass.full_name] : [];
          }),
        };
      });
    }

    // Mock mode: build Faculty list from in-memory data
    const users = memoryDb.users;
    return memoryDb.faculty.map((f) => {
      const user = users.find((u) => u.id === f.userId);
      const classNames = memoryDb.classFaculty
        .filter((cf) => cf.facultyId === f.id)
        .map((cf) => {
          const cls = memoryDb.classes.find((c) => c.id === cf.classId);
          return cls?.fullName ?? "";
        })
        .filter(Boolean);

      return {
        id: f.id,
        name: user?.name ?? "Unknown faculty",
        email: user?.email ?? "",
        department: f.department,
        role: toFacultyRole(f.role),
        classes: classNames,
      };
    });
  },
};
