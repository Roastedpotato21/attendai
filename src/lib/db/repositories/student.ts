import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
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
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("students")
        .select("*, classes(*), parents(*)")
        .eq("class_id", classId)
        .eq("enrollment_status", "active")
        .order("roll");
      if (error) throw fromSupabaseError("class student list", error);
      return (data ?? []).map((row) => mapSupabaseStudent(row as SupabaseStudentRow));
    }
    return (await this.findAll()).filter((student) => student.classId === classId);
  },
  async findAll(): Promise<PopulatedStudent[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("students").select(`
          *,
          classes (*),
          parents (*)
        `);

      if (error) throw fromSupabaseError("student list", error);
      if (!data) return [];
      return data.map((row) => mapSupabaseStudent(row as SupabaseStudentRow));
    }

    return memoryDb.students.map((s) => {
      const cls = memoryDb.classes.find((c) => c.id === s.classId);
      const parent = memoryDb.parents.find((p) => p.id === s.parentId);

      if (!cls || !parent) {
        throw new Error(`Data integrity error for student ${s.id}`);
      }

      return {
        ...s,
        class: cls,
        parent: parent,
      };
    });
  },

  async findById(id: string): Promise<PopulatedStudent | null> {
    if (hasDatabaseConnection() && supabase) {
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
        .maybeSingle();

      if (error) throw fromSupabaseError("student lookup", error);
      if (!data) return null;
      return mapSupabaseStudent(data as SupabaseStudentRow);
    }

    const s = memoryDb.students.find((s) => s.id === id);
    if (!s) return null;

    const cls = memoryDb.classes.find((c) => c.id === s.classId);
    const parent = memoryDb.parents.find((p) => p.id === s.parentId);

    if (!cls || !parent) {
      throw new Error(`Data integrity error for student ${s.id}`);
    }

    return {
      ...s,
      class: cls,
      parent: parent,
    };
  },
};
