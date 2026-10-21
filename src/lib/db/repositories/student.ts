import { readAllRows } from "../pagination";
import { supabase } from "../connection";
import type { DbStudent, DbClass, DbParent } from "../schema";
import { fromSupabaseError } from "../errors";

export type PopulatedStudent = DbStudent & {
  class: DbClass;
  parent: DbParent;
};

type SupabaseStudentRow = {
  id: string;
  institution_id: string;
  parent_id: string;
  class_id: string;
  name: string;
  roll: string;
  attendance_rate: number;
  consecutive_absences: number;
  status: DbStudent["status"];
  risk: DbStudent["risk"];
  created_at: string;
  updated_at: string;
  classes: {
    id: string;
    institution_id: string;
    name: string;
    section: string;
    full_name: string;
    created_at: string;
    updated_at: string;
  };
  parents: {
    id: string;
    institution_id: string;
    user_id: string | null;
    name: string;
    phone: string;
    language: DbParent["language"];
    preferred_channel: DbParent["preferredChannel"];
    created_at: string;
    updated_at: string;
  };
};

// Helper to map Supabase joined row to PopulatedStudent
const mapSupabaseStudent = (row: SupabaseStudentRow): PopulatedStudent => {
  return {
    id: row.id,
    institutionId: row.institution_id,
    parentId: row.parent_id,
    classId: row.class_id,
    name: row.name,
    roll: row.roll,
    attendanceRate: row.attendance_rate,
    consecutiveAbsences: row.consecutive_absences,
    status: row.status,
    risk: row.risk,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    class: {
      id: row.classes.id,
      institutionId: row.classes.institution_id,
      name: row.classes.name,
      section: row.classes.section,
      fullName: row.classes.full_name,
      createdAt: row.classes.created_at,
      updatedAt: row.classes.updated_at,
    },
    parent: {
      id: row.parents.id,
      institutionId: row.parents.institution_id,
      userId: row.parents.user_id,
      name: row.parents.name,
      phone: row.parents.phone,
      language: row.parents.language,
      preferredChannel: row.parents.preferred_channel,
      createdAt: row.parents.created_at,
      updatedAt: row.parents.updated_at,
    },
  };
};

export const studentRepository = {
  async findByClassId(classId: string): Promise<PopulatedStudent[]> {
    const data = await readAllRows(
      (from, to) =>
        supabase
          .from("students")
          .select("*, classes(*), parents(*)")
          .eq("class_id", classId)
          .not("parent_id", "is", null)
          .eq("enrollment_status", "active")
          .order("roll")
          .order("id")
          .range(from, to),
      "student findByClassId",
    );

    return (data ?? []).map((row) => mapSupabaseStudent(row as SupabaseStudentRow));
  },
  async findAll(): Promise<PopulatedStudent[]> {
    const data = await readAllRows(
      (from, to) =>
        supabase
          .from("students")
          .select(
            `
          *,
          classes (*),
          parents (*)
        `,
          )
          .not("class_id", "is", null)
          .not("parent_id", "is", null)
          .order("id")
          .range(from, to),
      "student findAll",
    );

    if (!data) return [];
    return data.map((row) => mapSupabaseStudent(row as SupabaseStudentRow));
  },

  async findById(id: string): Promise<PopulatedStudent | null> {
    const { data, error } = await supabase
      .from("students")
      .select(
        `
          *,
          classes (*),
          parents (*)
        `,
      )
      .eq("id", id)
      .not("class_id", "is", null)
      .not("parent_id", "is", null)
      .maybeSingle();

    if (error) throw fromSupabaseError("student lookup", error);
    if (!data) return null;
    return mapSupabaseStudent(data as SupabaseStudentRow);
  },
};
