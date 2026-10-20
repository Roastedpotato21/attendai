import { readAllRows } from "../pagination";
import { supabase } from "../connection";
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
    const data = await readAllRows(
      (from, to) =>
        supabase
          .from("faculty")
          .select("id, department, role, profiles(name, email), class_faculty(classes(full_name))")
          .order("department")
          .order("id")
          .range(from, to),
      "faculty findAll",
    );

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
  },
};
