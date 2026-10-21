import type { Department, Program, Term, Section } from "./staff-setup";
import type { StudentImportRow } from "./student-import";
export type Cohort = {
  id: string;
  program_id: string;
  name: string;
  code: string;
  starts_on: string;
  expected_ends_on: string;
  description: string;
};
export type AcademicCatalog = {
  can_import: boolean;
  can_manage: boolean;
  departments: Department[];
  programs: Program[];
  terms: Term[];
  sections: Section[];
  cohorts: Cohort[];
};
export type AcademicStudent = {
  id: string;
  institution_id: string;
  name: string;
  admission_number: string | null;
  roll: string | null;
  enrollment_status: string;
  admitted_on: string | null;
  entry_type: string | null;
  entry_term_id?: string | null;
  entry_cohort_id?: string | null;
  academic_managed: boolean;
  academic_version: number;
  cohort_id?: string | null;
  term_id?: string | null;
  section_name?: string | null;
  program_name?: string | null;
  cohort_name?: string | null;
  term_name?: string | null;
  year_number?: number | null;
};
export type StudentPlacement = {
  id: string;
  student_id: string;
  section_id: string;
  cohort_id: string;
  term_id: string;
  program_id: string;
  department_id: string;
  starts_on: string;
  ends_on: string;
  change_type: string;
  reason: string;
  close_reason: string | null;
  created_by: string;
  created_at: string;
  closed_at: string | null;
  department_name: string;
  program_name: string;
  term_name: string;
  year_number: number | null;
  term_kind: string;
  section_name: string;
  cohort_name: string;
};
export type AcademicProfile = {
  student: AcademicStudent;
  history: StudentPlacement[];
  current: StudentPlacement | null;
  can_edit: boolean;
  can_move: boolean;
  entry_term?: { name: string; year_number: number | null } | null;
  entry_cohort?: { name: string } | null;
};
export type ImportPreviewRow = {
  row_number: number;
  data: StudentImportRow;
  name?: string;
  errors: string[];
  warnings: string[];
  outcome: "valid" | "rejected" | "skipped";
  existing_students?: { id: string; name: string; admission_number: string; roll_number: string }[];
  potential_duplicates?: { id: string; name: string; admission_number: string }[];
  guardian?: {
    matches: { id: string; name: string; phone: string; contact_version: number }[];
    contact_version: number | null;
    errors: string[];
  };
};
export type StudentBatch = {
  result?: { student_id: string; row_number: number }[] | { changed: number } | null;
  id: string;
  institution_id: string;
  kind: "import" | "promotion" | "guardian_import";
  filename: string;
  revision: number;
  status: "preview" | "committed";
  rows: StudentImportRow[];
  preview: ImportPreviewRow[];
};
export function importSummary(rows: ImportPreviewRow[]) {
  return {
    valid: rows.filter((r) => r.outcome === "valid").length,
    rejected: rows.filter((r) => r.outcome === "rejected").length,
    skipped: rows.filter((r) => r.outcome === "skipped").length,
    warnings: rows.filter((r) => r.warnings.length).length,
    existing: rows.filter((r) => r.existing_students?.length).length,
    potential: rows.filter((r) => r.potential_duplicates?.length).length,
  };
}
