import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import {
  parseStudentFile,
  studentImportColumns as allStudentImportColumns,
  guardianRelationshipColumns,
  inspectStudentWorkbook,
  studentFileHash,
} from "../src/lib/student-import.ts";
import { importSummary } from "../src/lib/student-academics.ts";
const studentImportColumns = allStudentImportColumns.filter((c) => !c.startsWith("guardian_"));

const details = {
  full_name: "Student, With Unicode É",
  admission_number: "0000123",
  roll_number: "0010",
  admitted_on: "2025-07-01",
  department_code: "ART",
  program_code: "MUS",
  cohort_code: "2025-M",
  academic_year: "2026-27",
  term_name: "Studio Two",
  section_name: "North",
  entry_type: "lateral",
  entry_academic_year: "2026-27",
  entry_term_name: "Studio Two",
  starts_on: "2026-07-01",
  entry_year: "2",
  current_year: "2",
};
const escapeCsv = (v) => `"${String(v).replaceAll('"', '""')}"`;
const csv = (rows = [details]) =>
  strToU8(
    studentImportColumns.join(",") +
      "\r\n" +
      rows
        .map((r) => studentImportColumns.map((k) => escapeCsv(r[k] ?? "")).join(","))
        .join("\r\n"),
  );
const xml = (v) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
// Actual OOXML ZIP fixtures; the application parser does not generate workbooks.
export function workbook(rows = [details], extra = {}, columns = studentImportColumns) {
  const matrix = [columns, ...rows.map((r) => columns.map((k) => r[k] ?? ""))];
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Students" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml":
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      matrix
        .map(
          (r, i) =>
            '<row r="' +
            (i + 1) +
            '">' +
            r
              .map((v, j) => {
                let column = "",
                  position = j + 1;
                while (position) {
                  position--;
                  column = String.fromCharCode(65 + (position % 26)) + column;
                  position = Math.floor(position / 26);
                }
                const ref = column + (i + 1);
                return typeof v === "number"
                  ? `<c r="${ref}"><v>${v}</v></c>`
                  : `<c r="${ref}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`;
              })
              .join("") +
            "</row>",
        )
        .join("") +
      "</sheetData></worksheet>",
    ...extra,
  };
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])),
  );
}
test("CSV preserves quoted names, Unicode, multiline cells and leading-zero identifiers", async () => {
  const rows = await parseStudentFile(
    "admissions.csv",
    csv([{ ...details, full_name: 'Student, "Known"\nName' }]),
  );
  assert.equal(rows[0].admission_number, "0000123");
  assert.equal(rows[0].roll_number, "0010");
  assert.equal(rows[0].full_name, 'Student, "Known"\nName');
});
test("Excel parses a real OOXML workbook with text identifiers and arbitrary program structure", async () => {
  const rows = await parseStudentFile("admissions.xlsx", workbook());
  assert.deepEqual(rows, [details]);
});
test("Excel numeric identifiers fail explicitly rather than losing their leading zeroes", async () => {
  await assert.rejects(
    parseStudentFile("admissions.xlsx", workbook([{ ...details, admission_number: 123 }])),
    /Text/,
  );
});

test("student CSV and Excel accept optional guardian contacts without treating an international mobile as a formula", async () => {
  const guardian = {
    ...details,
    guardian_name: "Recorded Guardian",
    guardian_relationship: "mother",
    guardian_mobile: "+91 98765 40001",
    guardian_receives_notifications: "true",
    guardian_is_primary: "false",
    guardian_effective_from: "2026-07-01",
  };
  const data =
    allStudentImportColumns.join(",") +
    "\n" +
    allStudentImportColumns.map((k) => escapeCsv(guardian[k] ?? "")).join(",");
  for (const rows of [
    await parseStudentFile("students.csv", strToU8(data)),
    await parseStudentFile("students.xlsx", workbook([guardian], {}, allStudentImportColumns)),
  ]) {
    assert.equal(rows[0].guardian_mobile, "+91 98765 40001");
    assert.equal(rows[0].guardian_is_primary, "false");
    assert.equal(rows[0].guardian_receives_notifications, "true");
    assert.equal(rows[0].communication_consent, undefined);
  }
});
test("guardian-only CSV and Excel use existing admission identity and preserve text contact identifiers", async () => {
  const guardian = {
    admission_number: "0000123",
    guardian_name: "Recorded Guardian",
    guardian_relationship: "guardian",
    guardian_mobile: "+919876540001",
    guardian_effective_from: "2026-07-01",
  };
  const data =
    guardianRelationshipColumns.join(",") +
    "\n" +
    guardianRelationshipColumns.map((k) => escapeCsv(guardian[k] ?? "")).join(",");
  for (const rows of [
    await parseStudentFile("guardians.csv", strToU8(data), true),
    await parseStudentFile(
      "guardians.xlsx",
      workbook([guardian], {}, guardianRelationshipColumns),
      true,
    ),
  ]) {
    assert.equal(rows[0].admission_number, "0000123");
    assert.equal(rows[0].guardian_mobile, "+919876540001");
    assert.equal(rows[0].full_name, undefined);
  }
  await assert.rejects(parseStudentFile("guardians.csv", strToU8(data)), /template/);
  await assert.rejects(
    parseStudentFile(
      "guardians.xlsx",
      workbook([{ ...guardian, guardian_mobile: 919876540001 }], {}, guardianRelationshipColumns),
      true,
    ),
    /Text/,
  );
});
test("guardian phone exception never permits formula text or arbitrary consent columns", async () => {
  for (const [field, bad] of [
    ["guardian_mobile", '=HYPERLINK("https://fixture.invalid")'],
    ["guardian_name", "+Formula"],
  ]) {
    const guardian = {
      ...details,
      guardian_name: "Guardian",
      guardian_mobile: "+919876540001",
      [field]: bad,
    };
    const data =
      allStudentImportColumns.join(",") +
      "\n" +
      allStudentImportColumns.map((k) => escapeCsv(guardian[k] ?? "")).join(",");
    await assert.rejects(parseStudentFile("guardians.csv", strToU8(data)), /formulas/);
  }
  const data =
    studentImportColumns.join(",") +
    ",communication_consent\n" +
    studentImportColumns.map((k) => escapeCsv(details[k] ?? "")).join(",") +
    ",true";
  await assert.rejects(parseStudentFile("students.csv", strToU8(data)), /template/);
});
test("normal, lateral and transfer entries retain the supplied actual entry point", async () => {
  for (const entry_type of ["normal", "lateral", "transfer"]) {
    const rows = await parseStudentFile("entry.csv", csv([{ ...details, entry_type }]));
    assert.equal(rows[0].entry_type, entry_type);
    assert.equal(rows[0].entry_term_name, "Studio Two");
  }
});
test("missing/duplicate/unknown headers and malformed quoted CSV are rejected", async () => {
  for (const input of [
    "name,admission_number\nA,1",
    "full_name,full_name\nA,B",
    "__proto__,admission_number\nA,1",
    '"unterminated',
  ])
    await assert.rejects(parseStudentFile("bad.csv", strToU8(input)));
});
test("empty, oversized, invalid UTF-8 and unsupported legacy Excel files are rejected", async () => {
  await assert.rejects(parseStudentFile("empty.csv", new Uint8Array()));
  await assert.rejects(parseStudentFile("huge.csv", new Uint8Array(4 * 1024 * 1024 + 1)));
  await assert.rejects(parseStudentFile("old.xls", csv()), /xlsx/);
  await assert.rejects(parseStudentFile("bad.csv", new Uint8Array([255, 254, 0])));
});
test("CSV/Excel formula and external-content imports are rejected without executing them", async () => {
  await assert.rejects(
    parseStudentFile(
      "bad.csv",
      csv([{ ...details, full_name: '=WEBSERVICE("https://fixture.invalid")' }]),
    ),
    /formula/i,
  );
  const formula =
    "<worksheet><sheetData><row><c><f>1+1</f><v>2</v></c></row></sheetData></worksheet>";
  await assert.rejects(
    parseStudentFile("formula.xlsx", workbook([details], { "xl/worksheets/sheet1.xml": formula })),
    /formula/i,
  );
  assert.throws(
    () =>
      inspectStudentWorkbook(workbook([details], { "xl/externalLinks/externalLink1.xml": "<x/>" })),
    /unsupported/,
  );
  assert.throws(
    () => inspectStudentWorkbook(workbook([details], { "xl/vbaProject.bin": "macro" })),
    /unsupported/,
  );
  assert.throws(
    () =>
      inspectStudentWorkbook(
        workbook([details], {
          "xl/test.xml": '<!DOCTYPE x [<!ENTITY test SYSTEM "file:///fixture">]><x/>',
        }),
      ),
    /entities/,
  );
});
test("bounded expansion and row counts reject ZIP bombs and oversized batches", async () => {
  assert.throws(
    () =>
      inspectStudentWorkbook(
        workbook([details], { "xl/huge.xml": " ".repeat(12 * 1024 * 1024 + 1) }),
      ),
    /oversized/,
  );
  await assert.rejects(
    parseStudentFile("too-many.csv", csv(Array.from({ length: 501 }, () => details))),
    /500/,
  );
});
test("file digest is stable and changes with input bytes", async () => {
  assert.equal(await studentFileHash(csv()), await studentFileHash(csv()));
  assert.notEqual(
    await studentFileHash(csv()),
    await studentFileHash(csv([{ ...details, full_name: "Different Student" }])),
  );
});
test("preview summary distinguishes valid/rejected/skipped, existing matches and potential duplicates", () => {
  const summary = importSummary([
    {
      outcome: "valid",
      warnings: ["missing optional roll"],
      existing_students: [],
      potential_duplicates: [],
    },
    {
      outcome: "rejected",
      warnings: [],
      existing_students: [{ id: "fixture" }],
      potential_duplicates: [],
    },
    {
      outcome: "rejected",
      warnings: ["review"],
      existing_students: [],
      potential_duplicates: [{ id: "fixture" }],
    },
    { outcome: "skipped", warnings: [] },
  ]);
  assert.deepEqual(summary, {
    valid: 1,
    rejected: 2,
    skipped: 1,
    warnings: 2,
    existing: 1,
    potential: 1,
  });
});
