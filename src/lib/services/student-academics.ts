import { supabase } from "@/lib/db/connection";
import type {
  AcademicCatalog,
  AcademicProfile,
  AcademicStudent,
  StudentBatch,
} from "@/lib/student-academics";
export async function academicRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error)
    throw new Error(
      error.code === "23505"
        ? "An institution identifier or overlapping placement already exists. Review duplicates and refresh the preview."
        : error.message || "Student academic operation failed.",
    );
  return data as T;
}
export const academicCatalog = (id: string) =>
  academicRpc<AcademicCatalog>("student_academic_catalog", { p_institution: id });
export const academicProfile = (id: string) =>
  academicRpc<AcademicProfile>("student_academic_profile", { p_student: id });
export const academicDirectory = (
  id: string,
  query = "",
  cohort: string | null = null,
  offset = 0,
  term: string | null = null,
) =>
  academicRpc<AcademicStudent[]>("student_academic_directory", {
    p_institution: id,
    p_query: query,
    p_cohort: cohort,
    p_offset: offset,
    p_term: term,
  });
export async function loadStudentBatch(id: string, institution: string): Promise<StudentBatch> {
  const { data, error } = await supabase
    .from("student_import_batches")
    .select("*")
    .eq("id", id)
    .eq("institution_id", institution)
    .single();
  if (error) throw new Error("Your import/promotion preview could not be loaded.");
  return data as StudentBatch;
}
