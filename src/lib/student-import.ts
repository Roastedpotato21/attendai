import { unzipSync, strFromU8 } from "fflate";
import { readSheet } from "read-excel-file/universal";
import { parseRegistryCsv } from "./institution-registry.ts";

export const guardianImportColumns = [
  "guardian_name",
  "guardian_relationship",
  "guardian_mobile",
  "guardian_email",
  "guardian_is_primary",
  "guardian_receives_notifications",
  "guardian_language",
  "guardian_effective_from",
  "guardian_effective_until",
  "guardian_id",
  "guardian_distinct_acknowledged",
] as const;
const academicImportColumns = [
  "full_name",
  "admission_number",
  "roll_number",
  "admitted_on",
  "department_code",
  "program_code",
  "cohort_code",
  "academic_year",
  "term_name",
  "section_name",
  "entry_type",
  "entry_academic_year",
  "entry_term_name",
  "starts_on",
  "entry_year",
  "current_year",
] as const;
export const studentImportColumns = [...academicImportColumns, ...guardianImportColumns] as const;
export const guardianRelationshipColumns = ["admission_number", ...guardianImportColumns] as const;
export type StudentImportRow = Record<string, string | boolean> & {
  full_name?: string;
  action?: string;
  existing_student_id?: string;
  duplicate_acknowledged?: string | boolean;
};
export const STUDENT_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
export const STUDENT_IMPORT_MAX_ROWS = 500;
const required = academicImportColumns.filter(
  (c) => !["roll_number", "entry_year", "current_year"].includes(c),
);
export function validateStudentImportShape(
  rows: StudentImportRow[],
  guardianOnly = false,
): StudentImportRow[] {
  if (!rows.length || rows.length > STUDENT_IMPORT_MAX_ROWS)
    throw new Error("Import 1–500 rows per reviewed batch.");
  const headers = Object.keys(rows[0]!);
  const columns = guardianOnly ? guardianRelationshipColumns : studentImportColumns;
  const requiredColumns = guardianOnly
    ? [
        "admission_number",
        "guardian_name",
        "guardian_relationship",
        "guardian_mobile",
        "guardian_effective_from",
      ]
    : required;
  if (
    requiredColumns.some((h) => !headers.includes(h)) ||
    headers.some((h) => !(columns as readonly string[]).includes(h))
  )
    throw new Error(
      "Use the exact template headers. Guardian columns are optional in a student file; guardian-only files require admission_number and guardian name, relationship, mobile and effective_from.",
    );
  return rows.map((row, index) =>
    Object.fromEntries(
      headers.map((key) => {
        const value = String(row[key] ?? "").trim();
        if (
          value.length > 200 ||
          Array.from(value).some(
            (ch) => ch.charCodeAt(0) < 32 && ![9, 10, 13].includes(ch.charCodeAt(0)),
          )
        )
          throw new Error(`Row ${index + 2}: invalid or oversized cell.`);
        if (/^[=+@]/.test(value) && !(key === "guardian_mobile" && /^\+[0-9 () .-]+$/.test(value)))
          throw new Error(`Row ${index + 2}: formulas are not accepted; provide literal values.`);
        return [key, value];
      }),
    ),
  );
}
export function inspectStudentWorkbook(bytes: Uint8Array): void {
  let total = 0,
    count = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize;
      count++;
      if (
        count > 200 ||
        total > 24 * 1024 * 1024 ||
        entry.originalSize > 12 * 1024 * 1024 ||
        seen.has(entry.name) ||
        entry.name.includes("..") ||
        /vbaProject|externalLinks|embeddings/i.test(entry.name)
      )
        throw new Error(
          "Workbook is oversized, ambiguous or contains unsupported active/external content.",
        );
      seen.add(entry.name);
      return true;
    },
  });
  if (!files["[Content_Types].xml"] || !files["xl/workbook.xml"])
    throw new Error("Use a valid .xlsx workbook.");
  for (const [name, data] of Object.entries(files))
    if (/\.(xml|rels)$/.test(name)) {
      const xml = strFromU8(data);
      if (/<!DOCTYPE|<!ENTITY|<(?:\w+:)?f(?:\s|\/?>)|TargetMode\s*=\s*["']External/i.test(xml))
        throw new Error(
          "Workbook formulas, entities and external links are not accepted; provide literal values.",
        );
    }
}
/** Parses locally. No student insertion, document upload or external lookup. */
export async function parseStudentFile(
  filename: string,
  bytes: Uint8Array,
  guardianOnly = false,
): Promise<StudentImportRow[]> {
  if (!bytes.length || bytes.length > STUDENT_IMPORT_MAX_BYTES)
    throw new Error("Use a CSV/.xlsx file up to 4 MiB.");
  if (/\.csv$/i.test(filename))
    return validateStudentImportShape(
      parseRegistryCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      guardianOnly,
    );
  if (!/\.xlsx$/i.test(filename))
    throw new Error("Use CSV or modern Excel .xlsx; save older .xls files as .xlsx or CSV.");
  inspectStudentWorkbook(bytes);
  const matrix = await readSheet(new Blob([new Uint8Array(bytes)]), 1);
  if (
    matrix.length > STUDENT_IMPORT_MAX_ROWS + 1 ||
    matrix.some((r) => r.length > studentImportColumns.length)
  )
    throw new Error("Workbook exceeds the template row/column limits.");
  const headers = matrix.shift()?.map((v) => String(v ?? "").trim());
  if (!headers?.length || new Set(headers).size !== headers.length)
    throw new Error("Workbook headers must be unique.");
  const rows = matrix
    .filter((r) => r.some((v) => v !== null && v !== ""))
    .map((r, index) =>
      Object.fromEntries(
        headers.map((key, i) => {
          const value = r[i];
          if (
            ["admission_number", "roll_number", "guardian_mobile"].includes(key) &&
            typeof value === "number"
          )
            throw new Error(
              `Row ${index + 2}: format identifiers as Text in Excel to preserve leading zeroes.`,
            );
          return [
            key,
            value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? ""),
          ];
        }),
      ),
    );
  return validateStudentImportShape(rows, guardianOnly);
}
export async function studentFileHash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
